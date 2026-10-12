import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { attemptItems, db, quizAttempts, studySettings, users } from "@workspace/db";
import { examSummaries } from "../data/exams";
import {
  FORMS,
  MEASUREMENT_PHASES,
  PHASES,
  ROTATION_GROUPS,
  STUDY_ARMS,
  assignRotationGroup,
  formFor,
  getSettings,
  isPhase,
  isStudyArm,
} from "../lib/study";
import { requireAdmin, requireAuth, type AuthedRequest } from "../middlewares/auth";

/**
 * Управљање студијом: подешавања, преглед попуњености, поништавање покушаја и
 * извоз. Све стоји иза admin права.
 *
 * Ово су ствари које се откривају на дан мерења ако их нема — зато стоје овде,
 * а не у SQL едитору.
 */
const router: IRouter = Router();

router.use("/research", requireAuth, requireAdmin);

// ── Подешавања студије ────────────────────────────────────────────────────
router.get("/research/settings", async (_req, res) => {
  const settings = await getSettings();
  res.json({
    currentPhase: settings.currentPhase,
    examOpen: settings.examOpen,
    practiceOpen: settings.practiceOpen,
    forms: { A: settings.formAExam, B: settings.formBExam, C: settings.formCExam },
    updatedAt: settings.updatedAt.toISOString(),
    // Шта се уопште може изабрати — да фронтенд не држи своју копију листе.
    options: {
      phases: PHASES,
      measurementPhases: MEASUREMENT_PHASES,
      forms: FORMS,
      arms: STUDY_ARMS,
      rotationGroups: ROTATION_GROUPS,
      exams: examSummaries().map((e) => ({ key: e.key, label: e.label })),
    },
  });
});

router.patch("/research/settings", async (req, res) => {
  const user = (req as AuthedRequest).user;
  const body = req.body as {
    currentPhase?: string | null;
    examOpen?: boolean;
    practiceOpen?: boolean;
    forms?: Partial<Record<"A" | "B" | "C", string | null>>;
  };

  if (body.currentPhase !== undefined && body.currentPhase !== null && !isPhase(body.currentPhase)) {
    res.status(400).json({ message: "Непозната фаза." });
    return;
  }

  // Састав форми се не мења кад мерење почне: иначе групе не пролазе кроз исти
  // скуп и стари подаци се не могу поправити.
  if (body.forms) {
    const [measured] = await db
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .where(and(isNotNull(quizAttempts.form), isNull(quizAttempts.invalidatedAt)))
      .limit(1);
    if (measured) {
      res.status(409).json({
        message:
          "Форме се више не могу мењати — мерење је почело. Промена би значила да групе нису прошле кроз исти скуп тестова.",
      });
      return;
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: user.id };
  if (body.currentPhase !== undefined) patch.currentPhase = body.currentPhase;
  if (typeof body.examOpen === "boolean") patch.examOpen = body.examOpen;
  if (typeof body.practiceOpen === "boolean") patch.practiceOpen = body.practiceOpen;
  if (body.forms) {
    if ("A" in body.forms) patch.formAExam = body.forms.A ?? null;
    if ("B" in body.forms) patch.formBExam = body.forms.B ?? null;
    if ("C" in body.forms) patch.formCExam = body.forms.C ?? null;
  }

  await getSettings();
  await db.update(studySettings).set(patch).where(eq(studySettings.id, 1));

  const updated = await getSettings();
  res.json({
    currentPhase: updated.currentPhase,
    examOpen: updated.examOpen,
    practiceOpen: updated.practiceOpen,
    forms: { A: updated.formAExam, B: updated.formBExam, C: updated.formCExam },
    updatedAt: updated.updatedAt.toISOString(),
  });
});

// ── Испитаници ────────────────────────────────────────────────────────────
router.patch("/research/participants/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as {
    classGroup?: string | null;
    studyArm?: string | null;
    rotationGroup?: number | null;
    consentResearch?: boolean;
    researchId?: string | null;
  };

  if (body.studyArm !== undefined && body.studyArm !== null && !isStudyArm(body.studyArm)) {
    res.status(400).json({ message: "Непозната грана студије." });
    return;
  }
  if (
    body.rotationGroup !== undefined &&
    body.rotationGroup !== null &&
    !(ROTATION_GROUPS as readonly number[]).includes(body.rotationGroup)
  ) {
    res.status(400).json({ message: "Ротациона група мора бити 1, 2 или 3." });
    return;
  }

  const patch: Record<string, unknown> = {};
  if (body.classGroup !== undefined) patch.classGroup = body.classGroup;
  if (body.studyArm !== undefined) patch.studyArm = body.studyArm;
  if (body.rotationGroup !== undefined) patch.rotationGroup = body.rotationGroup;
  if (typeof body.consentResearch === "boolean") patch.consentResearch = body.consentResearch;
  if (body.researchId !== undefined) patch.researchId = body.researchId;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ message: "Нема шта да се измени." });
    return;
  }

  const [updated] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  if (!updated) {
    res.status(404).json({ message: "Испитаник није пронађен." });
    return;
  }
  res.json({ id: updated.id, researchId: updated.researchId });
});

