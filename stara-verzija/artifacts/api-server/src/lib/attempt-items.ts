import { attemptItems, db } from "@workspace/db";

/**
 * Упис резултата по задатку.
 *
 * Из покушаја се зна КОЛИКО је неко знао; одавде се зна ШТА је знао — а то је
 * оно што се анализира: тежина сваке ставке, дискриминативност, поређење
 * типова задатака и, пре свега, шта је заборављено између два мерења.
 *
 * Ови редови се накнадно не могу реконструисати, па се уписују уз сваки
 * покушај, и вежбања и мерења.
 */

export type ItemRow = {
  questionId: number;
  questionType: string;
  /** Целина збирке; за задатке теста са завршног испита остаје null. */
  block?: string | null;
  textKey?: string | null;
  answerRaw: string;
  isCorrect: boolean;
  /** Поени по правилима правог испита; за вежбање остају null. */
  pointsEarned?: number | null;
  pointsMax?: number | null;
  timeSpentMs?: number | null;
  position?: number | null;
};

/** Колона је numeric, а drizzle за њу тражи стринг. */
const money = (v: number | null | undefined) =>
  v === null || v === undefined ? null : v.toFixed(2);

/**
 * Времена по задатку стижу од клијента и нису поуздана као мера — узимају се
 * само као груба ознака задржавања. Негативне и бесмислено велике вредности се
 * одбацују да не искриве анализу.
 */
const HOUR_MS = 60 * 60 * 1000;
const sane = (ms: number | null | undefined) =>
  typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= HOUR_MS
    ? Math.round(ms)
    : null;

export async function recordItems(
  attemptId: number,
  userId: number,
  rows: ItemRow[],
): Promise<void> {
  if (rows.length === 0) return;

  await db.insert(attemptItems).values(
    rows.map((r, i) => ({
      attemptId,
      userId,
      questionId: r.questionId,
      questionType: r.questionType,
      block: r.block ?? null,
      textKey: r.textKey ?? null,
      answerRaw: r.answerRaw,
      isCorrect: r.isCorrect,
      pointsEarned: money(r.pointsEarned),
      pointsMax: money(r.pointsMax),
      timeSpentMs: sane(r.timeSpentMs),
      position: r.position ?? i + 1,
    })),
  );
}

/**
 * Подаци о уређају колико треба за тумачење (нпр. да ли је задатак рађен на
 * телефону). IP адреса се не бележи, а поља се преписују једно по једно да
 * клијент не може да убаци шта хоће.
 */
export function sanitizeClientInfo(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  if (typeof src.userAgent === "string") out.userAgent = src.userAgent.slice(0, 300);
  if (typeof src.screen === "string") out.screen = src.screen.slice(0, 40);
  if (typeof src.mobile === "boolean") out.mobile = src.mobile;

  return Object.keys(out).length > 0 ? out : null;
}
