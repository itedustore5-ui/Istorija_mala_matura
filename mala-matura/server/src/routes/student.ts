import { Router } from "express";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  attemptItems,
  attempts,
  events,
  images,
  questions,
  subjects,
  tests,
  type Attempt,
  type QuestionRow,
} from "../db/schema.js";
import { currentUser, requireAuth } from "../auth.js";
import { scoreAnswer, type QuestionType } from "../scoring.js";
import { revealQuestion, toPublicQuestion } from "../sanitize.js";
import { assignTest, canPractice, canPracticeTests, getSettings } from "../study.js";

/** Бодовање задатка из базе — увек кроз `scoreAnswer`, са правилом делимичних бодова. */
const score = (q: QuestionRow, answer: unknown) =>
  scoreAnswer({ type: q.type as QuestionType, correct: q.correct, points: q.points, partial: q.partialCredit }, answer);

const percentOf = (score: number | null, max: number | null) =>
  Math.round(((score ?? 0) / (max || 1)) * 100);

/**
 * Руте за ученика: предмети, вежбање, мерење, телеметрија.
 *
 * Тачан одговор и објашњење излазе САМО из рута које се завршавају на
 * `/submit`, и то пошто је одговор уписан. Све остале руте шаљу задатак кроз
 * `toPublicQuestion`.
 */

const HOUR = 60 * 60 * 1000;
const saneMs = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= HOUR ? Math.round(v) : null;
const saneCount = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10_000 ? v : 0;

/** Од уређаја се чува само оно што треба за тумачење. IP адреса се не бележи. */
function clientInfo(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof src.mobile === "boolean") out.mobile = src.mobile;
  if (typeof src.screen === "string") out.screen = src.screen.slice(0, 20);
  return Object.keys(out).length ? out : null;
}

async function questionsByIds(db: Db, ids: number[]): Promise<QuestionRow[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(questions).where(inArray(questions.id, ids));
  const byId = new Map(rows.map((q) => [q.id, q]));
  return ids.map((id) => byId.get(id)).filter((q): q is QuestionRow => Boolean(q));
}

