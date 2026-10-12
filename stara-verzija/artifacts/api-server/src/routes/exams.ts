import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, quizAttempts } from "@workspace/db";
import { examByKey, examSummaries } from "../data/exams";
import { isScored } from "../data/types";
import { revealQuestion, sanitizeQuestion } from "../lib/scoring";
import { scoreExam, scoreExamAnswer } from "../lib/exam-scoring";
import { recordItems, sanitizeClientInfo } from "../lib/attempt-items";
import { assignedExam, canMeasure, getSettings, phaseForAttempt } from "../lib/study";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

/**
 * Мерење се разликује од вежбања свиме што га чини мерењем: ради се само кад
 * истраживач отвори термин, само онај тест који је том испитанику додељен
 * ротацијом, и само једном.
 *
 * Ако испитаник није у студији (нема грану), тестови остају обичне вежбе са
 * претходних испита и ништа од овога га не спречава.
 */
async function denyMeasurement(
  user: AuthedRequest["user"],
  examKey: string,
): Promise<{ status: number; message: string } | null> {
  if (user.role === "admin") return null;
  if (!user.studyArm) return null;

  const settings = await getSettings();

  const window = canMeasure(settings);
  if (!window.ok) return { status: 403, message: window.reason };

  const assigned = assignedExam(user, settings);
  if (!assigned) {
    return {
      status: 403,
      message: "Теби још није додељен тест за ову фазу. Јави се наставнику.",
    };
  }
  if (assigned.examKey !== examKey) {
    // Да испитаник може да узме туђу форму, уравнотежење би пало.
    return { status: 403, message: "Ово није тест који је теби додељен." };
  }

  const [already] = await db
    .select({ id: quizAttempts.id })
    .from(quizAttempts)
    .where(
      and(
        eq(quizAttempts.userId, user.id),
        eq(quizAttempts.examKey, examKey),
        eq(quizAttempts.phase, settings.currentPhase!),
        isNull(quizAttempts.invalidatedAt),
      ),
    )
    .limit(1);

  if (already) {
    // Кроз прво мерење се пролази само једном; понављање док не испадне добро
    // уништава податак.
    return { status: 409, message: "Овај тест си већ радио у овој фази." };
  }

  return null;
}

/** Листа тестова са претходних завршних испита. */
router.get("/exams", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user;
  const attempts = await db
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, user.id), isNotNull(quizAttempts.examKey)),
    )
    .orderBy(desc(quizAttempts.createdAt));

  res.json(
    examSummaries().map((exam) => {
      const mine = attempts.filter((a) => a.examKey === exam.key);
      return {
        ...exam,
        attemptsCount: mine.length,
        bestPoints:
          mine.length > 0
            ? Math.max(...mine.map((a) => Number(a.pointsEarned ?? 0)))
            : null,
      };
    }),
  );
});

router.get("/exams/:key", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user;
  const exam = examByKey(String(req.params.key));
  if (!exam) {
    res.status(404).json({ message: "Тест није пронађен." });
    return;
  }

  const denial = await denyMeasurement(user, exam.key);
  if (denial) {
    res.status(denial.status).json({ message: denial.message });
    return;
  }

  res.json({
    key: exam.key,
    year: exam.year,
    label: exam.label,
    term: exam.term,
    totalPoints: exam.totalPoints,
    durationMinutes: exam.durationMinutes,
    note: exam.note,
    texts: exam.texts,
    questions: exam.questions.map(sanitizeQuestion),
  });
});

router.post("/exams/:key/attempts", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthedRequest).user;
    const exam = examByKey(String(req.params.key));
    if (!exam) {
      res.status(404).json({ message: "Тест није пронађен." });
      return;
    }

    const denial = await denyMeasurement(user, exam.key);
    if (denial) {
      res.status(denial.status).json({ message: denial.message });
      return;
    }

    const settings = await getSettings();
    const assigned = assignedExam(user, settings);

    const body = req.body as {
      answers?: { questionId: number; answer: string; timeSpentMs?: number }[];
      startedAt?: string;
      durationMs?: number;
      clientInfo?: unknown;
    };
    const given = Array.isArray(body.answers) ? body.answers : [];

    const allowed = new Set(exam.questions.map((q) => q.id));
    if (given.some((a) => !allowed.has(a.questionId))) {
      res.status(400).json({ message: "Одговор не припада овом тесту." });
      return;
    }

    const answerMap = new Map(given.map((a) => [a.questionId, a.answer]));
    const { earned, total } = scoreExam(exam.questions, answerMap);
    const percentage = Math.round((earned / Math.max(total, 1)) * 100);

    const [attempt] = await db
      .insert(quizAttempts)
      .values({
        userId: user.id,
        examKey: exam.key,
        block: null,
        // score/total остају ради постојећих прегледа; мера испита су поени.
        score: Math.round(earned),
        total: Math.round(total),
        percentage,
        passed: percentage >= 50,
        pointsEarned: earned.toFixed(2),
        pointsTotal: total.toFixed(2),
        answers: given,
        // Фазу и форму уписује сервер; клијент их не шаље.
        phase: phaseForAttempt(settings, "exam"),
        form: assigned?.form ?? null,
        startedAt: body.startedAt ? new Date(body.startedAt) : null,
        durationMs: typeof body.durationMs === "number" ? Math.round(body.durationMs) : null,
        clientInfo: sanitizeClientInfo(body.clientInfo),
      })
      .returning();

    await recordItems(
      attempt!.id,
      user.id,
      exam.questions.map((q, i) => {
        const answer = answerMap.get(q.id) ?? "";
        const points = isScored(q) ? scoreExamAnswer(q, answer) : null;
        return {
          questionId: q.id,
          questionType: q.type,
          block: null,
          textKey: q.textKey ?? null,
          answerRaw: answer,
          isCorrect: points !== null && points >= q.points,
          pointsEarned: points,
          pointsMax: isScored(q) ? q.points : null,
          timeSpentMs: given.find((a) => a.questionId === q.id)?.timeSpentMs ?? null,
          position: i + 1,
        };
      }),
    );

    res.json({
      id: attempt!.id,
      pointsEarned: earned,
      pointsTotal: total,
      percentage,
      createdAt: attempt!.createdAt.toISOString(),
      reveal: exam.questions.map(revealQuestion),
      results: exam.questions.filter(isScored).map((q) => ({
        id: q.id,
        points: scoreExamAnswer(q, answerMap.get(q.id) ?? ""),
        maxPoints: q.points,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Greška pri upisu ispitnog pokušaja");
    res.status(500).json({ message: "Грешка при чувању резултата." });
  }
});

export default router;
