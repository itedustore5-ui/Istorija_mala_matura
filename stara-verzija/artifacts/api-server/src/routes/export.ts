import { Router, type IRouter } from "express";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { attemptItems, db, quizAttempts, users } from "@workspace/db";
import { csvHeaders, toCsv } from "../lib/csv";
import { MEASUREMENT_PHASES } from "../lib/study";
import { requireAdmin, requireAuth } from "../middlewares/auth";

/**
 * Извоз података за анализу.
 *
 * Три облика, јер се користе за различите ствари:
 *   широки   — један ред је један испитаник, фазе једна до друге (SPSS, jamovi)
 *   дуги     — један ред је један покушај (R, мешовити модели)
 *   по ставци — један ред је један задатак у једном покушају (тежина, дискриминативност)
 *
 * Правила која важе за сва три:
 *   • само уз сагласност, и никад име — само псеудоним
 *   • BOM на почетку, иначе Excel искриви ћирилицу (у `toCsv`)
 *   • број колона у заглављу и у редовима мора бити исти (проверава `toCsv`)
 *   • водеће =, +, -, @ се неутралишу (у `toCsv`)
 */
const router: IRouter = Router();

router.use("/export", requireAuth, requireAdmin);

/**
 * Извозе се само испитаници који су у студији И дали сагласност. Псеудоним је
 * обавезан: без њега ред не може да се извезе, јер би једини начин да се
 * препозна био по имену.
 */
async function consentingParticipants() {
  return db
    .select()
    .from(users)
    .where(and(isNotNull(users.studyArm), eq(users.consentResearch, true), isNotNull(users.researchId)))
    .orderBy(users.researchId);
}

/** Поништени покушаји не улазе у анализу. */
const validAttempts = () =>
  db.select().from(quizAttempts).where(isNull(quizAttempts.invalidatedAt));

// ── Широки облик ──────────────────────────────────────────────────────────
router.get("/export/wide.csv", async (_req, res) => {
  const participants = await consentingParticipants();
  const attempts = await validAttempts();

  const header = [
    "research_id",
    "class_group",
    "study_arm",
    "rotation_group",
    // Доза интервенције: без ње се може рећи само да је резултат опао, што би
    // се десило и без апликације, простим протоком времена.
    "practice_attempts",
    "practice_minutes",
    ...MEASUREMENT_PHASES.flatMap((p) => [
      `${p}_percentage`,
      `${p}_points`,
      `${p}_form`,
      `${p}_minutes`,
      `${p}_date`,
    ]),
  ];

  const rows = participants.map((p) => {
    const mine = attempts.filter((a) => a.userId === p.id);
    const practice = mine.filter((a) => a.examKey === null);

    const perPhase = MEASUREMENT_PHASES.flatMap((phase) => {
      const a = mine.find((x) => x.examKey !== null && x.phase === phase);
      return [
        a?.percentage ?? "",
        a?.pointsEarned ?? "",
        a?.form ?? "",
        a?.durationMs ? Math.round(a.durationMs / 60000) : "",
        a ? a.createdAt.toISOString().slice(0, 10) : "",
      ];
    });

    return [
      p.researchId,
      p.classGroup ?? "",
      p.studyArm ?? "",
      p.rotationGroup ?? "",
      practice.length,
      Math.round(practice.reduce((s, a) => s + (a.durationMs ?? 0), 0) / 60000),
      ...perPhase,
    ];
  });

  res.set(csvHeaders("siroki.csv")).send(toCsv(header, rows));
});

// ── Дуги облик ────────────────────────────────────────────────────────────
router.get("/export/long.csv", async (_req, res) => {
  const participants = await consentingParticipants();
  const byId = new Map(participants.map((p) => [p.id, p]));
  const attempts = await validAttempts();

  const header = [
    "research_id",
    "class_group",
    "study_arm",
    "rotation_group",
    "attempt_id",
    "kind",
    "phase",
    "form",
    "exam_key",
    "block",
    "score",
    "total",
    "percentage",
    "points_earned",
    "points_total",
    "duration_minutes",
    "started_at",
    "created_at",
  ];

  const rows = attempts
    .filter((a) => byId.has(a.userId))
    .map((a) => {
      const p = byId.get(a.userId)!;
      return [
        p.researchId,
        p.classGroup ?? "",
        p.studyArm ?? "",
        p.rotationGroup ?? "",
        a.id,
        a.examKey === null ? "vezbanje" : "merenje",
        a.phase ?? "",
        a.form ?? "",
        a.examKey ?? "",
        a.block ?? "",
        a.score,
        a.total,
        a.percentage,
        a.pointsEarned ?? "",
        a.pointsTotal ?? "",
        a.durationMs ? Math.round(a.durationMs / 60000) : "",
        a.startedAt ? a.startedAt.toISOString() : "",
        a.createdAt.toISOString(),
      ];
    });

  res.set(csvHeaders("dugi.csv")).send(toCsv(header, rows));
});

// ── По ставци ─────────────────────────────────────────────────────────────
// Највреднији облик: из њега се рачуна тежина сваке ставке, дискриминативност
// и — упоређивањем истих задатака кроз фазе — шта је заборављено.
router.get("/export/items.csv", async (_req, res) => {
  const participants = await consentingParticipants();
  const byId = new Map(participants.map((p) => [p.id, p]));

  const rows = await db
    .select({
      item: attemptItems,
      attempt: quizAttempts,
    })
    .from(attemptItems)
    .innerJoin(quizAttempts, eq(quizAttempts.id, attemptItems.attemptId))
    .where(isNull(quizAttempts.invalidatedAt));

  const header = [
    "research_id",
    "study_arm",
    "rotation_group",
    "attempt_id",
    "kind",
    "phase",
    "form",
    "exam_key",
    "question_id",
    "question_type",
    "block",
    "text_key",
    "position",
    "is_correct",
    "points_earned",
    "points_max",
    "time_spent_ms",
  ];

  const data = rows
    .filter((r) => byId.has(r.item.userId))
    .map(({ item, attempt }) => {
      const p = byId.get(item.userId)!;
      return [
        p.researchId,
        p.studyArm ?? "",
        p.rotationGroup ?? "",
        item.attemptId,
        attempt.examKey === null ? "vezbanje" : "merenje",
        attempt.phase ?? "",
        attempt.form ?? "",
        attempt.examKey ?? "",
        item.questionId,
        item.questionType,
        item.block ?? "",
        item.textKey ?? "",
        item.position ?? "",
        item.isCorrect ? 1 : 0,
        item.pointsEarned ?? "",
        item.pointsMax ?? "",
        item.timeSpentMs ?? "",
      ];
    });

  res.set(csvHeaders("po-stavci.csv")).send(toCsv(header, data));
});

export default router;
