/**
 * CSV извоз за анализу (SPSS, jamovi, R).
 *
 * КОЛОНЕ СУ ИСТЕ НА СВИМ ПЛАТФОРМАМА (сви предмети, све инсталације). Не
 * мењати ни редослед ни називе: то је оно што чини скупове података спојивим
 * без иједног преименовања. Нова колона може само на крај, уз нову верзију
 * у `CSV_VERSION`. `tests/csv.test.ts` чува тачан списак и пада на сваку
 * промену.
 *
 * Правила која важе за све извозе:
 *   • само ученици са `consent_research` и псеудонимом — никад име
 *   • BOM на почетку, иначе Excel искриви ћирилицу
 *   • сваки ред има тачно онолико поља колико и заглавље; ако се разиђе,
 *     извоз пуца уместо да тихо помери вредности за једно место
 *   • водеће =, +, -, @ се неутралишу, да их Excel не прочита као формулу
 */

export const CSV_VERSION = 1;

/** Један ред = један покушај (вежбање или мерење). */
export const ATTEMPT_COLUMNS = [
  "csv_version",
  "research_id",
  "subject",
  "class_group",
  "study_arm",
  "rotation_group",
  "attempt_id",
  "kind",
  "phase",
  "form",
  "section",
  "started_at",
  "submitted_at",
  "duration_ms",
  "questions_total",
  "questions_answered",
  "correct_count",
  "score",
  "max_score",
  "percentage",
  "mobile",
] as const;

/** Један ред = један задатак у једном покушају. */
export const ITEM_COLUMNS = [
  "csv_version",
  "research_id",
  "subject",
  "attempt_id",
  "kind",
  "phase",
  "form",
  "question_id",
  "question_number",
  "question_version",
  "question_type",
  "position",
  "answered",
  /** Одговор ученика у облику из `scoring.ts` (JSON) — за анализу дистрактора. */
  "answer",
  "is_correct",
  "points",
  "max_points",
  "time_ms",
  "changes",
  "answered_at",
] as const;

/** Један ред = један догађај телеметрије. */
export const EVENT_COLUMNS = [
  "csv_version",
  "research_id",
  "subject",
  "attempt_id",
  "question_id",
  "event",
  "at",
  "value",
] as const;

const BOM = "﻿";

const neutralize = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

const escape = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "1" : "0";
  const raw = neutralize(typeof value === "object" ? JSON.stringify(value) : String(value));
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

export function toCsv(header: readonly string[], rows: unknown[][]): string {
  for (const [i, row] of rows.entries()) {
    if (row.length !== header.length) {
      throw new Error(
        `Ред ${i + 1} има ${row.length} поља, а заглавље ${header.length}. ` +
          "Извоз је прекинут да се подаци не помере за једно место.",
      );
    }
  }
  const lines = [header.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  return BOM + lines.join("\r\n") + "\r\n";
}
