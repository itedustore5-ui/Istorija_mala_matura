import { normalizeText } from "./normalize.js";

/**
 * ЈЕДИНА функција бодовања у апликацији. Клијент не рачуна тачност ни за
 * приказ; вежбање и мерење бодују се овде, истим правилима.
 *
 * Бодовање је све-или-ништа по задатку, осим где задатак носи правило
 * делимичних бодова из упутства за прегледање завршног испита (`partial`,
 * види доле). За сваки тип постоје тестови (тачан / нетачан / ивични) у
 * `tests/scoring.test.ts` — нови тип не иде у продукцију без њих.
 *
 * Облик одговора (оно што шаље клијент) и кључа (колона `correct`):
 *   single    одговор: број понуђеног одговора      кључ: број
 *   multi     одговор: низ бројева, редослед небитан кључ: низ бројева
 *   text      одговор: низ стрингова, по пољу       кључ: низ низова прихватљивих облика
 *   matching  одговор: за сваки ред број колоне     кључ: низ бројева
 *   ordering  одговор: бројеви ставки редом          кључ: бројеви ставки у тачном редоследу
 *
 * Одговор стиже од клијента и може бити било шта — свака грана прво проверава
 * облик, па тек онда пореди.
 */

export type QuestionType = "single" | "multi" | "text" | "matching" | "ordering";

export const QUESTION_TYPES: QuestionType[] = ["single", "multi", "text", "matching", "ordering"];

/**
 * Делимични бодови из „Упутства за прегледање“ завршног испита, само за табеле
 * (`matching`): „Два тачна одговора и ниједан нетачан – 0,5 бодова“ је
 * `{ correct: 2, points: 0.5 }`. Празан ред није нетачан одговор; погрешно
 * обојен јесте и поништава делимичне бодове.
 */
export type PartialRule = { correct: number; points: number };

export type ScorableQuestion = { type: QuestionType; correct: unknown; points: number; partial?: unknown };

export type ScoreResult = { isCorrect: boolean; points: number };

/** Правила која се стварно могу применити; неисправна се тихо прескачу. */
export function partialRules(partial: unknown, rowCount: number, maxPoints: number): PartialRule[] {
  if (!Array.isArray(partial)) return [];
  return partial.filter(
    (r): r is PartialRule =>
      Boolean(r) &&
      typeof r === "object" &&
      isInt((r as PartialRule).correct) &&
      (r as PartialRule).correct >= 1 &&
      (r as PartialRule).correct < rowCount &&
      typeof (r as PartialRule).points === "number" &&
      (r as PartialRule).points > 0 &&
      (r as PartialRule).points < maxPoints,
  );
}

function partialPoints(question: ScorableQuestion, answer: unknown): number {
  if (question.type !== "matching") return 0;
  const key = intArray(question.correct);
  if (!key || !Array.isArray(answer) || answer.length !== key.length) return 0;
  const rules = partialRules(question.partial, key.length, question.points);
  if (rules.length === 0) return 0;

  let right = 0;
  for (const [row, col] of key.entries()) {
    const given = answer[row];
    if (given === null || given === undefined) continue;
    if (given !== col) return 0; // „ниједан нетачан“
    right += 1;
  }
  return rules.filter((r) => right >= r.correct).reduce((best, r) => Math.max(best, r.points), 0);
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

const intArray = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every(isInt) ? (v as number[]) : null;

const sameSequence = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function isRight(type: QuestionType, correct: unknown, answer: unknown): boolean {
  switch (type) {
    case "single":
      return isInt(correct) && isInt(answer) && answer === correct;

    case "multi": {
      const key = intArray(correct);
      const given = intArray(answer);
      if (!key || !given || key.length === 0) return false;
      // Понављање исте ставке не сме да замени ставку која недостаје.
      if (new Set(given).size !== given.length) return false;
      const want = new Set(key);
      return given.length === want.size && given.every((g) => want.has(g));
    }

    case "text": {
      if (!Array.isArray(correct) || !Array.isArray(answer)) return false;
      if (answer.length !== correct.length) return false;
      return correct.every((accepted, i) => {
        const given = answer[i];
        if (typeof given !== "string" || !Array.isArray(accepted)) return false;
        const g = normalizeText(given);
        if (g === "") return false;
        return accepted.some((variant) => typeof variant === "string" && normalizeText(variant) === g);
      });
    }

    case "matching": {
      const key = intArray(correct);
      if (!key || !Array.isArray(answer) || answer.length !== key.length) return false;
      return key.every((col, row) => answer[row] === col);
    }

    case "ordering": {
      const key = intArray(correct);
      const given = intArray(answer);
      if (!key || !given) return false;
      return sameSequence(key, given);
    }

    default:
      return false;
  }
}

export function scoreAnswer(question: ScorableQuestion, answer: unknown): ScoreResult {
  const isCorrect = isRight(question.type, question.correct, answer);
  if (isCorrect) return { isCorrect, points: question.points };
  return { isCorrect, points: partialPoints(question, answer) };
}
