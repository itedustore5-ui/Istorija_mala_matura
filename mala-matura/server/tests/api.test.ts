import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { seedContent } from "../src/content.js";
import { ITEM_COLUMNS } from "../src/csv.js";
import { migrate, openDatabase, type Database } from "../src/db/client.js";
import { questions, users } from "../src/db/schema.js";

/**
 * Цео ток кроз API, над базом у меморији (PGlite) напуњеном правим задацима.
 *
 * Најважнија провера: `correct` и `explanation` не смеју бити НИГДЕ у JSON-у
 * који стиже пре предаје — претражује се цео одговор, на свакој дубини.
 */

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const PASSWORD = "lozinka-za-test";

let database: Database;
let server: Server;
let base = "";
const token: Record<string, string> = {};
const userId: Record<string, number> = {};

type Res = { status: number; body: any; raw: Response };

async function call(pathname: string, options: { method?: string; body?: unknown; as?: string } = {}): Promise<Res> {
  const raw = await fetch(`${base}${pathname}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      ...(options.as ? { Authorization: `Bearer ${token[options.as]}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await raw.clone().text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // CSV и слике нису JSON
  }
  return { status: raw.status, body, raw };
}

/** Путање до свих кључева са датим именом, на било којој дубини. */
function findKeys(value: unknown, keys: string[], trail = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findKeys(v, keys, `${trail}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(keys.includes(k) ? [`${trail}.${k}`] : []),
      ...findKeys(v, keys, `${trail}.${k}`),
    ]);
  }
  return [];
}

const FORBIDDEN = ["correct", "explanation"];

async function numberToId(n: number) {
  const [q] = await database.db.select().from(questions).where(eq(questions.number, n));
  return q!;
}

beforeAll(async () => {
  database = await openDatabase({});
  await migrate(database);
  await seedContent(database.db, dataDir);
  const passwordHash = await hashPassword(PASSWORD);
  const people = [
    { username: "admin", fullName: "Админ Тест", role: "admin" },
    { username: "ucenik", fullName: "Ана Анић", role: "student" },
    { username: "drugi", fullName: "Бора Борић", role: "student" },
    { username: "kontrola", fullName: "Вера Верић", role: "student" },
  ];
  for (const p of people) {
    const [row] = await database.db.insert(users).values({ ...p, passwordHash }).returning();
    userId[p.username] = row!.id;
  }
  server = createApp(database.db).listen(0);
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  for (const p of people) {
    const res = await call("/auth/login", { body: { username: p.username, password: PASSWORD } });
    token[p.username] = res.body.token;
  }
});

afterAll(async () => {
  server?.close();
  await database?.close();
});

describe("пријава", () => {
  it("погрешна лозинка и непостојећи налог дају исту поруку", async () => {
    const wrong = await call("/auth/login", { body: { username: "ucenik", password: "pogresna" } });
    const unknown = await call("/auth/login", { body: { username: "nema", password: "pogresna" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it("без токена нема приступа", async () => {
    expect((await call("/subjects")).status).toBe(401);
    expect((await call("/auth/me", { as: "ucenik" })).body.username).toBe("ucenik");
  });

  it("непозната /api путања враћа JSON 404", async () => {
    const res = await call("/nema-ove-rute");
    expect(res.status).toBe(404);
    expect(res.body.message).toBeTruthy();
  });
});

describe("`correct` не напушта сервер пре предаје", () => {
  it("списак предмета", async () => {
    const res = await call("/subjects", { as: "ucenik" });
    expect(res.status).toBe(200);
    expect(res.body[0].sections).toHaveLength(6);
    expect(findKeys(res.body, FORBIDDEN)).toEqual([]);
  });

  it("свих 120 задатака кроз почетак вежбања, свака целина", async () => {
    const subjects = (await call("/subjects", { as: "ucenik" })).body;
    let seen = 0;
    for (const section of subjects[0].sections) {
      const res = await call("/practice/start", { as: "ucenik", body: { subjectId: "istorija", section: section.key } });
      expect(res.status).toBe(200);
      expect(findKeys(res.body, FORBIDDEN)).toEqual([]);
      seen += res.body.questions.length;
    }
    expect(seen).toBe(120);
  });
});

describe("вежбање", () => {
  let attemptId = 0;
  let q241 = 0;

  beforeAll(async () => {
    const res = await call("/practice/start", { as: "ucenik", body: { subjectId: "istorija", section: "241–260" } });
    attemptId = res.body.attempt.id;
    q241 = res.body.questions.find((q: { number: number }) => q.number === 241).id;
  });

  it("тачан одговор: кључ и објашњење стижу тек у одговору на /submit", async () => {
    const res = await call(`/attempts/${attemptId}/questions/${q241}/submit`, { as: "ucenik", body: { answer: 1, timeMs: 5000 } });
    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.correct).toBe(1);
    expect(res.body.explanation).toBeTruthy();
  });

  it("поновна предаја истог задатка не мења резултат", async () => {
    const res = await call(`/attempts/${attemptId}/questions/${q241}/submit`, { as: "ucenik", body: { answer: 0 } });
    expect(res.body.alreadySubmitted).toBe(true);
    expect(res.body.isCorrect).toBe(true);
  });

  it("латиница се прихвата као ћирилица", async () => {
    const q244 = (await numberToId(244)).id;
    const res = await call(`/attempts/${attemptId}/questions/${q244}/submit`, {
      as: "ucenik",
      body: { answer: ["Praistorija", " istorija "] },
    });
    expect(res.body.isCorrect).toBe(true);
  });

  it("нетачан одговор", async () => {
    const q242 = (await numberToId(242)).id;
    const res = await call(`/attempts/${attemptId}/questions/${q242}/submit`, { as: "ucenik", body: { answer: 3 } });
    expect(res.body.isCorrect).toBe(false);
    expect(res.body.points).toBe(0);
  });

  it("задатак ван вежбања и туђе вежбање се одбијају", async () => {
    const q300 = (await numberToId(300)).id;
    expect((await call(`/attempts/${attemptId}/questions/${q300}/submit`, { as: "ucenik", body: { answer: 0 } })).status).toBe(400);
    expect((await call(`/attempts/${attemptId}/questions/${q241}/submit`, { as: "drugi", body: { answer: 1 } })).status).toBe(404);
  });

  it("крај вежбања сабира поене; после краја нема предаје", async () => {
    const res = await call(`/attempts/${attemptId}/finish`, { as: "ucenik", body: {} });
    expect(res.body).toMatchObject({ score: 2, maxScore: 20, answered: 3, total: 20, percentage: 10 });
    expect(findKeys(res.body, FORBIDDEN)).toEqual([]);
    const q243 = (await numberToId(243)).id;
    expect((await call(`/attempts/${attemptId}/questions/${q243}/submit`, { as: "ucenik", body: { answer: [] } })).status).toBe(409);
  });
});

describe("контролна група не вежба", () => {
  it("сервер одбија и почетак и предају, не само дугме", async () => {
    await call(`/admin/users/${userId.kontrola}`, { method: "PUT", as: "admin", body: { studyArm: "kontrolna" } });
    const start = await call("/practice/start", { as: "kontrola", body: { subjectId: "istorija", section: "241–260" } });
    expect(start.status).toBe(403);
    const subjects = await call("/subjects", { as: "kontrola" });
    expect(subjects.body[0].practice.ok).toBe(false);
  });
});

describe("мерење T0–T3", () => {
  it("без отвореног термина нема теста", async () => {
    const res = await call("/tests/start", { as: "ucenik", body: { subjectId: "istorija" } });
    expect(res.status).toBe(403);
  });

  it("форма по ротацији, чување без повратне информације, предаја једном", async () => {
    for (const [code, numbers] of [["A", [241, 242, 243]], ["B", [244, 245, 246]], ["C", [247, 248, 249]]] as const) {
      const res = await call(`/admin/forms/istorija/${code}`, { method: "PUT", as: "admin", body: { questionNumbers: numbers } });
      expect(res.status).toBe(200);
    }
    await call(`/admin/users/${userId.ucenik}`, { method: "PUT", as: "admin", body: { studyArm: "eksperimentalna" } });
    await call("/admin/study", { method: "PUT", as: "admin", body: { currentPhase: "T0", testOpen: true } });

    const start = await call("/tests/start", { as: "ucenik", body: { subjectId: "istorija" } });
    expect(start.status).toBe(200);
    expect(start.body.questions).toHaveLength(3);
    expect(findKeys(start.body, FORBIDDEN)).toEqual([]);

    const first = start.body.questions[0];
    const save = await call(`/attempts/${start.body.attempt.id}/answers/${first.id}`, {
      method: "PUT",
      as: "ucenik",
      body: { answer: 0, timeMs: 3000, changes: 1 },
    });
    expect(save.body).toEqual({ saved: true });

    // Наставак после пукле везе враћа исти покушај и сачуван одговор.
    const again = await call("/tests/start", { as: "ucenik", body: { subjectId: "istorija" } });
    expect(again.body.attempt.id).toBe(start.body.attempt.id);
    expect(again.body.answers[first.id]).toBe(0);

    const submit = await call(`/attempts/${start.body.attempt.id}/submit`, { as: "ucenik", body: {} });
    expect(submit.status).toBe(200);
    expect(submit.body.maxScore).toBe(3);
    // Кључ се после мерења намерно не шаље: T3 понавља форму из T0.
    expect(findKeys(submit.body, FORBIDDEN)).toEqual([]);

    const twice = await call("/tests/start", { as: "ucenik", body: { subjectId: "istorija" } });
    expect(twice.status).toBe(409);
  });

  it("кад мерење почне, форме се више не мењају", async () => {
    const res = await call("/admin/forms/istorija/A", { method: "PUT", as: "admin", body: { questionNumbers: [250] } });
    expect(res.status).toBe(409);
  });
});

describe("извоз — само уз сагласност, никад име", () => {
  it("испитаник без сагласности не улази у извоз", async () => {
    await call(`/admin/users/${userId.drugi}`, { method: "PUT", as: "admin", body: { studyArm: "eksperimentalna" } });
    const drugi = await call("/practice/start", { as: "drugi", body: { subjectId: "istorija", section: "241–260" } });
    await call(`/attempts/${drugi.body.attempt.id}/finish`, { as: "drugi", body: {} });
    await call(`/admin/users/${userId.ucenik}`, { method: "PUT", as: "admin", body: { consentResearch: true } });

    const people = (await call("/admin/users", { as: "admin" })).body as { username: string; researchId: string }[];
    const ucenik = people.find((p) => p.username === "ucenik")!.researchId;
    const drugiId = people.find((p) => p.username === "drugi")!.researchId;
    expect(ucenik).toMatch(/^[A-Z0-9]+-\d{4}$/);

    for (const file of ["attempts", "items", "events"]) {
      const res = await call(`/admin/export/${file}.csv`, { as: "admin" });
      const bytes = new Uint8Array(await res.raw.arrayBuffer());
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
      const text = new TextDecoder().decode(bytes);
      expect(text).not.toContain("Ана Анић");
      expect(text).not.toContain("ucenik");
      expect(text).not.toContain(drugiId);
      if (file !== "events") expect(text).toContain(ucenik);
    }

    const items = await call("/admin/export/items.csv", { as: "admin" });
    const header = String(items.body).replace(/^﻿/, "").split("\r\n")[0];
    expect(header).toBe(ITEM_COLUMNS.join(","));
  });

  it("ученик нема приступ админу ни извозу", async () => {
    expect((await call("/admin/users", { as: "ucenik" })).status).toBe(403);
    expect((await call("/admin/export/items.csv", { as: "ucenik" })).status).toBe(403);
  });
});

describe("админ — задаци у бази", () => {
  it("ставке за ређање се чувају измешане", async () => {
    const res = await call("/admin/questions", {
      as: "admin",
      body: {
        subjectId: "istorija",
        number: 9001,
        section: "проба",
        type: "ordering",
        prompt: "Поређај периоде хронолошки.",
        content: { items: ["стари век", "средњи век", "нови век", "савремено доба"] },
        correct: [0, 1, 2, 3],
        explanation: "Редом од најстаријег.",
        points: 1,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.correct).not.toEqual([0, 1, 2, 3]);
    const items = res.body.content.items as string[];
    expect((res.body.correct as number[]).map((i) => items[i])).toEqual(["стари век", "средњи век", "нови век", "савремено доба"]);

    // Приказ почиње измешано, и никад тачним редоследом — ученик који ништа
    // не помери не сме да добије поен.
    for (let i = 0; i < 15; i++) {
      const start = await call("/practice/start", { as: "ucenik", body: { subjectId: "istorija", section: "проба" } });
      const shown = start.body.questions[0];
      expect(findKeys(start.body, FORBIDDEN)).toEqual([]);
      expect(shown.content.initialOrder).not.toEqual(res.body.correct);
      const check = await call(`/attempts/${start.body.attempt.id}/questions/${shown.id}/submit`, {
        as: "ucenik",
        body: { answer: shown.content.initialOrder },
      });
      expect(check.body.isCorrect).toBe(false);
    }
  });

  it("задатак за ређање са две ставке се одбија", async () => {
    const res = await call("/admin/questions", {
      as: "admin",
      body: {
        subjectId: "istorija",
        number: 9002,
        section: "проба",
        type: "ordering",
        prompt: "Поређај.",
        content: { items: ["прво", "друго"] },
        correct: [0, 1],
        explanation: "",
        points: 1,
      },
    });
    expect(res.status).toBe(400);
  });

  it("измена повећава верзију; неисправан кључ се одбија", async () => {
    const q = await numberToId(241);
    const res = await call(`/admin/questions/${q.id}`, {
      method: "PUT",
      as: "admin",
      body: { ...q, explanation: `${q.explanation} (допуњено)` },
    });
    expect(res.body.version).toBe(q.version + 1);
    const bad = await call(`/admin/questions/${q.id}`, { method: "PUT", as: "admin", body: { ...q, correct: 9 } });
    expect(bad.status).toBe(400);
  });
});

describe("телеметрија", () => {
  it("уписује се само за сопствени покушај", async () => {
    const mine = await call("/practice/start", { as: "ucenik", body: { subjectId: "istorija", section: "261–280" } });
    const theirs = await call("/practice/start", { as: "drugi", body: { subjectId: "istorija", section: "261–280" } });
    const at = new Date().toISOString();
    const res = await call("/telemetry", {
      as: "ucenik",
      body: {
        events: [
          { attemptId: mine.body.attempt.id, questionId: mine.body.questions[0].id, type: "view", at },
          { attemptId: theirs.body.attempt.id, type: "view", at },
          { attemptId: mine.body.attempt.id, type: "nepoznat", at },
        ],
      },
    });
    expect(res.body.stored).toBe(1);
  });
});

describe("слике", () => {
  it("слика из збирке се служи из базе", async () => {
    const res = await call("/images/zadatak-274.jpg");
    expect(res.status).toBe(200);
    expect(res.raw.headers.get("content-type")).toBe("image/jpeg");
  });
});
