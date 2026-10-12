import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { seedContent } from "../src/content.js";
import { migrate, openDatabase, type Database } from "../src/db/client.js";
import { users } from "../src/db/schema.js";

/**
 * Тестови са завршних испита у студији: форма везана за тест, делимични бодови
 * у мерењу, и да ученик у истраживању тестове не може да вежба — то су форме
 * мерења. Прави тестови су приватни (`data-private/`), па се овде користи
 * пробни тест из `fixtures/private/`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "..", "data");
const privateDir = path.resolve(here, "fixtures", "private");
const PASSWORD = "lozinka-za-test";

let database: Database;
let server: Server;
let base = "";
const token: Record<string, string> = {};
const userId: Record<string, number> = {};

async function call(pathname: string, options: { method?: string; body?: unknown; as?: string } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      ...(options.as ? { Authorization: `Bearer ${token[options.as]}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

function findKeys(value: unknown, keys: string[]): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => findKeys(v, keys));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [...(keys.includes(k) ? [k] : []), ...findKeys(v, keys)]);
  return [];
}

beforeAll(async () => {
  database = await openDatabase({});
  await migrate(database);
  const report = await seedContent(database.db, dataDir, { privateDir });
  expect(report).toMatchObject({ tests: 1, errors: [] });
  const passwordHash = await hashPassword(PASSWORD);
  for (const p of [
    { username: "admin", fullName: "Админ Тест", role: "admin" },
    { username: "slobodan", fullName: "Ученик ван истраживања", role: "student" },
    { username: "ispitanik", fullName: "Ученик у истраживању", role: "student" },
  ]) {
    const [row] = await database.db.insert(users).values({ ...p, passwordHash }).returning();
    userId[p.username] = row!.id;
  }
  server = createApp(database.db).listen(0);
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  for (const u of ["admin", "slobodan", "ispitanik"]) {
    token[u] = (await call("/auth/login", { body: { username: u, password: PASSWORD } })).body.token;
  }
  await call(`/admin/users/${userId.ispitanik}`, { method: "PUT", as: "admin", body: { studyArm: "eksperimentalna" } });
});

afterAll(async () => {
  server?.close();
  await database?.close();
});

describe("вежбање тестова са завршног испита", () => {
  it("тест није део целина збирке", async () => {
    const res = await call("/subjects", { as: "slobodan" });
    const s = res.body[0];
    expect(s.sections.reduce((n: number, x: { questionCount: number }) => n + x.questionCount, 0)).toBe(120);
    expect(s.tests).toEqual([expect.objectContaining({ key: "zi-proba", questionCount: 3 })]);
  });

  it("ученик ван истраживања вежба тест; кључ стиже тек на /submit", async () => {
    const start = await call("/practice/start", { as: "slobodan", body: { testKey: "zi-proba" } });
    expect(start.status).toBe(200);
    expect(start.body.questions.map((q: { number: number }) => q.number)).toEqual([1, 2, 3]);
    expect(findKeys(start.body, ["correct", "explanation", "partialCredit"])).toEqual([]);

    const matching = start.body.questions[1];
    const res = await call(`/attempts/${start.body.attempt.id}/questions/${matching.id}/submit`, {
      as: "slobodan",
      body: { answer: [1, 2, null] },
    });
    expect(res.body).toMatchObject({ isCorrect: false, points: 0.5, correct: [1, 2, 0] });

    const text = start.body.questions[2];
    const t = await call(`/attempts/${start.body.attempt.id}/questions/${text.id}/submit`, {
      as: "slobodan",
      body: { answer: ["smederevo"] },
    });
    expect(t.body.isCorrect).toBe(true);

    const done = await call(`/attempts/${start.body.attempt.id}/finish`, { as: "slobodan", body: {} });
    expect(done.body).toMatchObject({ score: 1.5, maxScore: 3, percentage: 50 });
  });

  it("ученик у истраживању не види тестове и не може да их вежба", async () => {
    const subjects = await call("/subjects", { as: "ispitanik" });
    expect(subjects.body[0].tests).toEqual([]);
    const start = await call("/practice/start", { as: "ispitanik", body: { testKey: "zi-proba" } });
    expect(start.status).toBe(403);
  });

  it("ни уписан накнадно не може да чита кључ теста из већ започетог вежбања", async () => {
    const start = await call("/practice/start", { as: "slobodan", body: { testKey: "zi-proba" } });
    await call(`/admin/users/${userId.slobodan}`, { method: "PUT", as: "admin", body: { studyArm: "kontrolna" } });
    const res = await call(`/attempts/${start.body.attempt.id}/questions/${start.body.questions[0].id}/submit`, {
      as: "slobodan",
      body: { answer: 0 },
    });
    expect(res.status).toBe(403);
    expect(findKeys(res.body, ["correct", "explanation"])).toEqual([]);
    await call(`/admin/users/${userId.slobodan}`, { method: "PUT", as: "admin", body: { studyArm: null } });
  });
});

describe("тест као форма мерења", () => {
  it("исти тест не може бити у две форме", async () => {
    const a = await call("/admin/forms/istorija/A", { method: "PUT", as: "admin", body: { testKey: "zi-proba" } });
    expect(a.status).toBe(200);
    const b = await call("/admin/forms/istorija/B", { method: "PUT", as: "admin", body: { testKey: "zi-proba" } });
    expect(b.status).toBe(409);
    const unknown = await call("/admin/forms/istorija/B", { method: "PUT", as: "admin", body: { testKey: "nema" } });
    expect(unknown.status).toBe(400);
  });

  it("преглед студије показује форме и тестове", async () => {
    const study = await call("/admin/study", { as: "admin" });
    const s = study.body.subjects[0];
    expect(s.tests.map((t: { key: string }) => t.key)).toEqual(["zi-proba"]);
    expect(s.forms.A).toMatchObject({ testKey: "zi-proba", questionCount: 3 });
  });

  it("мерење из форме везане за тест, са делимичним бодовима", async () => {
    // Ротација: група 1 у T0 добија форму A — обе друге форме из збирке.
    await call("/admin/forms/istorija/B", { method: "PUT", as: "admin", body: { questionNumbers: [241, 242] } });
    await call("/admin/forms/istorija/C", { method: "PUT", as: "admin", body: { questionNumbers: [243, 244] } });
    await call("/admin/study", { method: "PUT", as: "admin", body: { currentPhase: "T0", testOpen: true } });

    const me = (await call("/admin/users", { as: "admin" })).body.find((u: { username: string }) => u.username === "ispitanik");
    expect(me.rotationGroup).toBe(1);

    const start = await call("/tests/start", { as: "ispitanik", body: { subjectId: "istorija" } });
    expect(start.status).toBe(200);
    expect(start.body.attempt.form).toBe("A");
    expect(start.body.questions.map((q: { number: number }) => q.number)).toEqual([1, 2, 3]);
    expect(findKeys(start.body, ["correct", "explanation", "partialCredit"])).toEqual([]);

    const [q1, q2] = start.body.questions;
    await call(`/attempts/${start.body.attempt.id}/answers/${q1.id}`, { method: "PUT", as: "ispitanik", body: { answer: 0 } });
    await call(`/attempts/${start.body.attempt.id}/answers/${q2.id}`, {
      method: "PUT",
      as: "ispitanik",
      body: { answer: [1, null, 0] },
    });
    const submit = await call(`/attempts/${start.body.attempt.id}/submit`, { as: "ispitanik", body: {} });
    expect(submit.body).toMatchObject({ score: 1.5, maxScore: 3, phase: "T0", form: "A" });
    expect(findKeys(submit.body, ["correct", "explanation"])).toEqual([]);

    // Кад мерење почне, форма се више не мења — ни у тест ни у бројеве.
    const lock = await call("/admin/forms/istorija/A", { method: "PUT", as: "admin", body: { questionNumbers: [245] } });
    expect(lock.status).toBe(409);
  });

  it("CSV по задацима носи делимичне бодове", async () => {
    await call(`/admin/users/${userId.ispitanik}`, { method: "PUT", as: "admin", body: { consentResearch: true } });
    const res = await fetch(`${base}/admin/export/items.csv`, { headers: { Authorization: `Bearer ${token.admin}` } });
    const text = await res.text();
    expect(text).toContain(",0.5,");
  });
});
