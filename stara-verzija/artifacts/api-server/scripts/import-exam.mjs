/**
 * Уноси тест са претходног завршног испита из JSON фајла.
 *
 *   node scripts/import-exam.mjs ../../testovi/zavrsni-2025.json
 *
 * Скрипта прави `src/data/exams/<key>.ts` и дописује га у `src/data/exams/index.ts`.
 * Пише се фајл, а не ред у бази, зато што су тестови непроменљив садржај: ако
 * стоје у бази, копија за наставу и копија за развој се разиђу, а стари
 * покушаји почну да показују на задатке којих више нема.
 *
 * Очекивани облик JSON-a:
 * {
 *   "key": "zavrsni-2025-jun",
 *   "year": 2025,
 *   "label": "Завршни испит 2025.",
 *   "term": "јунски",
 *   "totalPoints": 20,
 *   "durationMinutes": 120,
 *   "texts": [{ "key": "...", "title": "...", "author": "...", "body": ["..."] }],
 *   "questions": [ ... исти облик као у src/data/questions ... ]
 * }
 *
 * Бројеви задатака (`id`) морају бити јединствени у оквиру теста и не смеју се
 * мењати пошто неко тест одради — уписани су у сачуване покушаје.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const examsDir = path.resolve(here, "../src/data/exams");

const input = process.argv[2];
if (!input) {
  console.error("Употреба: node scripts/import-exam.mjs <fajl.json>");
  process.exit(1);
}

const raw = fs.readFileSync(path.resolve(process.cwd(), input), "utf8");
const exam = JSON.parse(raw);

for (const field of ["key", "year", "label", "totalPoints", "questions"]) {
  if (exam[field] === undefined) {
    console.error(`Недостаје поље „${field}“.`);
    process.exit(1);
  }
}

if (!/^[a-z0-9-]+$/.test(exam.key)) {
  console.error("Кључ теста сме да садржи само мала слова, цифре и цртице.");
  process.exit(1);
}

const ids = new Set();
for (const q of exam.questions) {
  if (ids.has(q.id)) {
    console.error(`Број задатка ${q.id} се понавља.`);
    process.exit(1);
  }
  ids.add(q.id);
  q.points ??= 1;
}

const scored = exam.questions.filter((q) => q.type !== "open");
const sum = scored.reduce((acc, q) => acc + q.points, 0);
if (Math.abs(sum - exam.totalPoints) > 0.001) {
  console.error(
    `Збир поена је ${sum}, а тест је пријављен као ${exam.totalPoints}. Исправи пре уноса.`,
  );
  process.exit(1);
}

const varName = exam.key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const file = path.join(examsDir, `${exam.key}.ts`);

const body = `import type { ExamTest } from "./index";

// Тест унет скриптом scripts/import-exam.mjs из ${path.basename(input)}.
// Не мењај бројеве задатака — уписани су у већ сачуване покушаје.

export const ${varName}: ExamTest = ${JSON.stringify(
  {
    key: exam.key,
    year: exam.year,
    label: exam.label,
    term: exam.term,
    totalPoints: exam.totalPoints,
    durationMinutes: exam.durationMinutes,
    note: exam.note,
    texts: exam.texts ?? [],
    questions: exam.questions,
  },
  null,
  2,
)};
`;

fs.writeFileSync(file, body, "utf8");

const indexPath = path.join(examsDir, "index.ts");
let index = fs.readFileSync(indexPath, "utf8");

if (!index.includes(`./${exam.key}`)) {
  index = index.replace(
    /^import type/m,
    `import { ${varName} } from "./${exam.key}";\nimport type`,
  );
  index = index.replace(
    /export const exams: ExamTest\[\] = \[([\s\S]*?)\];/,
    (_, inner) => {
      const items = inner.trim() === "" ? [] : [inner.trim()];
      items.push(`${varName},`);
      return `export const exams: ExamTest[] = [\n  ${items.join("\n  ")}\n];`;
    },
  );
  fs.writeFileSync(indexPath, index, "utf8");
}

console.log(`Унет тест „${exam.label}“ (${exam.questions.length} задатака, ${exam.totalPoints} поена).`);
console.log("Провери са: pnpm --filter @workspace/api-server run verify:exams");
