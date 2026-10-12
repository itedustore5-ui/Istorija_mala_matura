import crypto from "node:crypto";
import { QUESTION_TYPES, partialRules, scoreAnswer, type QuestionType } from "./scoring.js";

/**
 * Провера задатка пре уписа у базу — и из админа и из seed-а.
 *
 * Задатак коме кључ показује ван понуђених одговора изгледао би на екрану
 * исправно, а ниједан одговор не би био тачан. Зато се пре уписа проверава
 * и да сам тачан одговор пролази кроз бодовање.
 */

export type QuestionInput = {
  number: number;
  section: string;
  type: QuestionType;
  prompt: string;
  content: Record<string, unknown>;
  correct: unknown;
  explanation: string;
  points: number;
  /** Делимични бодови из упутства за прегледање (само табеле), или null. */
  partial?: unknown;
};

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const strList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

export function validateQuestion(q: Partial<QuestionInput>): string | null {
  if (!isInt(q.number) || q.number <= 0) return "Број задатка мора бити позитиван цео број.";
  if (typeof q.section !== "string" || !q.section.trim()) return "Целина не сме бити празна.";
  if (!QUESTION_TYPES.includes(q.type as QuestionType)) return "Непознат тип задатка.";
  if (typeof q.prompt !== "string" || !q.prompt.trim()) return "Текст задатка не сме бити празан.";
  if (!q.content || typeof q.content !== "object") return "Недостаје садржај задатка.";
  if (!isInt(q.points) || q.points <= 0) return "Број поена мора бити позитиван цео број.";
  if (typeof q.explanation !== "string") return "Објашњење мора бити текст.";

  const c = q.content;
  switch (q.type) {
    case "single": {
      if (!strList(c.options) || (c.options as string[]).length < 2) return "Потребна су бар два понуђена одговора.";
      const n = (c.options as string[]).length;
      if (!isInt(q.correct) || q.correct < 0 || q.correct >= n) return "Тачан одговор мора показивати на понуђени одговор.";
      if (c.optionImages !== undefined && (!strList(c.optionImages) || (c.optionImages as string[]).length !== n))
        return "Број слика мора бити једнак броју понуђених одговора.";
      break;
    }
    case "multi": {
      if (!strList(c.options) || (c.options as string[]).length < 2) return "Потребна су бар два понуђена одговора.";
      const n = (c.options as string[]).length;
      const k = q.correct;
      if (!Array.isArray(k) || k.length === 0 || !k.every((i) => isInt(i) && i >= 0 && i < n))
        return "Тачни одговори морају показивати на понуђене одговоре.";
      if (new Set(k).size !== k.length) return "Тачан одговор се понавља.";
      break;
    }
    case "text": {
      if (!Array.isArray(c.fields) || c.fields.length === 0) return "Потребно је бар једно поље за упис.";
      const k = q.correct;
      if (!Array.isArray(k) || k.length !== c.fields.length) return "Сваком пољу треба листа прихватљивих одговора.";
      if (!k.every((variants) => strList(variants) && (variants as string[]).some((v) => v.trim())))
        return "Свако поље мора имати бар један прихватљив одговор.";
      break;
    }
    case "matching": {
      if (!strList(c.rows) || (c.rows as string[]).length === 0) return "Табела мора имати бар један ред.";
      if (!strList(c.columns) || (c.columns as string[]).length < 2) return "Табела мора имати бар две колоне.";
      const k = q.correct;
      const cols = (c.columns as string[]).length;
      if (!Array.isArray(k) || k.length !== (c.rows as string[]).length || !k.every((i) => isInt(i) && i >= 0 && i < cols))
        return "За сваки ред треба изабрати тачну колону.";
      break;
    }
    case "ordering": {
      // Са две ставке сваки погрешан почетни редослед одаје тачан — треба бар три.
      if (!strList(c.items) || (c.items as string[]).length < 3) return "Потребне су бар три ставке.";
      const n = (c.items as string[]).length;
      const k = q.correct;
      if (!Array.isArray(k) || k.length !== n || !k.every((i) => isInt(i)) || new Set(k).size !== n || k.some((i) => i < 0 || i >= n))
        return "Тачан редослед мора садржати сваку ставку тачно једном.";
      break;
    }
  }

  // Правило делимичних бодова мора бити исправно у целости: бодовање би
  // неисправно правило тихо прескочило, а у подацима би стајало као да важи.
  if (q.partial !== undefined && q.partial !== null) {
    if (q.type !== "matching") return "Делимични бодови постоје само код табела (повезивање).";
    const rows = (c.rows as string[]).length;
    if (!Array.isArray(q.partial) || q.partial.length === 0 || partialRules(q.partial, rows, q.points).length !== q.partial.length)
      return "Правило делимичних бодова није исправно (број тачних редова мањи од броја редова, бодови мањи од пуног броја).";
  }

  // Тачан одговор мора да прође кроз исто бодовање као ученички.
  const sample =
    q.type === "text" ? (q.correct as string[][]).map((variants) => variants.find((v) => v.trim()) ?? "") : q.correct;
  if (!scoreAnswer({ type: q.type as QuestionType, correct: q.correct, points: q.points }, sample).isCorrect)
    return "Тачан одговор не пролази бодовање — провери кључ.";
  return null;
}

/**
 * Ставке задатка „поређај“ чувају се измешане.
 *
 * Да стоје тачним редом, ученик који не додирне ништа добио би пун поен. Ставке
 * се мешају док редослед не буде различит од тачног, а кључ се преписује на
 * нове позиције. Клијент их при приказу меша још једном.
 */
export function shuffleOrdering(items: string[], correct: number[]): { items: string[]; correct: number[] } {
  // Тачан редослед као текст ставки, да би се кључ после мешања поново изградио.
  const inOrder = correct.map((i) => items[i]!);
  if (items.length < 2) return { items: [...items], correct: [...correct] };

  let shuffled = [...items];
  for (let attempt = 0; attempt < 20; attempt++) {
    shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    if (shuffled.some((item, i) => item !== inOrder[i])) break;
  }
  if (shuffled.every((item, i) => item === inOrder[i])) shuffled.reverse();

  // Исти текст може да се понови; позиције се узимају редом, без понављања.
  const used = new Set<number>();
  const newCorrect = inOrder.map((text) => {
    const idx = shuffled.findIndex((item, i) => item === text && !used.has(i));
    used.add(idx);
    return idx;
  });
  return { items: shuffled, correct: newCorrect };
}

/** Да ли су ставке сачуване тачним редом (што се не сме десити). */
export const orderingIsSolved = (correct: number[]) => correct.every((v, i) => v === i);
