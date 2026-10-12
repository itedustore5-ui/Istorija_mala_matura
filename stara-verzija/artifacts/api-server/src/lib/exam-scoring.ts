import type { Question } from "../data/types";
import { isScored } from "../data/types";
import { scoreAnswer } from "./scoring";

/**
 * Бодовање завршног испита.
 *
 * Разлика у односу на вежбање: на испиту се код задатака са више ставки
 * (вишеструки избор, повезивање, редослед, тачно/нетачно, подвлачење) признаје
 * делимично тачан одговор. Зато овде не враћамо тачно/нетачно него број поена.
 *
 * Зашто нема казнених поена за погрешно означене ставке иако их неки кључеви
 * имају: збирка и званични кључеви са претходних испита не примењују исто
 * правило сваке године. Док се не унесе тест чији кључ то тражи, увођење казне
 * би променило резултате свих већ решених тестова уназад.
 */

const round = (value: number) => Math.round(value * 100) / 100;

/** Делимични поени се заокружују на пола поена, како је на испиту. */
const toHalfPoints = (ratio: number, points: number) =>
  round(Math.floor(ratio * points * 2) / 2);

const parseIndices = (answer: string) =>
  answer
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n));

export function scoreExamAnswer(question: Question, answer: string): number {
  if (!isScored(question)) return 0;
  if (!answer || answer.trim() === "") return 0;

  // Потпуно тачан одговор увек носи све поене, без обзира на тип.
  if (scoreAnswer(question, answer)) return round(question.points);

  switch (question.type) {
    case "multi": {
      const given = new Set(parseIndices(answer));
      const correct = new Set(question.correctAnswers);
      // Означена нетачна ставка поништава делимичне поене — иначе би ученик
      // који означи све понуђено добио поене без икаквог знања.
      for (const g of given) if (!correct.has(g)) return 0;
      return toHalfPoints(given.size / correct.size, question.points);
    }

    case "match": {
      const given = parseIndices(answer);
      const hits = question.correctPairs.filter((v, i) => given[i] === v).length;
      return toHalfPoints(hits / question.correctPairs.length, question.points);
    }

    case "order": {
      const given = parseIndices(answer);
      const hits = question.correctOrder.filter((v, i) => given[i] === v).length;
      return toHalfPoints(hits / question.correctOrder.length, question.points);
    }

    case "tf": {
      const given = answer.split(",").map((v) => v.trim().toUpperCase());
      const hits = question.correct.filter(
        (v, i) => given[i] === (v ? "T" : "N"),
      ).length;
      return toHalfPoints(hits / question.correct.length, question.points);
    }

    case "pick": {
      const given = new Set(parseIndices(answer));
      const correct = new Set(question.correctTokens);
      for (const g of given) if (!correct.has(g)) return 0;
      return toHalfPoints(given.size / correct.size, question.points);
    }

    // Једноструки избор и допуњавање немају делимично тачан одговор.
    default:
      return 0;
  }
}

export function scoreExam(
  questions: Question[],
  answers: Map<number, string>,
): { earned: number; total: number } {
  let earned = 0;
  let total = 0;
  for (const q of questions) {
    if (!isScored(q)) continue; // задаци писања се не уносе у укупан збир
    total += q.points;
    earned += scoreExamAnswer(q, answers.get(q.id) ?? "");
  }
  return { earned: round(earned), total: round(total) };
}
