/**
 * Проверава тестове са претходних завршних испита:
 *   1. да збир поена задатака одговара пријављеном укупном броју поена,
 *   2. да тачно решен тест носи максималан број поена, а празан ниједан,
 *   3. да делимично тачан одговор носи мање од максимума, али више од нуле,
 *   4. да у ономе што иде клијенту нема тачних одговора.
 *
 * Провера 1 хвата грешку која се иначе примети тек кад ученик преда тест:
 * ако при уносу теста промакне један задатак, укупан број поена се не поклапа,
 * а проценат који ученик види је нетачан за све који су тест већ радили.
 */
import { exams } from "../src/data/exams";
import { isScored, type Question } from "../src/data/types";
import { sanitizeQuestion } from "../src/lib/scoring";
import { scoreExam, scoreExamAnswer } from "../src/lib/exam-scoring";

const problems: string[] = [];

function correctAnswerFor(q: Question): string | null {
  switch (q.type) {
    case "single":
      return String(q.correctAnswer);
    case "multi":
      return q.correctAnswers.join(",");
    case "fill":
      return q.fields.map((f) => f.accepted[0]).join("|");
    case "match":
      return q.correctPairs.join(",");
    case "order":
      return q.correctOrder.join(",");
    case "tf":
      return q.correct.map((v) => (v ? "T" : "N")).join(",");
    case "pick":
      return q.correctTokens.join(",");
    default:
      return null;
  }
}

const FORBIDDEN_KEYS = [
  "correctAnswer",
  "correctAnswers",
  "correctPairs",
  "correctOrder",
  "correctTokens",
  "correct",
  "accepted",
  "acceptable",
  "unacceptable",
  "explanation",
  "standard",
];

for (const exam of exams) {
  const fail = (message: string) => problems.push(`${exam.key}: ${message}`);

  const ids = new Set<number>();
  for (const q of exam.questions) {
    if (ids.has(q.id)) fail(`број задатка ${q.id} се понавља`);
    ids.add(q.id);
    if (q.textKey && !exam.texts.some((t) => t.key === q.textKey))
      fail(`задатак ${q.id} тражи текст „${q.textKey}“ којег нема у тесту`);
  }

  const sum = exam.questions.filter(isScored).reduce((acc, q) => acc + q.points, 0);
  if (Math.abs(sum - exam.totalPoints) > 0.001)
    fail(`збир поена је ${sum}, а тест је пријављен као ${exam.totalPoints}`);

  const full = new Map<number, string>();
  for (const q of exam.questions) {
    const a = correctAnswerFor(q);
    if (a !== null) full.set(q.id, a);
  }

  const perfect = scoreExam(exam.questions, full);
  if (Math.abs(perfect.earned - perfect.total) > 0.001)
    fail(`тачно решен тест носи ${perfect.earned} од ${perfect.total} поена`);

  const empty = scoreExam(exam.questions, new Map());
  if (empty.earned !== 0) fail("празан тест носи поене");

  for (const q of exam.questions) {
    if (!isScored(q)) continue;

    // Делимично тачан одговор: изостави једну ставку тамо где то има смисла.
    if (q.type === "multi" && q.correctAnswers.length > 1) {
      const partial = q.correctAnswers.slice(0, -1).join(",");
      const got = scoreExamAnswer(q, partial);
      if (got <= 0 || got >= q.points)
        fail(`задатак ${q.id}: делимично тачан одговор носи ${got} од ${q.points}`);
    }
    if (q.type === "tf" && q.correct.length > 1) {
      const partial = q.correct
        .map((v, i) => (i === 0 ? (v ? "N" : "T") : v ? "T" : "N"))
        .join(",");
      const got = scoreExamAnswer(q, partial);
      if (got >= q.points)
        fail(`задатак ${q.id}: одговор са грешком носи пун број поена`);
    }

    const sanitized = sanitizeQuestion(q) as Record<string, unknown>;
    for (const key of FORBIDDEN_KEYS)
      if (key in sanitized) fail(`задатак ${q.id}: поље „${key}“ стиже клијенту`);
  }
}

if (exams.length === 0) {
  console.log("Још није унет ниједан тест са претходних завршних испита.");
  console.log("Тестови се уносе са: node scripts/import-exam.mjs <fajl.json>");
} else {
  console.log(`Тестова: ${exams.length}`);
  for (const e of exams) {
    console.log(
      `  ${e.label} — ${e.questions.length} задатака, ${e.totalPoints} поена`,
    );
  }
}

if (problems.length > 0) {
  console.error(`\nНађено ${problems.length} проблема:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("\nСве провере су прошле.");
