import type { DataTable, Question } from "../data/types";
import { isScored } from "../data/types";

/**
 * Одговор ученика се преноси као стринг јер долази кроз једно поље у бази
 * (`quiz_attempts.answers`). Формат по типу задатка:
 *   single  "2"
 *   multi   "0,3"                 (индекси, редослед небитан)
 *   fill    "реч|друга реч"       (поља раздвојена усправном цртом)
 *   match   "1,0,2"               (за сваку леву ставку индекс десне)
 *   order   "2,1,3"               (за сваку ставку њена позиција)
 *   tf      "T,N,T"
 *   pick    "1,4,7"               (индекси изабраних жетона)
 *   open    слободан текст        (не бодује се)
 */

/**
 * Поређење слободно уписаног одговора.
 *
 * Ћирилица и латиница се НЕ изједначавају: на завршном испиту се пише
 * ћирилицом, а ученик који упише „Mesopotamija“ уместо „Месопотамија“ тамо не
 * би добио поен. Изједначавање писама дало би поен који на испиту не би добио,
 * па би вежба лагала о спремности.
 *
 * Изједначавају се само размаци око зареза и цртица у распону година
 * („1929-1932“ и „1929–1932“): то је куцање, а не знање.
 */
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "");

const parseIndices = (answer: string) =>
  answer
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n));

const sameSet = (a: number[], b: number[]) => {
  const x = [...new Set(a)].sort((m, n) => m - n);
  const y = [...new Set(b)].sort((m, n) => m - n);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * Бодовање је све-или-ништа по задатку: делимично тачан одговор на задатку
 * вредном 1 поен не носи пола поена. Делимичне поене признаје само бодовање
 * теста са завршног испита (`exam-scoring.ts`).
 */
export function scoreAnswer(question: Question, answer: string): boolean {
  if (!isScored(question)) return false;
  if (answer === undefined || answer === null || answer.trim() === "") return false;

  switch (question.type) {
    case "single":
      return Number(answer) === question.correctAnswer;

    case "multi":
      return sameSet(parseIndices(answer), question.correctAnswers);

    case "fill": {
      const given = answer.split("|");
      if (given.length !== question.fields.length) return false;
      return question.fields.every((field, i) =>
        field.accepted.some((variant) => normalize(variant) === normalize(given[i] ?? "")),
      );
    }

    case "match": {
      const given = parseIndices(answer);
      return (
        given.length === question.correctPairs.length &&
        given.every((v, i) => v === question.correctPairs[i])
      );
    }

    case "order": {
      const given = parseIndices(answer);
      return (
        given.length === question.correctOrder.length &&
        given.every((v, i) => v === question.correctOrder[i])
      );
    }

    case "tf": {
      const given = answer.split(",").map((v) => v.trim().toUpperCase());
      return (
        given.length === question.correct.length &&
        question.correct.every((v, i) => (v ? given[i] === "T" : given[i] === "N"))
      );
    }

    case "pick":
      return sameSet(parseIndices(answer), question.correctTokens);

    default:
      return false;
  }
}

/** Задатак онако како га види ученик пре него што одговори. */
export type SanitizedQuestion = {
  id: number;
  textKey?: string;
  points: number;
  type: Question["type"];
  question: string;
  passage?: string;
  source?: string;
  image?: string;
  table?: DataTable;
  scored: boolean;
  options?: string[];
  optionImages?: string[];
  fields?: { label: string }[];
  hint?: string;
  leftItems?: string[];
  rightItems?: string[];
  extraRight?: boolean;
  items?: string[];
  statements?: string[];
  trueLabel?: string;
  falseLabel?: string;
  tokens?: string[];
  lines?: number;
};

const copyTable = (table: DataTable): DataTable => ({
  ...(table.caption !== undefined ? { caption: table.caption } : {}),
  head: table.head.map((c) => (typeof c === "string" ? c : { ...c })),
  rows: table.rows.map((row) => row.map((c) => (typeof c === "string" ? c : { ...c }))),
});

/**
 * Гради се поље по поље, никад преко `{...q}`.
 * Разлог: спред би при сваком новом пољу у моделу задатка (нпр. `correctAnswer`)
 * тихо почео да шаље тачан одговор клијенту, а то се не би видело ни на једном
 * екрану — тек у мрежном саобраћају. Верификатор `verify:scoring` ово проверава.
 */
export function sanitizeQuestion(q: Question): SanitizedQuestion {
  const base: SanitizedQuestion = {
    id: q.id,
    points: q.points,
    type: q.type,
    question: q.question,
    scored: isScored(q),
  };
  if (q.textKey !== undefined) base.textKey = q.textKey;
  if (q.passage !== undefined) base.passage = q.passage;
  if (q.source !== undefined) base.source = q.source;
  if (q.image !== undefined) base.image = q.image;
  if (q.table !== undefined) base.table = copyTable(q.table);

  switch (q.type) {
    case "single":
    case "multi":
      base.options = [...q.options];
      if (q.optionImages !== undefined) base.optionImages = [...q.optionImages];
      break;
    case "fill":
      base.fields = q.fields.map((f) => ({ label: f.label }));
      if (q.hint !== undefined) base.hint = q.hint;
      break;
    case "match":
      base.leftItems = [...q.leftItems];
      base.rightItems = [...q.rightItems];
      if (q.extraRight !== undefined) base.extraRight = q.extraRight;
      break;
    case "order":
      base.items = [...q.items];
      break;
    case "tf":
      base.statements = [...q.statements];
      if (q.trueLabel !== undefined) base.trueLabel = q.trueLabel;
      if (q.falseLabel !== undefined) base.falseLabel = q.falseLabel;
      break;
    case "pick":
      base.tokens = [...q.tokens];
      break;
    case "open":
      if (q.lines !== undefined) base.lines = q.lines;
      break;
  }

  return base;
}

/** Тачан одговор и објашњење — шаље се тек пошто је ученик предао одговор. */
export type RevealedQuestion = {
  id: number;
  explanation: string;
  correctAnswer?: number;
  correctAnswers?: number[];
  correctFields?: string[][];
  correctPairs?: number[];
  correctOrder?: number[];
  correct?: boolean[];
  correctTokens?: number[];
  acceptable?: string;
  unacceptable?: string;
};

export function revealQuestion(q: Question): RevealedQuestion {
  const out: RevealedQuestion = { id: q.id, explanation: q.explanation };

  switch (q.type) {
    case "single":
      out.correctAnswer = q.correctAnswer;
      break;
    case "multi":
      out.correctAnswers = [...q.correctAnswers];
      break;
    case "fill":
      out.correctFields = q.fields.map((f) => [...f.accepted]);
      break;
    case "match":
      out.correctPairs = [...q.correctPairs];
      break;
    case "order":
      out.correctOrder = [...q.correctOrder];
      break;
    case "tf":
      out.correct = [...q.correct];
      break;
    case "pick":
      out.correctTokens = [...q.correctTokens];
      break;
    case "open":
      out.acceptable = q.acceptable;
      if (q.unacceptable !== undefined) out.unacceptable = q.unacceptable;
      break;
  }

  return out;
}
