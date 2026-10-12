import { Router, type Response } from "express";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  attemptItems,
  attempts,
  events,
  forms,
  images,
  questions,
  studySettings,
  subjects,
  tests,
  users,
  type User,
} from "../db/schema.js";
import { currentUser, hashPassword, requireAdmin, requireAuth } from "../auth.js";
import { ATTEMPT_COLUMNS, CSV_VERSION, EVENT_COLUMNS, ITEM_COLUMNS, toCsv } from "../csv.js";
import { orderingIsSolved, shuffleOrdering, validateQuestion, type QuestionInput } from "../questionModel.js";
import {
  FORMS,
  PHASES,
  ROTATION,
  STUDY_ARMS,
  assignRotationGroup,
  formQuestionIds,
  getSettings,
  isForm,
  isPhase,
  isStudyArm,
  measurementStarted,
} from "../study.js";

/**
 * Админ: налози и сагласност, задаци (садржај се мења само овде), студија,
 * форме, покушаји и извоз. Све иза админ права.
 */

const MIN_PASSWORD = 6;
const researchPrefix = () => (process.env.RESEARCH_ID_PREFIX || "MM").replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || "MM";

const adminUser = (u: User) => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  role: u.role,
  active: u.active,
  researchId: u.researchId,
  consentResearch: u.consentResearch,
  consentAt: u.consentAt?.toISOString() ?? null,
  classGroup: u.classGroup,
  studyArm: u.studyArm,
  rotationGroup: u.rotationGroup,
  createdAt: u.createdAt.toISOString(),
});

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

function sendCsv(res: Response, filename: string, body: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
}