/**
 * Уписивање у студију: додељује псеудоним и ротациону групу оном ко их нема.
 * Ротација иде аутоматски, у најмању групу — ручна додела би групе с временом
 * развукла, а уравнотежење ради само ако су приближно једнаке.
 */
router.post("/research/enroll", async (req, res) => {
  const body = req.body as { userIds?: number[]; studyArm?: string; classGroup?: string | null };
  const ids = Array.isArray(body.userIds) ? body.userIds.filter((n) => Number.isInteger(n)) : [];

  if (ids.length === 0) {
    res.status(400).json({ message: "Није изабран ниједан испитаник." });
    return;
  }
  if (!isStudyArm(body.studyArm)) {
    res.status(400).json({ message: "Непозната грана студије." });
    return;
  }

  const enrolled: { id: number; researchId: string; rotationGroup: number }[] = [];

  for (const id of ids) {
    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) continue;

    // Префикс „IS“ (историја) да се псеудоними не помешају са онима из
    // апликације за српски ако се скупови икад споје у истој анализи.
    const researchId = existing.researchId ?? `IS-${String(id).padStart(4, "0")}`;
    const rotationGroup = existing.rotationGroup ?? (await assignRotationGroup());

    await db
      .update(users)
      .set({
        researchId,
        rotationGroup,
        studyArm: body.studyArm,
        ...(body.classGroup !== undefined ? { classGroup: body.classGroup } : {}),
      })
      .where(eq(users.id, id));

    enrolled.push({ id, researchId, rotationGroup });
  }

  res.json({ enrolled });
});

// ── Преглед попуњености ───────────────────────────────────────────────────
// Гледа се ПРЕ затварања термина, не после.
router.get("/research/completion", async (_req, res) => {
  const settings = await getSettings();

  const participants = await db
    .select()
    .from(users)
    .where(isNotNull(users.studyArm))
    .orderBy(users.classGroup, users.fullName);

  const attempts = await db
    .select({
      userId: quizAttempts.userId,
      phase: quizAttempts.phase,
      examKey: quizAttempts.examKey,
      form: quizAttempts.form,
      percentage: quizAttempts.percentage,
      invalidatedAt: quizAttempts.invalidatedAt,
      createdAt: quizAttempts.createdAt,
      durationMs: quizAttempts.durationMs,
    })
    .from(quizAttempts);

  const rows = participants.map((p) => {
    const mine = attempts.filter((a) => a.userId === p.id && !a.invalidatedAt);
    const practice = mine.filter((a) => a.examKey === null);

    const measurements = Object.fromEntries(
      MEASUREMENT_PHASES.map((phase) => {
        const done = mine.find((a) => a.examKey !== null && a.phase === phase);
        return [
          phase,
          done
            ? { done: true, percentage: done.percentage, at: done.createdAt.toISOString() }
            : { done: false, expectedForm: formFor(p.rotationGroup, phase) },
        ];
      }),
    );

    return {
      id: p.id,
      fullName: p.fullName,
      researchId: p.researchId,
      classGroup: p.classGroup,
      studyArm: p.studyArm,
      rotationGroup: p.rotationGroup,
      consentResearch: p.consentResearch,
      // Доза интервенције: без ње се може рећи само да је резултат опао, што би
      // се десило и без апликације, простим протоком времена.
      practiceCount: practice.length,
      practiceMs: practice.reduce((sum, a) => sum + (a.durationMs ?? 0), 0),
      measurements,
    };
  });

  res.json({ currentPhase: settings.currentPhase, examOpen: settings.examOpen, rows });
});

