/**
 * Писање CSV-а за извоз у SPSS, jamovi или R.
 *
 * Правила овде нису естетска — свако од њих је ту зато што без њега скуп
 * података постаје неупотребљив, а то се примети тек у анализи.
 */

/** Excel ћирилицу без овога прикаже као кукице. */
const BOM = "﻿";

/**
 * Вредност која почиње са =, +, - или @ Excel тумачи као формулу. Испред такве
 * иде апостроф, да остане текст.
 */
const neutralize = (value: string) =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

const escape = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();

  const raw = neutralize(String(value));
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

/**
 * Гради CSV и успут проверава да сваки ред има тачно онолико поља колико и
 * заглавље.
 *
 * Ако се то разиђе, вредности се тихо помере за једно место и цео скуп је
 * погрешан — а изгледа исправно. Зато провера баца грешку уместо да покуша да
 * поправи.
 */
export function toCsv(header: string[], rows: unknown[][]): string {
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

/** Заглавља одговора за преузимање фајла. */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}