export function adminRoutes(db: Db): Router {
  const router = Router();
  router.use("/admin", requireAuth(db), requireAdmin);

  // ── Налози ───────────────────────────────────────────────────────────────
  router.get("/admin/users", async (_req, res) => {
    const list = await db.select().from(users).orderBy(asc(users.role), asc(users.fullName));
    res.json(list.map(adminUser));
  });

  router.post("/admin/users", async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const username = String(b.username ?? "").trim();
    const fullName = String(b.fullName ?? "").trim();
    const password = String(b.password ?? "");
    const role = b.role === "admin" ? "admin" : "student";
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
      res.status(400).json({ message: "Корисничко име: 3–40 знакова, латинична слова, цифре, тачка, цртица." });
      return;
    }
    if (!fullName) {
      res.status(400).json({ message: "Упиши име и презиме." });
      return;
    }
    if (password.length < MIN_PASSWORD) {
      res.status(400).json({ message: `Лозинка мора имати бар ${MIN_PASSWORD} знакова.` });
      return;
    }
    try {
      const [created] = await db
        .insert(users)
        .values({
          username,
          fullName,
          role,
          passwordHash: await hashPassword(password),
          classGroup: typeof b.classGroup === "string" && b.classGroup.trim() ? b.classGroup.trim() : null,
        })
        .returning();
      res.json(adminUser(created!));
    } catch (err) {
      if (isDuplicate(err)) {
        res.status(409).json({ message: "Корисничко име је заузето." });
        return;
      }
      throw err;
    }
  });

  router.put("/admin/users/:id", async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    const [target] = await db.select().from(users).where(eq(users.id, id));
    if (!target) {
      res.status(404).json({ message: "Налог није пронађен." });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<typeof users.$inferInsert> = {};

    if (typeof b.fullName === "string") {
      if (!b.fullName.trim()) {
        res.status(400).json({ message: "Име и презиме не смеју бити празни." });
        return;
      }
      patch.fullName = b.fullName.trim();
    }
    if (typeof b.password === "string" && b.password !== "") {
      if (b.password.length < MIN_PASSWORD) {
        res.status(400).json({ message: `Лозинка мора имати бар ${MIN_PASSWORD} знакова.` });
        return;
      }
      patch.passwordHash = await hashPassword(b.password);
    }
    if (b.classGroup !== undefined) patch.classGroup = typeof b.classGroup === "string" && b.classGroup.trim() ? b.classGroup.trim() : null;

    const losesAdmin = (b.role !== undefined && b.role !== "admin") || b.active === false;
    if (target.role === "admin" && losesAdmin) {
      if (target.id === me.id) {
        res.status(409).json({ message: "Не можеш себи да одузмеш админ права ни да се искључиш." });
        return;
      }
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.active, true)));
      if (Number(n) <= 1) {
        res.status(409).json({ message: "Ово је последњи админ налог." });
        return;
      }
    }
    if (b.role === "admin" || b.role === "student") patch.role = b.role;
    if (typeof b.active === "boolean") patch.active = b.active;

    // Упис у истраживање: псеудоним и ротациона група додељују се једном и
    // више се не мењају — на њих показују већ извезени подаци.
    if (b.studyArm !== undefined) {
      if (b.studyArm === null || b.studyArm === "") {
        patch.studyArm = null;
      } else if (isStudyArm(b.studyArm)) {
        patch.studyArm = b.studyArm;
        if (!target.researchId) patch.researchId = `${researchPrefix()}-${String(target.id).padStart(4, "0")}`;
        if (target.rotationGroup === null) patch.rotationGroup = await assignRotationGroup(db);
      } else {
        res.status(400).json({ message: "Непозната група истраживања." });
        return;
      }
    }

    // Сагласност: поставља се ручно, тек уз потписан образац родитеља.
    if (typeof b.consentResearch === "boolean") {
      patch.consentResearch = b.consentResearch;
      patch.consentAt = b.consentResearch ? new Date() : null;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ message: "Нема шта да се измени." });
      return;
    }
    const [updated] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    res.json(adminUser(updated!));
  });

  /**
   * Брисање каскадно уклања и све покушаје. За испитаника то је трајан губитак
   * мерења, за последњег админа губитак приступа — зато три провере.
   */
  router.delete("/admin/users/:id", async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    if (id === me.id) {
      res.status(409).json({ message: "Не можеш обрисати налог под којим си пријављен." });
      return;
    }
    const [target] = await db.select().from(users).where(eq(users.id, id));
    if (!target) {
      res.status(404).json({ message: "Налог није пронађен." });
      return;
    }
    if (target.role === "admin") {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.active, true)));
      if (Number(n) <= 1) {
        res.status(409).json({ message: "Ово је последњи админ налог." });
        return;
      }
    }
    if (target.studyArm) {
      res.status(409).json({
        message: "Налог је у истраживању; брисање би трајно уклонило његова мерења. Прво га искључи из истраживања.",
      });
      return;
    }
    await db.delete(users).where(eq(users.id, id));
    res.json({ deleted: id });
  });

  // ── Задаци ───────────────────────────────────────────────────────────────
  router.get("/admin/subjects", async (_req, res) => {
    res.json(await db.select().from(subjects).orderBy(asc(subjects.position)));
  });

  router.get("/admin/tests", async (_req, res) => {
    res.json(await db.select().from(tests).orderBy(asc(tests.position), asc(tests.year)));
  });

  /** `source=zbirka` — само збирка; `source=<кључ теста>` — тај тест; без њега све. */
  router.get("/admin/questions", async (req, res) => {
    const subjectId = String(req.query.subjectId ?? "");
    const source = String(req.query.source ?? "");
    const list = await db
      .select()
      .from(questions)
      .where(
        and(
          subjectId ? eq(questions.subjectId, subjectId) : sql`true`,
          source === "zbirka" ? isNull(questions.testKey) : source ? eq(questions.testKey, source) : sql`true`,
        ),
      )
      .orderBy(asc(questions.subjectId), asc(questions.testKey), asc(questions.number));
    res.json(list);
  });

  function readQuestion(
    body: unknown,
    keep?: { partial: unknown },
  ): { value?: QuestionInput & { subjectId: string; active?: boolean }; error?: string } {
    const b = (body ?? {}) as Record<string, unknown>;
    const value = {
      subjectId: String(b.subjectId ?? ""),
      number: Number(b.number),
      section: typeof b.section === "string" ? b.section.trim() : "",
      type: b.type as QuestionInput["type"],
      prompt: typeof b.prompt === "string" ? b.prompt.trim() : "",
      content: (b.content && typeof b.content === "object" ? b.content : {}) as Record<string, unknown>,
      correct: b.correct,
      explanation: typeof b.explanation === "string" ? b.explanation.trim() : "",
      points: b.points === undefined ? 1 : Number(b.points),
      active: typeof b.active === "boolean" ? b.active : undefined,
      // Правило делимичних бодова из упутства за прегледање: кад га измена не
      // шаље, остаје постојеће — иначе би исправка словне грешке у задатку
      // тихо укинула 0,5 бода.
      partial: b.partialCredit !== undefined ? b.partialCredit : keep?.partial,
    };
    const error = validateQuestion(value);
    if (error) return { error };
    // Ставке за ређање се чувају измешане — иначе би ученик који ништа не
    // помери добио пун поен.
    if (value.type === "ordering" && orderingIsSolved(value.correct as number[])) {
      const mixed = shuffleOrdering(value.content.items as string[], value.correct as number[]);
      value.content = { ...value.content, items: mixed.items };
      value.correct = mixed.correct;
    }
    return { value };
  }

  router.post("/admin/questions", async (req, res) => {
    const { value, error } = readQuestion(req.body);
    if (!value) {
      res.status(400).json({ message: error });
      return;
    }
    const [subject] = await db.select().from(subjects).where(eq(subjects.id, value.subjectId));
    if (!subject) {
      res.status(400).json({ message: "Непознат предмет." });
      return;
    }
    try {
      const [created] = await db
        .insert(questions)
        .values({
          subjectId: value.subjectId,
          number: value.number,
          section: value.section,
          type: value.type,
          prompt: value.prompt,
          content: value.content,
          correct: value.correct,
          explanation: value.explanation,
          points: value.points,
          partialCredit: value.partial ?? null,
          active: value.active ?? true,
        })
        .returning();
      res.json(created);
    } catch (err) {
      if (isDuplicate(err)) {
        res.status(409).json({ message: "Задатак са тим бројем већ постоји у предмету." });
        return;
      }
      throw err;
    }
  });

  router.put("/admin/questions/:id", async (req, res) => {
    const id = Number(req.params.id);
    const [existing] = await db.select().from(questions).where(eq(questions.id, id));
    if (!existing) {
      res.status(404).json({ message: "Задатак није пронађен." });
      return;
    }
    // Задатак теста остаје у свом тесту и целини: целина задатка теста је сам
    // тест, а тест се не мења кроз уређивање задатка.
    const { value, error } = readQuestion(
      {
        ...(req.body ?? {}),
        subjectId: existing.subjectId,
        ...(existing.testKey ? { section: existing.section } : {}),
      },
      { partial: existing.partialCredit },
    );
    if (!value) {
      res.status(400).json({ message: error });
      return;
    }
    try {
      const [updated] = await db
        .update(questions)
        .set({
          number: value.number,
          section: value.section,
          type: value.type,
          prompt: value.prompt,
          content: value.content,
          correct: value.correct,
          explanation: value.explanation,
          points: value.points,
          partialCredit: value.partial ?? null,
          active: value.active ?? existing.active,
          // Верзија расте да се у подацима види који облик задатка је решаван.
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(questions.id, id))
        .returning();
      res.json(updated);
    } catch (err) {
      if (isDuplicate(err)) {
        res.status(409).json({ message: "Задатак са тим бројем већ постоји у предмету." });
        return;
      }
      throw err;
    }
  });

  router.get("/admin/images", async (_req, res) => {
    const list = await db.select({ name: images.name, mime: images.mime }).from(images).orderBy(asc(images.name));
    res.json(list);
  });

  router.post("/admin/images", async (req, res) => {
    const b = (req.body ?? {}) as { name?: unknown; mime?: unknown; dataBase64?: unknown; replace?: unknown };
    const name = String(b.name ?? "").trim();
    const mime = String(b.mime ?? "");
    if (!/^[a-z0-9][a-z0-9._-]{0,80}\.(jpg|jpeg|png|webp)$/i.test(name) || !/^image\/(jpeg|png|webp)$/.test(mime)) {
      res.status(400).json({ message: "Слика мора бити JPG, PNG или WEBP, са именом од латиничних слова и цифара." });
      return;
    }
    const data = Buffer.from(String(b.dataBase64 ?? ""), "base64");
    if (data.length === 0 || data.length > 3 * 1024 * 1024) {
      res.status(400).json({ message: "Слика мора бити мања од 3 MB." });
      return;
    }
    if (b.replace === true) {
      await db.insert(images).values({ name, mime, data }).onConflictDoUpdate({ target: images.name, set: { mime, data } });
    } else {
      const rows = await db.insert(images).values({ name, mime, data }).onConflictDoNothing().returning({ name: images.name });
      if (rows.length === 0) {
        res.status(409).json({ message: "Слика са тим именом већ постоји." });
        return;
      }
    }
    res.json({ name });
  });

  // ── Студија ──────────────────────────────────────────────────────────────
  router.get("/admin/study", async (_req, res) => {
    const settings = await getSettings(db);
    const allSubjects = await db.select().from(subjects).orderBy(asc(subjects.position));
    const allForms = await db.select().from(forms);
    const allTests = await db.select().from(tests).orderBy(asc(tests.position), asc(tests.year));
    const result = [];
    for (const s of allSubjects) {
      const formRows: Record<string, { testKey: string | null; questionNumbers: number[]; questionCount: number }> = {};
      for (const code of FORMS) {
        const f = allForms.find((x) => x.subjectId === s.id && x.code === code);
        formRows[code] = {
          testKey: f?.testKey ?? null,
          questionNumbers: (f?.questionNumbers as number[] | undefined) ?? [],
          questionCount: (await formQuestionIds(db, s.id, code)).length,
        };
      }
      result.push({
        id: s.id,
        name: s.name,
        measurementStarted: await measurementStarted(db, s.id),
        tests: allTests.filter((t) => t.subjectId === s.id).map((t) => ({ key: t.key, label: t.label, year: t.year })),
        forms: formRows,
      });
    }
    res.json({
      currentPhase: settings.currentPhase,
      testOpen: settings.testOpen,
      practiceOpen: settings.practiceOpen,
      phases: PHASES,
      arms: STUDY_ARMS,
      rotation: ROTATION,
      subjects: result,
    });
  });

  router.put("/admin/study", async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<typeof studySettings.$inferInsert> = { updatedAt: new Date() };
    if (b.currentPhase !== undefined) {
      if (b.currentPhase !== null && !isPhase(b.currentPhase)) {
        res.status(400).json({ message: "Непозната фаза." });
        return;
      }
      patch.currentPhase = b.currentPhase as string | null;
    }
    if (typeof b.testOpen === "boolean") patch.testOpen = b.testOpen;
    if (typeof b.practiceOpen === "boolean") patch.practiceOpen = b.practiceOpen;
    await getSettings(db);
    await db.update(studySettings).set(patch).where(eq(studySettings.id, 1));
    const s = await getSettings(db);
    res.json({ currentPhase: s.currentPhase, testOpen: s.testOpen, practiceOpen: s.practiceOpen });
  });

  /**
   * Састав форме бира истраживач: тест са завршног испита (`testKey`) или
   * бројеви задатака из збирке. Кад мерење почне, форме се више не мењају:
   * групе иначе не би прошле кроз исти скуп.
   */
  router.put("/admin/forms/:subjectId/:code", async (req, res) => {
    const subjectId = String(req.params.subjectId);
    const code = String(req.params.code);
    if (!isForm(code)) {
      res.status(400).json({ message: "Форма мора бити A, B или C." });
      return;
    }
    if (await measurementStarted(db, subjectId)) {
      res.status(409).json({ message: "Мерење је почело — форме се више не могу мењати." });
      return;
    }

    const testKey = (req.body as { testKey?: unknown })?.testKey;
    if (typeof testKey === "string" && testKey) {
      const [test] = await db
        .select()
        .from(tests)
        .where(and(eq(tests.key, testKey), eq(tests.subjectId, subjectId)));
      if (!test) {
        res.status(400).json({ message: "Тест не постоји у овом предмету." });
        return;
      }
      // Исти тест у две форме значи да уравнотежење не ради.
      const [taken] = await db
        .select({ code: forms.code })
        .from(forms)
        .where(and(eq(forms.subjectId, subjectId), eq(forms.testKey, testKey)));
      if (taken && taken.code !== code) {
        res.status(409).json({ message: `Тај тест је већ форма ${taken.code}.` });
        return;
      }
      await db
        .insert(forms)
        .values({ subjectId, code, testKey, questionNumbers: [], updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [forms.subjectId, forms.code],
          set: { testKey, questionNumbers: [], updatedAt: new Date() },
        });
      res.json({ subjectId, code, testKey, questionNumbers: [] });
      return;
    }

    const raw = (req.body as { questionNumbers?: unknown })?.questionNumbers;
    const numbers = Array.isArray(raw) ? raw.map(Number) : [];
    if (numbers.some((n) => !Number.isInteger(n)) || new Set(numbers).size !== numbers.length) {
      res.status(400).json({ message: "Бројеви задатака морају бити цели бројеви, без понављања." });
      return;
    }
    const found = numbers.length
      ? await db
          .select({ number: questions.number })
          .from(questions)
          .where(
            and(
              eq(questions.subjectId, subjectId),
              isNull(questions.testKey),
              eq(questions.active, true),
              inArray(questions.number, numbers),
            ),
          )
      : [];
    const missing = numbers.filter((n) => !found.some((f) => f.number === n));
    if (missing.length) {
      res.status(400).json({ message: `Нема активних задатака збирке са бројевима: ${missing.join(", ")}.` });
      return;
    }
    await db
      .insert(forms)
      .values({ subjectId, code, testKey: null, questionNumbers: numbers, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [forms.subjectId, forms.code],
        set: { testKey: null, questionNumbers: numbers, updatedAt: new Date() },
      });
    res.json({ subjectId, code, testKey: null, questionNumbers: numbers });
  });

  // ── Покушаји ─────────────────────────────────────────────────────────────
  router.get("/admin/attempts", async (req, res) => {
    const userId = Number(req.query.userId);
    const rows = await db
      .select({ attempt: attempts, fullName: users.fullName, username: users.username })
      .from(attempts)
      .innerJoin(users, eq(users.id, attempts.userId))
      .where(Number.isInteger(userId) && userId > 0 ? eq(attempts.userId, userId) : sql`true`)
      .orderBy(desc(attempts.startedAt))
      .limit(500);
    res.json(
      rows.map(({ attempt: a, fullName, username }) => ({
        id: a.id,
        userId: a.userId,
        fullName,
        username,
        subjectId: a.subjectId,
        kind: a.kind,
        section: a.section,
        phase: a.phase,
        form: a.form,
        score: a.score,
        maxScore: a.maxScore,
        startedAt: a.startedAt.toISOString(),
        submittedAt: a.submittedAt?.toISOString() ?? null,
        invalidatedAt: a.invalidatedAt?.toISOString() ?? null,
        invalidatedReason: a.invalidatedReason,
      })),
    );
  });

  /** Поништавање (пукла веза, затворен прозор): покушај се не брише, него означава. */
  router.post("/admin/attempts/:id/invalidate", async (req, res) => {
    const me = currentUser(req);
    const reason = String((req.body as { reason?: unknown })?.reason ?? "").trim();
    if (reason.length < 3) {
      res.status(400).json({ message: "Упиши разлог поништавања." });
      return;
    }
    const [updated] = await db
      .update(attempts)
      .set({ invalidatedAt: new Date(), invalidatedReason: reason, invalidatedBy: me.id })
      .where(and(eq(attempts.id, Number(req.params.id)), isNull(attempts.invalidatedAt)))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Покушај није пронађен или је већ поништен." });
      return;
    }
    res.json({ id: updated.id, invalidatedAt: updated.invalidatedAt!.toISOString() });
  });

  // ── Извоз ────────────────────────────────────────────────────────────────
  // Само испитаници са сагласношћу и псеудонимом. Име и корисничко име се не
  // извозе ни у једном облику.
  async function consenting() {
    const list = await db
      .select()
      .from(users)
      .where(and(eq(users.consentResearch, true), isNotNull(users.researchId)));
    return new Map(list.map((u) => [u.id, u]));
  }

  router.get("/admin/export/attempts.csv", async (_req, res) => {
    const people = await consenting();
    const ids = [...people.keys()];
    const list = ids.length
      ? await db
          .select()
          .from(attempts)
          .where(and(inArray(attempts.userId, ids), isNull(attempts.invalidatedAt)))
          .orderBy(asc(attempts.id))
      : [];
    const items = list.length
      ? await db.select().from(attemptItems).where(inArray(attemptItems.attemptId, list.map((a) => a.id)))
      : [];
    const rows = list.map((a) => {
      const p = people.get(a.userId)!;
      const mine = items.filter((i) => i.attemptId === a.id);
      const info = (a.clientInfo ?? {}) as { mobile?: boolean };
      return [
        CSV_VERSION,
        p.researchId,
        a.subjectId,
        p.classGroup,
        p.studyArm,
        p.rotationGroup,
        a.id,
        a.kind,
        a.phase,
        a.form,
        a.section,
        a.startedAt,
        a.submittedAt,
        a.durationMs,
        (a.questionIds as number[]).length,
        mine.filter((i) => i.answer !== null || i.submitted).length,
        mine.filter((i) => i.isCorrect).length,
        a.score,
        a.maxScore,
        a.maxScore ? Math.round(((a.score ?? 0) / a.maxScore) * 100) : null,
        typeof info.mobile === "boolean" ? info.mobile : null,
      ];
    });
    sendCsv(res, "pokusaji.csv", toCsv(ATTEMPT_COLUMNS, rows));
  });

  router.get("/admin/export/items.csv", async (_req, res) => {
    const people = await consenting();
    const ids = [...people.keys()];
    const rows = ids.length
      ? await db
          .select({ item: attemptItems, attempt: attempts, question: questions })
          .from(attemptItems)
          .innerJoin(attempts, eq(attempts.id, attemptItems.attemptId))
          .innerJoin(questions, eq(questions.id, attemptItems.questionId))
          .where(and(inArray(attempts.userId, ids), isNull(attempts.invalidatedAt)))
          .orderBy(asc(attempts.id), asc(attemptItems.position))
      : [];
    const data = rows.map(({ item, attempt, question }) => [
      CSV_VERSION,
      people.get(attempt.userId)!.researchId,
      attempt.subjectId,
      attempt.id,
      attempt.kind,
      attempt.phase,
      attempt.form,
      question.id,
      question.number,
      item.questionVersion,
      question.type,
      item.position,
      item.answer !== null,
      item.answer === null ? null : JSON.stringify(item.answer),
      item.isCorrect,
      item.points,
      question.points,
      item.timeMs,
      item.changes,
      item.answeredAt,
    ]);
    sendCsv(res, "zadaci.csv", toCsv(ITEM_COLUMNS, data));
  });

  router.get("/admin/export/events.csv", async (_req, res) => {
    const people = await consenting();
    const ids = [...people.keys()];
    const rows = ids.length
      ? await db
          .select({ event: events, subjectId: attempts.subjectId })
          .from(events)
          .innerJoin(attempts, eq(attempts.id, events.attemptId))
          .where(and(inArray(events.userId, ids), isNull(attempts.invalidatedAt)))
          .orderBy(asc(events.id))
      : [];
    const data = rows.map(({ event, subjectId }) => [
      CSV_VERSION,
      people.get(event.userId)!.researchId,
      subjectId,
      event.attemptId,
      event.questionId,
      event.type,
      event.at,
      event.value,
    ]);
    sendCsv(res, "dogadjaji.csv", toCsv(EVENT_COLUMNS, data));
  });

  return router;
}
