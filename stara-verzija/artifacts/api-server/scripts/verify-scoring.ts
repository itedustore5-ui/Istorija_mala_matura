/**
 * Проверава да збирка задатака и бодовање стоје:
 *   1. да су подаци о задацима непротивречни (индекси у опсегу, без дупликата,
 *      без рупа у бројевима, слике постоје),
 *   2. да тачан одговор носи поен, а промењен одговор не носи,
 *   3. да у ономе што иде клијенту пре одговора нема тачног одговора.
 *
 * Трећа провера је овде разлог зашто скрипта уопште постоји. Цурење тачног
 * одговора се не види ни на једном екрану — само у мрежном саобраћају — па би
 * иначе прошло непримећено док неко не отвори Network таб.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { questions } from "../src/data/questions";
import { BLOCKS, blockOf, isScored, type DataTable, type Question } from "../src/data/types";
import { sanitizeQuestion, scoreAnswer } from "../src/lib/scoring";

const here = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.resolve(here, "../../istorija-kviz/public/images");

const problems: string[] = [];
const fail = (q: Question, message: string) => problems.push(`Задатак ${q.id}: ${message}`);

// ── 1. Структура ───────────────────────────────────────────────────────────
const seen = new Set<number>();
for (const q of questions) {
  if (seen.has(q.id)) fail(q, "број задатка се понавља");
  seen.add(q.id);

  if (!blockOf(q.id)) fail(q, "број није ни у једној целини збирке (241–360)");
  if (q.points <= 0) fail(q, "број поена мора бити већи од нуле");
  if (!q.question.trim()) fail(q, "нема текста захтева");
  if (!q.explanation.trim()) fail(q, "нема објашњења");

  // Слика која не постоји на екрану изгледа као задатак без прилога, а не као
  // грешка — ученик би решавао карту коју не види.
  const images = [
    ...(q.image ? [q.image] : []),
    ...((q.type === "single" || q.type === "multi") && q.optionImages ? q.optionImages : []),
  ];
  for (const img of images) {
    if (!fs.existsSync(path.join(imagesDir, img))) fail(q, `нема слике „${img}“ у public/images`);
  }

  if (q.table) {
    const width = (row: DataTable["head"]) =>
      row.reduce((n, c) => n + (typeof c === "string" ? 1 : (c.colSpan ?? 1)), 0);
    if (q.table.head.length === 0) fail(q, "табела нема заглавље");
    if (q.table.rows.length === 0) fail(q, "табела нема ниједан ред");
    // Ред који почиње ћелијом са rowSpan ужи је за ту колону у редовима
    // испод; проверава се само да ниједан ред није шири од заглавља.
    for (const [i, row] of q.table.rows.entries())
      if (width(row) > width(q.table.head)) fail(q, `ред ${i + 1} табеле је шири од заглавља`);
  }

  switch (q.type) {
    case "single":
      if (q.options.length < 2) fail(q, "мање од два понуђена одговора");
      if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length)
        fail(q, "тачан одговор показује ван понуђених");
      if (q.optionImages && q.optionImages.length !== q.options.length)
        fail(q, "број слика не одговара броју понуђених одговора");
      break;
    case "multi":
      if (q.correctAnswers.length === 0) fail(q, "нема ниједног тачног одговора");
      if (new Set(q.correctAnswers).size !== q.correctAnswers.length)
        fail(q, "тачан одговор се понавља");
      for (const i of q.correctAnswers)
        if (i < 0 || i >= q.options.length) fail(q, `индекс ${i} је ван понуђених`);
      if (q.optionImages && q.optionImages.length !== q.options.length)
        fail(q, "број слика не одговара броју понуђених одговора");
      break;
    case "fill":
      if (q.fields.length === 0) fail(q, "нема поља за допуну");
      for (const f of q.fields)
        if (f.accepted.length === 0) fail(q, `поље „${f.label}“ нема ниједан прихватљив облик`);
      break;
    case "match":
      if (q.correctPairs.length !== q.leftItems.length)
        fail(q, "број парова не одговара броју ставки леве колоне");
      for (const i of q.correctPairs)
        if (i < 0 || i >= q.rightItems.length) fail(q, `пар ${i} показује ван десне колоне`);
      if (q.extraRight && q.rightItems.length <= q.leftItems.length)
        fail(q, "означено је да има вишка, а десна колона није дужа");
      break;
    case "order": {
      const expected = [...Array(q.items.length)].map((_, i) => i + 1);
      const sorted = [...q.correctOrder].sort((a, b) => a - b);
      if (q.correctOrder.length !== q.items.length || sorted.some((v, i) => v !== expected[i]))
        fail(q, "редослед мора бити пермутација позиција 1..н");
      break;
    }
    case "tf":
      if (q.correct.length !== q.statements.length)
        fail(q, "број тачних вредности не одговара броју тврдњи");
      break;
    case "pick":
      if (q.correctTokens.length === 0) fail(q, "нема означених делова текста");
      for (const i of q.correctTokens)
        if (i < 0 || i >= q.tokens.length) fail(q, `означен део ${i} не постоји`);
      break;
    case "open":
      if (!q.acceptable.trim()) fail(q, "нема модела прихватљивог одговора");
      break;
  }
}

// Рупа у бројевима значи да је задатак прескочен при преписивању. У збирци за
// српски недостајале су две стране скена, а то се открило тек на крају.
const missing: number[] = [];
for (const b of BLOCKS) for (let id = b.from; id <= b.to; id++) if (!seen.has(id)) missing.push(id);

// ── 1б. Мешање писама ──────────────────────────────────────────────────────
// Текст који види ученик мора бити ћирилички. Латинично слово усред ћириличке
// речи је увек грешка у куцању, а на екрану се готово не примећује.
// Провера тражи слово из *било ког* другог писма, не само латинице. Римски
// бројеви („XIX“) су засебне речи и провера их не дира.
const isLetter = (ch: string) => /\p{L}/u.test(ch);
const isCyrillic = (ch: string) => /\p{Script=Cyrillic}/u.test(ch);

function checkScript(q: Question, label: string, value: string) {
  for (const word of value.split(/[\s ]+/)) {
    if (![...word].some(isCyrillic)) continue;
    const stray = [...word].find((ch) => isLetter(ch) && !isCyrillic(ch));
    if (stray) {
      fail(q, `${label}: реч „${word}“ меша ћирилицу и слово „${stray}“ из другог писма`);
    }
  }
}

const cellText = (c: DataTable["head"][number]) => (typeof c === "string" ? c : c.text);

for (const q of questions) {
  checkScript(q, "захтев", q.question);
  checkScript(q, "објашњење", q.explanation);
  if (q.passage) checkScript(q, "одломак", q.passage);
  if (q.source) checkScript(q, "извор", q.source);
  if (q.table) {
    if (q.table.caption) checkScript(q, "наслов табеле", q.table.caption);
    [...q.table.head, ...q.table.rows.flat()].forEach((c) =>
      checkScript(q, "ћелија табеле", cellText(c)),
    );
  }
  if (q.type === "single" || q.type === "multi")
    q.options.forEach((o, i) => checkScript(q, `одговор ${i + 1}`, o));
  if (q.type === "pick") q.tokens.forEach((t, i) => checkScript(q, `део ${i + 1}`, t));
  if (q.type === "tf") q.statements.forEach((s, i) => checkScript(q, `тврдња ${i + 1}`, s));
  if (q.type === "match") {
    q.leftItems.forEach((t, i) => checkScript(q, `лева ставка ${i + 1}`, t));
    q.rightItems.forEach((t, i) => checkScript(q, `десна ставка ${i + 1}`, t));
  }
  if (q.type === "order") q.items.forEach((t, i) => checkScript(q, `ставка ${i + 1}`, t));
  if (q.type === "fill")
    q.fields.forEach((f, i) => {
      checkScript(q, `поље ${i + 1}`, f.label);
      f.accepted.forEach((a) => checkScript(q, `прихватљив одговор ${i + 1}`, a));
    });
  if (q.type === "open") checkScript(q, "модел одговора", q.acceptable);
}

// ── 2. Бодовање ────────────────────────────────────────────────────────────
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

for (const q of questions) {
  if (!isScored(q)) {
    if (scoreAnswer(q, "било шта")) fail(q, "задатак који се не бодује добио је поен");
    continue;
  }

  const correct = correctAnswerFor(q);
  if (correct === null) continue;
  if (!scoreAnswer(q, correct)) fail(q, "тачан одговор није признат");
  if (scoreAnswer(q, "")) fail(q, "празан одговор је признат као тачан");

  // Сваки прихватљив облик мора стварно да прође — облик који нормализација
  // поквари (нпр. тачка на крају, зарез) изгледа прихваћено, а није.
  if (q.type === "fill") {
    q.fields.forEach((f, i) => {
      for (const variant of f.accepted) {
        const answer = q.fields.map((g, j) => (j === i ? variant : g.accepted[0])).join("|");
        if (!scoreAnswer(q, answer)) fail(q, `облик „${variant}“ у пољу ${i + 1} није признат`);
      }
    });
  }

  // Промењен одговор не сме да прође. Свака грана мења одговор на начин који
  // за тај тип задатка сигурно даје нешто друго.
  let wrong: string | null = null;
  if (q.type === "single") {
    wrong = String((q.correctAnswer + 1) % q.options.length);
  } else if (q.type === "multi") {
    const unused = q.options.map((_, i) => i).find((i) => !q.correctAnswers.includes(i));
    wrong = unused === undefined ? null : [...q.correctAnswers, unused].join(",");
  } else if (q.type === "tf") {
    wrong = q.correct.map((v) => (v ? "N" : "T")).join(",");
  } else if (q.type === "pick" && q.correctTokens.length < q.tokens.length) {
    const unused = q.tokens.map((_, i) => i).find((i) => !q.correctTokens.includes(i));
    wrong = [...q.correctTokens, unused!].join(",");
  } else if (q.type === "match" && q.rightItems.length > 1) {
    wrong = q.correctPairs
      .map((v, i) => (i === 0 ? (v + 1) % q.rightItems.length : v))
      .join(",");
  } else if (q.type === "order" && q.items.length > 1) {
    const flipped = [...q.correctOrder];
    [flipped[0], flipped[1]] = [flipped[1]!, flipped[0]!];
    wrong = flipped.join(",");
  } else if (q.type === "fill") {
    wrong = q.fields.map(() => "нетачно").join("|");
  }
  if (wrong !== null && wrong !== correct && scoreAnswer(q, wrong))
    fail(q, "нетачан одговор је признат као тачан");

  // Код задатака са два дела (А/Б) означен само један део не сме да прође.
  if (q.type === "multi" && q.correctAnswers.length > 1) {
    if (scoreAnswer(q, q.correctAnswers.slice(0, -1).join(",")))
      fail(q, "делимично тачан одговор је признат као тачан");
  }
}

// ── 3. Цурење тачног одговора ──────────────────────────────────────────────
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

for (const q of questions) {
  const sanitized = sanitizeQuestion(q) as Record<string, unknown>;
  for (const key of FORBIDDEN_KEYS) {
    if (key in sanitized) fail(q, `поље „${key}“ стиже клијенту пре одговора`);
  }

  // Текст тачног одговора не сме да се појави ни као вредност неког другог
  // поља — на пример у објашњењу залуталом у `question`. Табела се ту не
  // гледа: одговор се из ње чита („која држава има удео од 14,8%“), па је
  // назив државе у реду табеле део задатка, а не цурење.
  const { table: _table, ...rest } = sanitized;
  const serialized = JSON.stringify(rest);
  if (q.type === "fill") {
    for (const field of q.fields) {
      for (const variant of field.accepted) {
        if (variant.length > 3 && serialized.includes(`"${variant}"`))
          fail(q, `прихватљив одговор „${variant}“ стиже клијенту`);
      }
    }
  }
  if (q.type === "open" && serialized.includes(q.acceptable.slice(0, 40)))
    fail(q, "модел одговора стиже клијенту пре одговора");
}

// ── Извештај ───────────────────────────────────────────────────────────────
const scoredCount = questions.filter(isScored).length;
console.log(`Задатака у збирци: ${questions.length} (бодује се ${scoredCount}).`);
for (const b of BLOCKS) {
  const inBlock = questions.filter((q) => blockOf(q.id) === b.key);
  const types = new Map<string, number>();
  for (const q of inBlock) types.set(q.type, (types.get(q.type) ?? 0) + 1);
  const summary = [...types].map(([t, n]) => `${t} ${n}`).join(", ");
  console.log(`  ${b.label} (${b.pages}): ${inBlock.length} — ${summary}`);
}

if (missing.length > 0) {
  console.log(`\nНедостају задаци: ${missing.join(", ")}`);
}

if (problems.length > 0) {
  console.error(`\nНађено ${problems.length} проблема:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

if (missing.length > 0) process.exit(1);

console.log("\nСве провере су прошле.");