export function studentRoutes(db: Db): Router {
  const router = Router();
  const auth = requireAuth(db);

  // Слике уз задатке су јавне: исте су као у штампаној збирци, а `<img>` не
  // шаље токен за пријаву.
  router.get("/images/:name", async (req, res) => {
    const [img] = await db.select().from(images).where(eq(images.name, String(req.params.name)));
    if (!img) {
      res.status(404).json({ message: "Слика не постоји." });
      return;
    }
    res.setHeader("Content-Type", img.mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(Buffer.from(img.data));
  });

  // ── Предмети и целине ────────────────────────────────────────────────────
  router.get("/subjects", auth, async (req, res) => {
    const user = currentUser(req);
    const settings = await getSettings(db);
    const practice = canPractice(user, settings);

    const testPractice = canPracticeTests(user, settings);

    const allSubjects = await db.select().from(subjects).orderBy(asc(subjects.position), asc(subjects.name));
    // Целине збирке; задаци тестова са завршног испита имају своју листу.
    const active = await db
      .select({ subjectId: questions.subjectId, section: questions.section })
      .from(questions)
      .where(and(eq(questions.active, true), isNull(questions.testKey)));
    const allTests = await db.select().from(tests).orderBy(asc(tests.position), asc(tests.year));
    const testQuestions = await db
      .select({ testKey: questions.testKey })
      .from(questions)
      .where(and(eq(questions.active, true), isNotNull(questions.testKey)));
    const mine = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, user.id), eq(attempts.kind, "vezbanje"), isNotNull(attempts.submittedAt)));

    const result = [];
    for (const s of allSubjects) {
      const test = await assignTest(db, user, s.id, settings);
      const declared = Array.isArray(s.sections) ? (s.sections as { key: string; label?: string; pages?: string }[]) : [];
      const keys = [...new Set(active.filter((a) => a.subjectId === s.id).map((a) => a.section))];
      // Редослед целина прати збирку (списак у предмету); целина која није у
      // списку (додата у админу) иде на крај.
      const ordered = [
        ...declared.filter((d) => keys.includes(d.key)),
        ...keys.filter((k) => !declared.some((d) => d.key === k)).map((k) => ({ key: k })),
      ];
      result.push({
        id: s.id,
        name: s.name,
        source: s.source,
        practice: practice.ok ? { ok: true } : { ok: false, reason: practice.reason },
        test: test.ok
          ? { available: true, phase: test.assignment.phase }
          : { available: false, reason: test.reason },
        sections: ordered.map((d) => {
          const done = mine.filter((a) => a.subjectId === s.id && a.section === d.key && a.maxScore);
          return {
            key: d.key,
            label: (d as { label?: string }).label ?? d.key,
            pages: (d as { pages?: string }).pages ?? null,
            questionCount: active.filter((a) => a.subjectId === s.id && a.section === d.key).length,
            attempts: done.length,
            bestPercent: done.length ? Math.max(...done.map((a) => percentOf(a.score, a.maxScore))) : null,
          };
        }),
        // Ученик у истраживању тестове не види ни као листу: то су форме мерења.
        tests: testPractice.ok
          ? allTests
              .filter((t) => t.subjectId === s.id)
              .map((t) => {
                const done = mine.filter((a) => a.section === t.key && a.maxScore);
                return {
                  key: t.key,
                  label: t.label,
                  year: t.year,
                  questionCount: testQuestions.filter((q) => q.testKey === t.key).length,
                  attempts: done.length,
                  bestPercent: done.length ? Math.max(...done.map((a) => percentOf(a.score, a.maxScore))) : null,
                };
              })
              .filter((t) => t.questionCount > 0)
          : [],
      });
    }
    res.json(result);
  });

  // ── Вежбање ──────────────────────────────────────────────────────────────
  /**
   * Почетак вежбања: целина збирке (`subjectId` + `section`) или цео тест са
   * завршног испита (`testKey`). За тест важи строжа провера — ученик у
   * истраживању не сме да вежба форме мерења.
   */
  router.post("/practice/start", auth, async (req, res) => {
    const user = currentUser(req);
    const settings = await getSettings(db);
    const body = (req.body ?? {}) as { subjectId?: unknown; section?: unknown; testKey?: unknown };

    let subjectId: string;
    let section: string;
    let list: QuestionRow[];
    let title: string;

    if (typeof body.testKey === "string") {
      const allowed = canPracticeTests(user, settings);
      if (!allowed.ok) {
        res.status(403).json({ message: allowed.reason });
        return;
      }
      const [test] = await db.select().from(tests).where(eq(tests.key, body.testKey));
      if (!test) {
        res.status(404).json({ message: "Тест није пронађен." });
        return;
      }
      subjectId = test.subjectId;
      section = test.key;
      title = test.label;
      list = await db
        .select()
        .from(questions)
        .where(and(eq(questions.testKey, test.key), eq(questions.active, true)))
        .orderBy(asc(questions.number));
    } else {
      const allowed = canPractice(user, settings);
      if (!allowed.ok) {
        res.status(403).json({ message: allowed.reason });
        return;
      }
      if (typeof body.subjectId !== "string" || typeof body.section !== "string") {
        res.status(400).json({ message: "Изабери предмет и целину." });
        return;
      }
      subjectId = body.subjectId;
      section = body.section;
      title = section;
      list = await db
        .select()
        .from(questions)
        .where(
          and(
            eq(questions.subjectId, subjectId),
            eq(questions.section, section),
            isNull(questions.testKey),
            eq(questions.active, true),
          ),
        )
        .orderBy(asc(questions.number));
    }

    if (list.length === 0) {
      res.status(404).json({ message: "Овде нема задатака." });
      return;
    }
    const [attempt] = await db
      .insert(attempts)
      .values({
        userId: user.id,
        subjectId,
        kind: "vezbanje",
        section,
        phase: settings.currentPhase,
        questionIds: list.map((q) => q.id),
        clientInfo: clientInfo((req.body as { clientInfo?: unknown }).clientInfo),
      })
      .returning();
    res.json({
      attempt: { id: attempt!.id, kind: "vezbanje", section, title, total: list.length },
      questions: list.map(toPublicQuestion),
    });
  });

  /** Покушај сме да дира само његов власник, и само док није предат. */
  async function ownAttempt(userId: number, id: number): Promise<Attempt | null> {
    const [a] = await db.select().from(attempts).where(and(eq(attempts.id, id), eq(attempts.userId, userId)));
    return a ?? null;
  }

  /**
   * Провера једног задатка у вежбању. Први предати одговор се рачуна: поновна
   * предаја истог задатка враћа већ уписан резултат, да се тачан одговор не би
   * „погађао“ док не испадне тачно.
   */
  router.post("/attempts/:id/questions/:questionId/submit", auth, async (req, res) => {
    const user = currentUser(req);
    const attempt = await ownAttempt(user.id, Number(req.params.id));
    if (!attempt || attempt.kind !== "vezbanje") {
      res.status(404).json({ message: "Вежбање није пронађено." });
      return;
    }
    if (attempt.submittedAt) {
      res.status(409).json({ message: "Ово вежбање је већ завршено." });
      return;
    }
    const questionId = Number(req.params.questionId);
    const ids = attempt.questionIds as number[];
    const position = ids.indexOf(questionId);
    if (position === -1) {
      res.status(400).json({ message: "Задатак не припада овом вежбању." });
      return;
    }
    const [question] = await db.select().from(questions).where(eq(questions.id, questionId));
    if (!question) {
      res.status(404).json({ message: "Задатак није пронађен." });
      return;
    }
    // Право се проверава и овде, а не само на почетку: ова рута враћа кључ.
    // За задатак теста важи строжа провера — ко је у међувремену уписан у
    // истраживање, не сме да прочита кључ форме мерења.
    const settings = await getSettings(db);
    const allowed = question.testKey ? canPracticeTests(user, settings) : canPractice(user, settings);
    if (!allowed.ok) {
      res.status(403).json({ message: allowed.reason });
      return;
    }

    const [existing] = await db
      .select()
      .from(attemptItems)
      .where(and(eq(attemptItems.attemptId, attempt.id), eq(attemptItems.questionId, questionId)));
    if (existing?.submitted) {
      res.json({
        questionId,
        alreadySubmitted: true,
        answer: existing.answer,
        isCorrect: existing.isCorrect,
        points: existing.points,
        ...revealQuestion(question),
      });
      return;
    }

    const body = (req.body ?? {}) as { answer?: unknown; timeMs?: unknown; changes?: unknown };
    const result = score(question, body.answer);
    await db
      .insert(attemptItems)
      .values({
        attemptId: attempt.id,
        questionId,
        questionVersion: question.version,
        position: position + 1,
        answer: body.answer ?? null,
        isCorrect: result.isCorrect,
        points: result.points,
        timeMs: saneMs(body.timeMs),
        changes: saneCount(body.changes),
        answeredAt: new Date(),
        submitted: true,
      })
      .onConflictDoUpdate({
        target: [attemptItems.attemptId, attemptItems.questionId],
        set: {
          answer: body.answer ?? null,
          isCorrect: result.isCorrect,
          points: result.points,
          timeMs: saneMs(body.timeMs),
          changes: saneCount(body.changes),
          answeredAt: new Date(),
          submitted: true,
        },
      });

    res.json({
      questionId,
      alreadySubmitted: false,
      answer: body.answer ?? null,
      isCorrect: result.isCorrect,
      points: result.points,
      ...revealQuestion(question),
    });
  });

  /** Крај вежбања: покушај се затвара и сабира. Тачни одговори се овде не шаљу. */
  router.post("/attempts/:id/finish", auth, async (req, res) => {
    const user = currentUser(req);
    const attempt = await ownAttempt(user.id, Number(req.params.id));
    if (!attempt || attempt.kind !== "vezbanje") {
      res.status(404).json({ message: "Вежбање није пронађено." });
      return;
    }
    const summary = await closeAttempt(attempt, req.body);
    res.json(summary);
  });

  async function closeAttempt(attempt: Attempt, body: unknown) {
    const ids = attempt.questionIds as number[];
    const items = await db.select().from(attemptItems).where(eq(attemptItems.attemptId, attempt.id));
    const qs = await questionsByIds(db, ids);
    const maxScore = qs.reduce((sum, q) => sum + q.points, 0);
    const score = items.reduce((sum, i) => sum + (i.points ?? 0), 0);
    const answered = items.filter((i) => i.submitted || i.answer !== null).length;
    if (!attempt.submittedAt) {
      const now = new Date();
      await db
        .update(attempts)
        .set({
          submittedAt: now,
          score,
          maxScore,
          durationMs: Math.min(now.getTime() - attempt.startedAt.getTime(), 2_147_000_000),
          clientInfo: attempt.clientInfo ?? clientInfo((body as { clientInfo?: unknown } | null)?.clientInfo),
        })
        .where(eq(attempts.id, attempt.id));
    }
    return {
      attemptId: attempt.id,
      score,
      maxScore,
      answered,
      total: ids.length,
      percentage: Math.round((score / (maxScore || 1)) * 100),
    };
  }

  // ── Мерење (T0–T3) ───────────────────────────────────────────────────────
  router.post("/tests/start", auth, async (req, res) => {
    const user = currentUser(req);
    const { subjectId } = (req.body ?? {}) as { subjectId?: string };
    if (typeof subjectId !== "string") {
      res.status(400).json({ message: "Изабери предмет." });
      return;
    }
    const settings = await getSettings(db);
    const decision = await assignTest(db, user, subjectId, settings);
    if (!decision.ok) {
      res.status(decision.status).json({ message: decision.reason });
      return;
    }
    const { phase, form, questionIds } = decision.assignment;

    // Започет, а непредат тест се наставља (пукла веза, затворен прозор).
    const [open] = await db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.userId, user.id),
          eq(attempts.subjectId, subjectId),
          eq(attempts.kind, "merenje"),
          eq(attempts.phase, phase),
          isNull(attempts.submittedAt),
          isNull(attempts.invalidatedAt),
        ),
      )
      .limit(1);

    let attempt = open;
    if (!attempt) {
      [attempt] = await db
        .insert(attempts)
        .values({
          userId: user.id,
          subjectId,
          kind: "merenje",
          phase,
          form,
          questionIds,
          clientInfo: clientInfo((req.body as { clientInfo?: unknown }).clientInfo),
        })
        .returning();
    }

    const qs = await questionsByIds(db, attempt!.questionIds as number[]);
    const saved = await db.select().from(attemptItems).where(eq(attemptItems.attemptId, attempt!.id));
    res.json({
      attempt: { id: attempt!.id, kind: "merenje", phase, form, total: qs.length },
      questions: qs.map(toPublicQuestion),
      answers: Object.fromEntries(saved.map((s) => [s.questionId, s.answer])),
    });
  });

  /** Чување одговора током мерења — без повратне информације. */
  router.put("/attempts/:id/answers/:questionId", auth, async (req, res) => {
    const user = currentUser(req);
    const attempt = await ownAttempt(user.id, Number(req.params.id));
    if (!attempt || attempt.kind !== "merenje" || attempt.invalidatedAt) {
      res.status(404).json({ message: "Провера није пронађена." });
      return;
    }
    if (attempt.submittedAt) {
      res.status(409).json({ message: "Провера је већ предата." });
      return;
    }
    const questionId = Number(req.params.questionId);
    const position = (attempt.questionIds as number[]).indexOf(questionId);
    if (position === -1) {
      res.status(400).json({ message: "Задатак не припада овој провери." });
      return;
    }
    const [question] = await db.select().from(questions).where(eq(questions.id, questionId));
    const body = (req.body ?? {}) as { answer?: unknown; timeMs?: unknown; changes?: unknown };
    await db
      .insert(attemptItems)
      .values({
        attemptId: attempt.id,
        questionId,
        questionVersion: question!.version,
        position: position + 1,
        answer: body.answer ?? null,
        timeMs: saneMs(body.timeMs),
        changes: saneCount(body.changes),
        answeredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [attemptItems.attemptId, attemptItems.questionId],
        set: {
          answer: body.answer ?? null,
          timeMs: saneMs(body.timeMs),
          changes: saneCount(body.changes),
          answeredAt: new Date(),
        },
      });
    res.json({ saved: true });
  });

  /**
   * Предаја мерења. Бодује се овде, једном, из сачуваних одговора.
   *
   * Тачни одговори се после мерења НЕ приказују: форма из T0 понавља се у T3
   * (види `study.ts`), па би приказ кључа после T0 научио ученика баш тим
   * задацима и мерење задржавања би пало. Кад се учење и мерење сукобе,
   * предност има мерење.
   */
  router.post("/attempts/:id/submit", auth, async (req, res) => {
    const user = currentUser(req);
    const attempt = await ownAttempt(user.id, Number(req.params.id));
    if (!attempt || attempt.kind !== "merenje" || attempt.invalidatedAt) {
      res.status(404).json({ message: "Провера није пронађена." });
      return;
    }
    if (!attempt.submittedAt) {
      const ids = attempt.questionIds as number[];
      const qs = await questionsByIds(db, ids);
      const saved = await db.select().from(attemptItems).where(eq(attemptItems.attemptId, attempt.id));
      for (const [i, q] of qs.entries()) {
        const item = saved.find((s) => s.questionId === q.id);
        const result = score(q, item?.answer ?? null);
        await db
          .insert(attemptItems)
          .values({
            attemptId: attempt.id,
            questionId: q.id,
            questionVersion: q.version,
            position: i + 1,
            answer: null,
            isCorrect: result.isCorrect,
            points: result.points,
            submitted: true,
          })
          .onConflictDoUpdate({
            target: [attemptItems.attemptId, attemptItems.questionId],
            set: { isCorrect: result.isCorrect, points: result.points, submitted: true },
          });
      }
    }
    const [fresh] = await db.select().from(attempts).where(eq(attempts.id, attempt.id));
    const summary = await closeAttempt(fresh!, req.body);
    res.json({ ...summary, phase: attempt.phase, form: attempt.form });
  });

  // ── Телеметрија ──────────────────────────────────────────────────────────
  const EVENT_TYPES = new Set(["view", "answer", "hide", "show", "check", "finish"]);

  router.post("/telemetry", auth, async (req, res) => {
    const user = currentUser(req);
    const list = Array.isArray((req.body as { events?: unknown })?.events)
      ? ((req.body as { events: unknown[] }).events.slice(0, 200) as Record<string, unknown>[])
      : [];
    const attemptIds = [...new Set(list.map((e) => Number(e.attemptId)).filter(Number.isInteger))];
    const owned = attemptIds.length
      ? await db
          .select({ id: attempts.id })
          .from(attempts)
          .where(and(eq(attempts.userId, user.id), inArray(attempts.id, attemptIds)))
      : [];
    const ok = new Set(owned.map((a) => a.id));
    const rows = list
      .filter((e) => EVENT_TYPES.has(String(e.type)) && ok.has(Number(e.attemptId)))
      .map((e) => {
        const at = new Date(String(e.at));
        return {
          attemptId: Number(e.attemptId),
          userId: user.id,
          questionId: Number.isInteger(Number(e.questionId)) ? Number(e.questionId) : null,
          type: String(e.type),
          at: Number.isNaN(at.getTime()) ? new Date() : at,
          value: e.value === undefined ? null : JSON.parse(JSON.stringify(e.value).slice(0, 500) || "null"),
        };
      });
    if (rows.length) await db.insert(events).values(rows);
    res.json({ stored: rows.length });
  });

  return router;
}
