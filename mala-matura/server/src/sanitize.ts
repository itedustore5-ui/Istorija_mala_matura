import crypto from "node:crypto";
import type { QuestionRow } from "./db/schema.js";

/**
 * Задатак онако како га ученик види пре него што преда одговор.
 *
 * Гради се поље по поље, из беле листе, никад преко `{...content}`: да је
 * неко у админу грешком уписао кључ у садржај задатка, спред би га тихо послао
 * клијенту, а то се не види ни на једном екрану — само у мрежном саобраћају.
 * `tests/api.test.ts` претражује цео JSON свих рута за задатке и пада ако
 * нађе `correct` или `explanation`.
 */

export type TableCell = string | { text: string; rowSpan?: number; colSpan?: number };
export type DataTable = { caption?: string; head: TableCell[]; rows: TableCell[][] };

export type PublicContent = {
  passage?: string;
  source?: string;
  image?: string;
  table?: DataTable;
  hint?: string;
  options?: string[];
  optionImages?: string[];
  fields?: { label: string }[];
  rows?: string[];
  columns?: string[];
  items?: string[];
  /** Задатак „поређај“: редослед ставки у ком приказ почиње (индекси у `items`). */
  initialOrder?: number[];
};

export type PublicQuestion = {
  id: number;
  number: number;
  section: string;
  type: string;
  prompt: string;
  points: number;
  content: PublicContent;
};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

const cell = (c: unknown): TableCell | null => {
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
    const src = c as { text: string; rowSpan?: unknown; colSpan?: unknown };
    const out: { text: string; rowSpan?: number; colSpan?: number } = { text: src.text };
    if (typeof src.rowSpan === "number") out.rowSpan = src.rowSpan;
    if (typeof src.colSpan === "number") out.colSpan = src.colSpan;
    return out;
  }
  return null;
};

const table = (v: unknown): DataTable | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const src = v as { caption?: unknown; head?: unknown; rows?: unknown };
  if (!Array.isArray(src.head) || !Array.isArray(src.rows)) return undefined;
  const out: DataTable = {
    head: src.head.map(cell).filter((c): c is TableCell => c !== null),
    rows: src.rows
      .filter(Array.isArray)
      .map((row) => (row as unknown[]).map(cell).filter((c): c is TableCell => c !== null)),
  };
  if (typeof src.caption === "string") out.caption = src.caption;
  return out;
};

export function publicContent(type: string, content: unknown): PublicContent {
  const src = (content && typeof content === "object" ? content : {}) as Record<string, unknown>;
  const out: PublicContent = {};

  const passage = str(src.passage);
  if (passage) out.passage = passage;
  const source = str(src.source);
  if (source) out.source = source;
  const image = str(src.image);
  if (image) out.image = image;
  const hint = str(src.hint);
  if (hint) out.hint = hint;
  const t = table(src.table);
  if (t) out.table = t;

  switch (type) {
    case "single":
    case "multi": {
      out.options = strings(src.options) ?? [];
      const imgs = strings(src.optionImages);
      if (imgs) out.optionImages = imgs;
      break;
    }
    case "text":
      out.fields = Array.isArray(src.fields)
        ? src.fields.map((f) => ({
            label: str((f as { label?: unknown } | null)?.label) ?? "",
          }))
        : [];
      break;
    case "matching":
      out.rows = strings(src.rows) ?? [];
      out.columns = strings(src.columns) ?? [];
      break;
    case "ordering":
      out.items = strings(src.items) ?? [];
      break;
  }
  return out;
}

/**
 * Почетни редослед за „поређај“: насумичан, а увек различит од тачног.
 *
 * Клијент ставке приказује измешано. Да их меша сам, насумичан редослед би
 * понекад испао баш тачан, па би ученик који ништа не помери добио пун поен.
 * Сервер зна кључ, па бира редослед који то сигурно није.
 */
export function initialOrder(count: number, correct: unknown): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  const key = Array.isArray(correct) ? correct : [];
  const solved = (o: number[]) => o.length === key.length && o.every((v, i) => v === key[i]);
  for (let attempt = 0; attempt < 20; attempt++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    if (!solved(order)) return order;
  }
  return solved(order) ? [...order].reverse() : order;
}

export function toPublicQuestion(q: QuestionRow): PublicQuestion {
  const content = publicContent(q.type, q.content);
  if (q.type === "ordering") content.initialOrder = initialOrder(content.items?.length ?? 0, q.correct);
  return {
    id: q.id,
    number: q.number,
    section: q.section,
    type: q.type,
    prompt: q.prompt,
    points: q.points,
    content,
  };
}

/** Кључ и објашњење — иде клијенту тек у одговору на `/submit`. */
export function revealQuestion(q: QuestionRow) {
  return { id: q.id, correct: q.correct, explanation: q.explanation };
}
