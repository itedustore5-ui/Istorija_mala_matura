import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, quizAttempts, users, type User } from "@workspace/db";
import { requireAdmin, requireAuth, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const adminUser = (user: User) => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  role: user.role as "admin" | "student",
  active: user.active,
  neverExpires: user.neverExpires,
  quizOnce: user.quizOnce,
  createdAt: user.createdAt.toISOString(),
});

router.use("/admin", requireAuth, requireAdmin);

router.get("/admin/users", async (_req, res) => {
  const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
  res.json(allUsers.map(adminUser));
});

const ROLES = ["admin", "student"] as const;
const MIN_PASSWORD = 6;

type UserInput = {
  username: string;
  fullName: string;
  password: string;
  role: string;
  active: boolean;
  neverExpires: boolean;
  quizOnce: boolean;
};

/**
 * Провера уноса за налог.
 *
 * Раније је `role` ишао право у базу: словна грешка („studnet“) правила је
 * налог који није ни ученик ни админ, а `requireAdmin` пореди са „admin“, па
 * би се админ том грешком тихо разадминио.
 */
function validateUser(
  body: Record<string, unknown>,
  forUpdate: boolean,
): { error: string; value?: undefined } | { error?: undefined; value: UserInput } {
  const username = String(body.username ?? "").trim();
  const fullName = String(body.fullName ?? "").trim();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "student");

  if (!username) return { error: "Корисничко име не сме бити празно." };
  if (!fullName) return { error: "Име и презиме не смеју бити празни." };
  if (!(ROLES as readonly string[]).includes(role)) {
    return { error: "Улога мора бити „admin“ или „student“." };
  }
  // При измени празна лозинка значи „не дирај лозинку“, при упису не сме да је
  // нема.
  if (!forUpdate && password.length < MIN_PASSWORD) {
    return { error: `Лозинка мора имати бар ${MIN_PASSWORD} знакова.` };
  }
  if (forUpdate && password && password.length < MIN_PASSWORD) {
    return { error: `Лозинка мора имати бар ${MIN_PASSWORD} знакова.` };
  }

  return {
    value: {
      username,
      fullName,
      password,
      role,
      active: body.active !== false,
      neverExpires: body.neverExpires !== false,
      quizOnce: body.quizOnce === true,
    },
  };
}

/** Постгресов код за прекршен unique индекс. */
const isDuplicate = (err: unknown) =>
  typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505";

router.post("/admin/users", async (req, res) => {
  const checked = validateUser(req.body as Record<string, unknown>, false);
  if (checked.error) {
    res.status(400).json({ message: checked.error });
    return;
  }
  const v = checked.value!;

  try {
    const [user] = await db
      .insert(users)
      .values({
        username: v.username,
        passwordHash: await bcrypt.hash(v.password, 10),
        fullName: v.fullName,
        role: v.role,
        active: v.active,
        neverExpires: v.neverExpires,
        quizOnce: v.quizOnce,
      })
      .returning();
    res.json(adminUser(user!));
  } catch (err) {
    // Сирова порука из базе је носила и детаље о шеми; напоље иде само оно што
    // наставнику нешто значи.
    if (isDuplicate(err)) {
      res.status(409).json({ message: "Корисничко име је већ заузето." });
      return;
    }
    req.log.error({ err }, "Greška pri upisu korisnika");
    res.status(500).json({ message: "Налог није направљен." });
  }
});

router.put("/admin/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ message: "Неисправан број налога." });
    return;
  }

  const checked = validateUser(req.body as Record<string, unknown>, true);
  if (checked.error) {
    res.status(400).json({ message: checked.error });
    return;
  }
  const v = checked.value!;

  try {
    const [user] = await db
      .update(users)
      .set({
        username: v.username,
        fullName: v.fullName,
        role: v.role,
        active: v.active,
        neverExpires: v.neverExpires,
        quizOnce: v.quizOnce,
        // Лозинка се мења само ако је нова стварно послата. Иначе би измена
        // имена и презимена ученику тихо поставила празну лозинку.
        ...(v.password ? { passwordHash: await bcrypt.hash(v.password, 10) } : {}),
      })
      .where(eq(users.id, id))
      .returning();

    if (!user) {
      res.status(404).json({ message: "Корисник није пронађен." });
      return;
    }
    res.json(adminUser(user));
  } catch (err) {
    if (isDuplicate(err)) {
      res.status(409).json({ message: "Корисничко име је већ заузето." });
      return;
    }
    req.log.error({ err }, "Greška pri izmeni korisnika");
    res.status(500).json({ message: "Измена није сачувана." });
  }
});

/**
 * Брисање налога.
 *
 * Брисање каскадно уклања и све покушаје и све редове у `attempt_items`. За
 * испитаника у студији то је трајан губитак мерења, а за последњег админа
 * губитак приступа целој апликацији — ниједно се не може вратити. Зато три
 * провере пре него што се ишта обрише.
 */
router.delete("/admin/users/:id", async (req, res) => {
  const me = (req as unknown as AuthedRequest).user;
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ message: "Неисправан број налога." });
    return;
  }
  if (id === me.id) {
    res.status(409).json({ message: "Не можеш обрисати налог под којим си пријављен." });
    return;
  }

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) {
    res.status(404).json({ message: "Корисник није пронађен." });
    return;
  }

  if (target.role === "admin") {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.active, true)));
    if (n <= 1) {
      res.status(409).json({ message: "Ово је последњи админ налог и не може се обрисати." });
      return;
    }
  }

  if (target.studyArm) {
    res.status(409).json({
      message:
        "Овај налог је испитаник у студији; брисање би трајно уклонило његова мерења. Прво га избаци из студије.",
    });
    return;
  }

  await db.delete(users).where(eq(users.id, id));
  req.log.warn({ deletedUserId: id, byUserId: me.id }, "Obrisan korisnički nalog");
  res.json({ message: "Корисник је обрисан." });
});

router.get("/admin/results", async (_req, res) => {
  const attempts = await db.select().from(quizAttempts).orderBy(desc(quizAttempts.createdAt));
  const allUsers = await db.select().from(users);
  const rows = attempts.map((attempt) => {
    const user = allUsers.find((item) => item.id === attempt.userId);
    return {
      id: attempt.id,
      userId: attempt.userId,
      username: user?.username ?? "обрисан",
      fullName: user?.fullName ?? "Обрисан корисник",
      // Вежбање и испит се разликују по exam_key; без њега се на прегледу не
      // види да ли је ред био тест или вежба из једне целине.
      examKey: attempt.examKey,
      block: attempt.block,
      score: attempt.score,
      total: attempt.total,
      percentage: attempt.percentage,
      pointsEarned: attempt.pointsEarned === null ? null : Number(attempt.pointsEarned),
      pointsTotal: attempt.pointsTotal === null ? null : Number(attempt.pointsTotal),
      passed: attempt.passed,
      createdAt: attempt.createdAt.toISOString(),
    };
  });
  res.json(rows);
});

export default router;