// ── Поништавање покушаја ──────────────────────────────────────────────────
// Некоме ће пући веза или затворити прозор. Без овога истраживач усред часа
// отвара SQL едитор. Поништавање се бележи: ко, коме, који резултат.
router.post("/research/attempts/:id/invalidate", async (req, res) => {
  const user = (req as unknown as AuthedRequest).user;
  const id = Number(req.params.id);
  const body = req.body as { reason?: string };

  const reason = (body.reason ?? "").trim();
  if (reason.length < 3) {
    res.status(400).json({ message: "Разлог поништавања мора бити уписан." });
    return;
  }

  const [updated] = await db
    .update(quizAttempts)
    .set({ invalidatedAt: new Date(), invalidatedBy: user.id, invalidatedReason: reason })
    .where(and(eq(quizAttempts.id, id), isNull(quizAttempts.invalidatedAt)))
    .returning();

  if (!updated) {
    res.status(404).json({ message: "Покушај није пронађен или је већ поништен." });
    return;
  }

  res.json({
    id: updated.id,
    invalidatedAt: updated.invalidatedAt!.toISOString(),
    percentage: updated.percentage,
  });
});

router.get("/research/attempts", async (req, res) => {
  const { userId } = req.query as Record<string, string | undefined>;

  const rows = await db
    .select({
      id: quizAttempts.id,
      userId: quizAttempts.userId,
      fullName: users.fullName,
      researchId: users.researchId,
      examKey: quizAttempts.examKey,
      block: quizAttempts.block,
      phase: quizAttempts.phase,
      form: quizAttempts.form,
      percentage: quizAttempts.percentage,
      durationMs: quizAttempts.durationMs,
      invalidatedAt: quizAttempts.invalidatedAt,
      invalidatedReason: quizAttempts.invalidatedReason,
      createdAt: quizAttempts.createdAt,
    })
    .from(quizAttempts)
    .innerJoin(users, eq(users.id, quizAttempts.userId))
    .where(userId ? eq(quizAttempts.userId, Number(userId)) : sql`true`)
    .orderBy(desc(quizAttempts.createdAt))
    .limit(500);

  res.json(
    rows.map((r) => ({
      ...r,
      invalidatedAt: r.invalidatedAt ? r.invalidatedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// ── Стање студије укратко ─────────────────────────────────────────────────
router.get("/research/overview", async (_req, res) => {
  const byArm = await db
    .select({ arm: users.studyArm, n: sql<number>`count(*)::int` })
    .from(users)
    .where(isNotNull(users.studyArm))
    .groupBy(users.studyArm);

  const byRotation = await db
    .select({ group: users.rotationGroup, n: sql<number>`count(*)::int` })
    .from(users)
    .where(isNotNull(users.studyArm))
    .groupBy(users.rotationGroup);

  const [items] = await db.select({ n: sql<number>`count(*)::int` }).from(attemptItems);

  res.json({
    byArm,
    byRotation,
    itemRows: items?.n ?? 0,
  });
});

export default router;
