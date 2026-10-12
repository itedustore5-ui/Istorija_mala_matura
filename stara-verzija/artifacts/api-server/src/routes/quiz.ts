import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, quizAttempts, users } from "@workspace/db";
import { questions, questionById } from "../data/questions";
import { BLOCKS, blockOf, isBlockKey, isScored, type BlockKey } from "../data/types";
import { revealQuestion, sanitizeQuestion, scoreAnswer } from "../lib/scoring";
import { recordItems, sanitizeClientInfo } from "../lib/attempt-items";
import { canPractice, getSettings, phaseForAttempt } from "../lib/study";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const percent = (score: number, total: number) =>
  Math.round((score / Math.max(total, 1)) * 100);

const blockQuestions = (block: BlockKey) => questions.filter((q) => blockOf(q.id) === block);

async function practiceAttempts(userId: number) {
  return db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), isNull(quizAttempts.examKey)))
    .orderBy(desc(quizAttempts.createdAt));
}

// ── Структура збирке ──────────────────────────────────────────────────────
// Клијент не зна унапред колико задатака има која целина: збирка се допуњује,
// па би уграђена листа у фронтенду брзо престала да одговара стварности.
router.get("/catalog", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user;
  const attempts = await practiceAttempts(user.id);
  const settings = await getSettings();

  // Каталог се приказује и кад вежбање није допуштено, али са разлогом —
  // ученик треба да зна зашто, а не да наиђе на празан екран.
  const practice = canPractice(user, settings);

  res.json({
    practiceAllowed: practice.ok,
    practiceReason: practice.ok ? null : practice.reason,
    blocks: BLOCKS.map((block) => {
      const list = blockQuestions(block.key);
      // Најбољи резултат се чита из покушаја баш те целине, а не из
      // „најбољег укупног“ покушаја: целине се вежбају одвојено, па најбољи
      // укупни покушај по правилу и не садржи тражену целину.
      const mine = attempts.filter((a) => a.block === block.key);
      return {
        key: block.key,
        label: block.label,
        pages: block.pages,
        questionCount: list.length,
        scoredCount: list.filter(isScored).length,
        bestScore: mine.length > 0 ? Math.max(...mine.map((a) => a.percentage)) : null,
        attemptsCount: mine.length,
      };
    }),
  });
});

// ── Задаци за вежбање ─────────────────────────────────────────────────────
router.get("/questions", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user;
  const settings = await getSettings();

  // Иста провера као при предаји: без ње би контролна грана могла да вежба
  // тако што сама позове ову путању.
  const allowedToPractice = canPractice(user, settings);
  if (!allowedToPractice.ok) {
    res.status(403).json({ message: allowedToPractice.reason });
    return;
  }

  const { block } = req.query as Record<string, string | undefined>;
  if (!isBlockKey(block)) {
    res.status(400).json({ message: "Потребно је изабрати целину збирке." });
    return;
  }

  res.json(blockQuestions(block).map((q) => sanitizeQuestion(q)));
});

// ── Провера једног одговора ───────────────────────────────────────────────
// Вежбање иде задатак по задатак: ученик одговори, одмах види да ли је тачно и
// зашто, па прелази на следећи. Ова рута зато не уписује покушај — покушај се
// уписује тек кад се целина заврши, преко `/attempts`. Да свака провера пише у
// базу, једно вежбање од двадесет задатака било би двадесет покушаја и просек
// на прегледу не би значио ништа.
//
// Провера гране мора да стоји и овде, не само на `/questions` и `/attempts`.
// Ова рута враћа `revealQuestion` — тачан одговор и објашњење. Без провере би
// контролна грана прошла кроз све бројеве задатака и прочитала цело решење, па
// би добила исти третман као експериментална и поређење би нестало.
router.post("/check", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user;
  const allowedToPractice = canPractice(user, await getSettings());
  if (!allowedToPractice.ok) {
    res.status(403).json({ message: allowedToPractice.reason });
    return;
  }

  const body = req.body as { questionId?: number; answer?: string };
  const question = questionById(Number(body.questionId));

  if (!question) {
    res.status(404).json({ message: "Задатак није пронађен." });
    return;
  }

  const answer = typeof body.answer === "string" ? body.answer : "";

  res.json({
    id: question.id,
    scored: isScored(question),
    // Задаци слободног одговора немају тачан одговор који се може проверити,
    // па се враћа null — ученик сам процењује уз приказани модел одговора.
    correct: isScored(question) ? scoreAnswer(question, answer) : null,
    reveal: revealQuestion(question),
  });
});

