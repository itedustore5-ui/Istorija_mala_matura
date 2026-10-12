import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateQuestion, type QuestionInput } from "../src/questionModel.js";
import { publicContent } from "../src/sanitize.js";
import { scoreAnswer } from "../src/scoring.js";

/**
 * Почетни садржај (`data/*.json`) — задаци из збирке. Тачни одговори су из
 * одељка РЕШЕЊА; ови тестови проверавају да се подаци не косе сами са собом:
 * да сваки кључ пролази бодовање, да нема рупа у бројевима и да сваки прилог
 * постоји.
 */

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const privateDir = path.resolve(dataDir, "..", "data-private");
const istorija = JSON.parse(fs.readFileSync(path.join(dataDir, "istorija.json"), "utf8")) as {
  subject: { id: string; sections: { key: string }[] };
  questions: (QuestionInput & { note?: string })[];
};

/**
 * Латинично слово усред ћириличне речи на екрану се не види, а поређење
 * одговора га разликује („Mесопотамија“ са латиничним М). Текст из PDF-а
 * теста зна да донесе баш такве знакове. Римски бројеви („XIX“) су засебне
 * речи и не сметају.
 */
function mixedScriptWords(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    for (const word of value.split(/[^\p{L}\p{N}]+/u)) {
      if (/\p{Script=Cyrillic}/u.test(word) && /[A-Za-z]/.test(word)) found.push(word);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) mixedScriptWords(v, found);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) mixedScriptWords(v, found);
  }
  return found;
}

describe("историја — задаци 241–360", () => {
  it("сви бројеви од 241 до 360, без рупа и понављања", () => {
    const numbers = istorija.questions.map((q) => q.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 120 }, (_, i) => 241 + i));
  });

  it("сваки задатак пролази проверу модела и свој кључ", () => {
    const problems = istorija.questions
      .map((q) => [q.number, validateQuestion(q)] as const)
      .filter(([, problem]) => problem !== null);
    expect(problems).toEqual([]);
  });

  it("промењен одговор није тачан", () => {
    for (const q of istorija.questions) {
      let wrong: unknown;
      if (q.type === "single") wrong = ((q.correct as number) + 1) % (q.content.options as string[]).length;
      else if (q.type === "multi") wrong = (q.correct as number[]).slice(0, -1);
      else if (q.type === "text") wrong = (q.correct as string[][]).map(() => "нетачно");
      else if (q.type === "matching")
        wrong = (q.correct as number[]).map((c, i) => (i === 0 ? (c + 1) % (q.content.columns as string[]).length : c));
      expect(scoreAnswer({ type: q.type, correct: q.correct, points: q.points }, wrong).isCorrect, `задатак ${q.number}`).toBe(false);
    }
  });

  it("свака целина постоји у списку целина предмета", () => {
    const keys = new Set(istorija.subject.sections.map((s) => s.key));
    expect(istorija.questions.filter((q) => !keys.has(q.section))).toEqual([]);
  });

  it("свака слика постоји у data/images", () => {
    const missing: string[] = [];
    for (const q of istorija.questions) {
      const names = [q.content.image, ...((q.content.optionImages as string[] | undefined) ?? [])].filter(Boolean);
      for (const name of names) if (!fs.existsSync(path.join(dataDir, "images", String(name)))) missing.push(`${q.number}: ${name}`);
    }
    expect(missing).toEqual([]);
  });

  it("ниједна реч не меша ћирилицу и латиницу", () => {
    expect(mixedScriptWords(istorija.questions)).toEqual([]);
  });

  it("јавни садржај не открива прихватљиве одговоре", () => {
    for (const q of istorija.questions.filter((x) => x.type === "text")) {
      // Табела се не гледа: одговор се из ње чита, па назив државе у реду
      // табеле није цурење.
      const { table: _table, ...visible } = publicContent(q.type, q.content);
      const json = JSON.stringify(visible);
      for (const variants of q.correct as string[][])
        for (const v of variants) if (v.length > 3) expect(json, `задатак ${q.number}: „${v}“`).not.toContain(`"${v}"`);
    }
  });
});

/**
 * Тестови са завршних испита (2023–2026) стоје у `data-private/`, ван git-а:
 * не смеју јавно да се објаве без сагласности Завода. Где те фасцикле нема
 * (нпр. свеж клон репоа), ове провере се прескачу.
 */
const testFiles = fs.existsSync(privateDir) ? fs.readdirSync(privateDir).filter((f) => f.endsWith(".json")) : [];

describe.skipIf(testFiles.length === 0)("тестови са завршних испита (data-private)", () => {
  const loaded = testFiles.map((file) => ({
    file,
    data: JSON.parse(fs.readFileSync(path.join(privateDir, file), "utf8")) as {
      test: { key: string; subjectId: string; year: number };
      questions: (QuestionInput & { partial?: unknown })[];
    },
  }));

  it("сваки тест има задатке 1–20 и укупно 20 бодова", () => {
    for (const { file, data } of loaded) {
      expect(data.questions.map((q) => q.number), file).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect(data.questions.reduce((s, q) => s + q.points, 0), file).toBe(20);
      expect(data.test.key, file).toMatch(/^[a-z0-9-]+$/);
      expect(data.test.subjectId, file).toBe(istorija.subject.id);
    }
  });

  it("сваки задатак пролази проверу модела и свој кључ", () => {
    const problems = loaded.flatMap(({ file, data }) =>
      data.questions
        .map((q) => [`${file} ${q.number}`, validateQuestion({ ...q, section: data.test.key })] as const)
        .filter(([, p]) => p !== null),
    );
    expect(problems).toEqual([]);
  });

  it("делимични бодови само у табелама, и мање од пуног бода", () => {
    for (const { file, data } of loaded)
      for (const q of data.questions.filter((x) => x.partial !== undefined)) {
        expect(q.type, `${file} ${q.number}`).toBe("matching");
        const rules = q.partial as { correct: number; points: number }[];
        for (const r of rules) {
          expect(r.points).toBeLessThan(q.points);
          // Онолико тачних редова колико правило тражи, остали празни — то
          // мора да донесе тачно делимични бод из упутства.
          const partialAnswer = (q.correct as number[]).map((c, i) => (i < r.correct ? c : null));
          expect(scoreAnswer({ type: q.type, correct: q.correct, points: q.points, partial: q.partial }, partialAnswer).points).toBe(r.points);
        }
      }
  });

  it("свака слика постоји у data-private/images", () => {
    const missing: string[] = [];
    for (const { file, data } of loaded)
      for (const q of data.questions) {
        const names = [q.content.image, ...((q.content.optionImages as string[] | undefined) ?? [])].filter(Boolean);
        for (const name of names)
          if (!fs.existsSync(path.join(privateDir, "images", String(name)))) missing.push(`${file} ${q.number}: ${name}`);
      }
    expect(missing).toEqual([]);
  });

  it("ниједна реч не меша ћирилицу и латиницу", () => {
    for (const { file, data } of loaded) expect(mixedScriptWords(data.questions), file).toEqual([]);
  });
});
