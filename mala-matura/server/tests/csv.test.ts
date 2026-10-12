import { describe, expect, it } from "vitest";
import { ATTEMPT_COLUMNS, EVENT_COLUMNS, ITEM_COLUMNS, toCsv } from "../src/csv.js";

/**
 * Колоне извоза су исте на свим платформама — по њима се скупови података
 * спајају без преименовања. Овај тест пада на СВАКУ промену назива или
 * редоследа. Ако је промена намерна: нова колона само на крај, уз нову
 * `CSV_VERSION`, и исто на свим платформама.
 */
describe("CSV колоне", () => {
  it("покушаји", () => {
    expect([...ATTEMPT_COLUMNS]).toEqual([
      "csv_version", "research_id", "subject", "class_group", "study_arm", "rotation_group",
      "attempt_id", "kind", "phase", "form", "section", "started_at", "submitted_at",
      "duration_ms", "questions_total", "questions_answered", "correct_count", "score",
      "max_score", "percentage", "mobile",
    ]);
  });

  it("задаци у покушају", () => {
    expect([...ITEM_COLUMNS]).toEqual([
      "csv_version", "research_id", "subject", "attempt_id", "kind", "phase", "form",
      "question_id", "question_number", "question_version", "question_type", "position",
      "answered", "answer", "is_correct", "points", "max_points", "time_ms", "changes",
      "answered_at",
    ]);
  });

  it("догађаји", () => {
    expect([...EVENT_COLUMNS]).toEqual([
      "csv_version", "research_id", "subject", "attempt_id", "question_id", "event", "at", "value",
    ]);
  });

  it("ниједна колона не носи име ученика", () => {
    const all: string[] = [...ATTEMPT_COLUMNS, ...ITEM_COLUMNS, ...EVENT_COLUMNS];
    const forbidden = ["name", "full_name", "username", "password", "ime", "prezime", "email", "ip"];
    expect(all.filter((c) => forbidden.includes(c))).toEqual([]);
    expect(all.filter((c) => /name|user|pass|mail/.test(c))).toEqual([]);
  });
});

describe("toCsv", () => {
  it("BOM на почетку, да Excel не искриви ћирилицу", () => {
    const csv = toCsv(["a"], [["Историја"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Историја");
  });

  it("водеће =, +, -, @ се неутралишу", () => {
    const csv = toCsv(["a", "b"], [["=1+1", "@SUM(A1)"]]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@SUM(A1)");
  });

  it("ивично: ред са погрешним бројем поља прекида извоз", () => {
    expect(() => toCsv(["a", "b"], [["само једно"]])).toThrow();
  });

  it("зарез, наводник, логичке вредности и JSON", () => {
    const csv = toCsv(["a", "b", "c"], [['Тир, "Сидон"', true, [1, 2]]]);
    expect(csv).toContain('"Тир, ""Сидон"""');
    expect(csv).toContain(",1,");
    expect(csv).toContain('"[1,2]"');
  });
});