// ── Предаја одговора ──────────────────────────────────────────────────────
router.post("/attempts", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthedRequest).user;
    const settings = await getSettings();

    // Скривање дугмета није заштита: контролна грана овде добија 403, ма како
    // до путање дошла.
    const allowedToPractice = canPractice(user, settings);
    if (!allowedToPractice.ok) {
      res.status(403).json({ message: allowedToPractice.reason });
      return;
    }

    const body = req.body as {
      answers?: { questionId: number; answer: string; timeSpentMs?: number }[];
      startedAt?: string;
      durationMs?: number;
      clientInfo?: unknown;
    };

    const given = Array.isArray(body.answers) ? body.answers : [];
    if (given.length === 0) {
      res.status(400).json({ message: "Нема предатих одговора." });
      return;
    }

    // Целина се чита из збирке — из броја првог задатка — и проверава се да
    // сви остали одговори припадају истој целини. Да се узима из тела захтева,
    // ученик би свој резултат уписао у било коју целину.
    const first = questionById(Number(given[0]!.questionId));
    const block = first ? blockOf(first.id) : null;
    if (!first || !block) {
      res.status(400).json({ message: "Непознат задатак." });
      return;
    }

    const relevant = blockQuestions(block);
    const allowed = new Set(relevant.map((q) => q.id));
    if (given.some((a) => !allowed.has(Number(a.questionId)))) {
      res.status(400).json({ message: "Одговори не припадају истој целини задатака." });
      return;
    }

    const answerMap = new Map(
      given.map((a) => [Number(a.questionId), typeof a.answer === "string" ? a.answer : ""]),
    );

    const scored = relevant.filter(isScored);
    const score = scored.reduce(
      (acc, q) => acc + (scoreAnswer(q, answerMap.get(q.id) ?? "") ? 1 : 0),
      0,
    );
    const total = scored.length;
    const percentage = percent(score, total);

    const [attempt] = await db
      .insert(quizAttempts)
      .values({
        userId: user.id,
        examKey: null,
        block,
        score,
        total,
        percentage,
        passed: percentage >= 50,
        answers: given,
        // Фазу уписује сервер из подешавања студије, никад клијент: иначе би
        // ученик свој рад прогласио којом хоће фазом.
        phase: phaseForAttempt(settings, "practice"),
        startedAt: body.startedAt ? new Date(body.startedAt) : null,
        durationMs: typeof body.durationMs === "number" ? Math.round(body.durationMs) : null,
        clientInfo: sanitizeClientInfo(body.clientInfo),
      })
      .returning();

    // Резултат по задатку — оно из чега се после чита шта је заборављено.
    // Уписује се за сваки задатак целине, и за прескочене (празан одговор), да
    // се зна шта је ученик видео.
    await recordItems(
      attempt!.id,
      user.id,
      relevant.map((q, i) => {
        const answer = answerMap.get(q.id) ?? "";
        return {
          questionId: q.id,
          questionType: q.type,
          block,
          answerRaw: answer,
          isCorrect: isScored(q) ? scoreAnswer(q, answer) : false,
          timeSpentMs: given.find((a) => Number(a.questionId) === q.id)?.timeSpentMs ?? null,
          position: i + 1,
        };
      }),
    );

    // Тек сада, пошто је одговор уписан, клијент сме да добије тачне одговоре.
    res.json({
      id: attempt!.id,
      score,
      total,
      percentage,
      passed: attempt!.passed,
      createdAt: attempt!.createdAt.toISOString(),
      reveal: relevant.map(revealQuestion),
      results: scored.map((q) => ({
        id: q.id,
        correct: scoreAnswer(q, answerMap.get(q.id) ?? ""),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Greška pri upisu pokušaja");
    res.status(500).json({ message: "Грешка при чувању резултата." });
  }
});

// ── Преглед напретка ──────────────────────────────────────────────────────
router.get("/dashboard", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user;
  const attempts = await practiceAttempts(user.id);

  // Урађени задаци и укупан број морају бити исти скуп — задаци из збирке.
  // Ред у одговорима који не показује на задатак збирке се не броји.
  const solved = new Set<number>();
  for (const attempt of attempts) {
    for (const a of attempt.answers as { questionId: number }[]) {
      if (questionById(Number(a.questionId))) solved.add(Number(a.questionId));
    }
  }

  res.json({
    attemptsCount: attempts.length,
    bestScore: attempts.reduce((max, a) => Math.max(max, a.percentage), 0),
    lastScore: attempts[0]?.percentage ?? null,
    solvedCount: solved.size,
    questionCount: questions.length,
    blockScores: BLOCKS.map((block) => {
      const matching = attempts.filter((a) => a.block === block.key);
      return {
        key: block.key,
        label: block.label,
        attemptsCount: matching.length,
        bestScore:
          matching.length > 0 ? Math.max(...matching.map((a) => a.percentage)) : null,
      };
    }),
  });
});

router.get("/scoreboard", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user;
  const { block } = req.query as Record<string, string | undefined>;
  const wanted = isBlockKey(block) ? block : null;

  const matches = (a: { block: string | null }) => !wanted || a.block === wanted;

  const rowFor = (
    u: { username: string; fullName: string },
    list: { percentage: number; block: string | null }[],
  ) => {
    const filtered = list.filter(matches);
    return {
      username: u.username,
      fullName: u.fullName,
      bestScore:
        filtered.length > 0 ? filtered.reduce((max, a) => Math.max(max, a.percentage), 0) : 0,
      attemptsCount: filtered.length,
      lastScore: filtered[0]?.percentage ?? null,
    };
  };

  if (user.role === "student") {
    const attempts = await practiceAttempts(user.id);
    res.json([{ rank: 1, ...rowFor(user, attempts) }]);
    return;
  }

  const allUsers = await db
    .select()
    .from(users)
    .where(and(eq(users.active, true), eq(users.role, "student")));
  const allAttempts = await db
    .select()
    .from(quizAttempts)
    .where(isNull(quizAttempts.examKey))
    .orderBy(desc(quizAttempts.createdAt));

  const rows = allUsers
    .map((u) => rowFor(u, allAttempts.filter((a) => a.userId === u.id)))
    .sort((a, b) => b.bestScore - a.bestScore || a.fullName.localeCompare(b.fullName, "sr"))
    .map((entry, index) => ({ rank: index + 1, ...entry }));

  res.json(rows);
});

export default router;
