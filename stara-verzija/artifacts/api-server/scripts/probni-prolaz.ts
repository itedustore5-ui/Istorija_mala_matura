import "../src/lib/load-env";

import { eq, inArray } from "drizzle-orm";
import { attemptItems, db, pool, quizAttempts, users } from "@workspace/db";
import { questionById } from "../src/data/questions";

/**
 * Пробни пролаз кроз цео ток, као прави испитаници.
 *
 * Двоје-троје људи кроз апликацију па провера да су подаци стигли тачно.
 * Грешка нађена на троје је непријатност; нађена на целом одељењу је изгубљено
 * мерење. Ово ради исто, само аутоматски — против покренутог сервера.
 *
 *   pnpm --filter @workspace/api-server run probni-prolaz
 *   BASE_URL=http://localhost:5099 pnpm --filter @workspace/api-server run probni-prolaz
 *
 * Пробне налоге на крају брише, заједно са свим што су уписали.
 */

const BASE = (process.env.BASE_URL ?? "http://localhost:5000").replace(/\/$/, "");
const ADMIN = process.env.PROBA_ADMIN ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? "";
const PROBA_PASSWORD = "probni-prolaz-2026";

const NALOZI = [
  { username: "proba.kontrola", fullName: "Проба Контрола", arm: "kontrolna" as const },
  { username: "proba.eksper", fullName: "Проба Експеримент", arm: "eksperimentalna" as const },
];

const problems: string[] = [];
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => {
  problems.push(msg);
  console.log(`  ✗ ${msg}`);
};

type Res = { status: number; body: any };

async function call(path: string, init: RequestInit = {}, token?: string): Promise<Res> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function login(username: string, password: string) {
  const res = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) throw new Error(`Пријава ${username}: ${res.status} ${res.body?.message}`);
  return res.body.token as string;
}

async function main() {
  if (!ADMIN_PASSWORD) {
    throw new Error("ADMIN_INITIAL_PASSWORD није постављен у .env");
  }

  console.log(`Пробни пролаз против ${BASE}\n`);

  const health = await call("/healthz");
  if (health.status !== 200) throw new Error(`Сервер не одговара на ${BASE}/api/healthz`);

  // Непозната путања мора да врати 404, а не почетну страну са статусом 200 —
  // иначе би и ова провера изнад „пролазила“ звањем непостојеће руте.
  const unknown = await call("/ova-ruta-ne-postoji");
  if (unknown.status !== 404) {
    bad(`непозната /api путања враћа ${unknown.status}, а мора 404`);
  } else ok("непозната /api путања: 404");

  const adminToken = await login(ADMIN, ADMIN_PASSWORD);
  ok("админ пријава");

  // ── Припрема пробних налога ──────────────────────────────────────────────
  // Ако су остали од ранијег пролаза, бришу се: лозинка им можда више није та,
  // а и подаци од прошлог пута не смеју да уђу у ову проверу.
  const ranije = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.username, NALOZI.map((n) => n.username)));
  if (ranije.length > 0) {
    await db.delete(users).where(inArray(users.id, ranije.map((r) => r.id)));
  }

  for (const n of NALOZI) {
    await call(
      "/admin/users",
      {
        method: "POST",
        body: JSON.stringify({
          username: n.username,
          password: PROBA_PASSWORD,
          fullName: n.fullName,
          role: "student",
          active: true,
          neverExpires: true,
          quizOnce: false,
        }),
      },
      adminToken,
    );
  }

  const svi = (await call("/admin/users", {}, adminToken)).body as { id: number; username: string }[];
  const idOf = (u: string) => svi.find((x) => x.username === u)!.id;

  for (const n of NALOZI) {
    const res = await call(
      "/research/enroll",
      {
        method: "POST",
        body: JSON.stringify({
          userIds: [idOf(n.username)],
          studyArm: n.arm,
          classGroup: "VIII-проба",
        }),
      },
      adminToken,
    );
    if (res.status !== 200) bad(`уписивање ${n.username}: ${res.status}`);
  }
  ok("уписивање у студију");

  // ── Контролна грана не сме да вежба ──────────────────────────────────────
  const kToken = await login("proba.kontrola", PROBA_PASSWORD);

  const kCatalog = await call("/catalog", {}, kToken);
  if (kCatalog.body.practiceAllowed !== false) bad("каталог контролној грани дозвољава вежбање");
  else ok("каталог: контролна грана види разлог, не дугмад");

  const kQuestions = await call("/questions?block=241-260", {}, kToken);
  if (kQuestions.status !== 403) bad(`GET /questions контролној грани враћа ${kQuestions.status}, а мора 403`);
  else ok("GET /questions: 403 за контролну грану");

  const kAttempt = await call(
    "/attempts",
    { method: "POST", body: JSON.stringify({ answers: [{ questionId: 241, answer: "1" }] }) },
    kToken,
  );
  if (kAttempt.status !== 403) bad(`POST /attempts контролној грани враћа ${kAttempt.status}, а мора 403`);
  else ok("POST /attempts: 403 за контролну грану");

  // `/check` враћа тачан одговор и објашњење. Ако није затворена, контролна
  // грана прође кроз све бројеве задатака и прочита цело решење — тиме добија
  // исти третман као експериментална и поређење нестаје.
  const kCheck = await call(
    "/check",
    { method: "POST", body: JSON.stringify({ questionId: 241, answer: "1" }) },
    kToken,
  );
  if (kCheck.status !== 403) {
    bad(`POST /check контролној грани враћа ${kCheck.status}, а мора 403 — цуре тачни одговори`);
  } else ok("POST /check: 403 за контролну грану");

  // ── Експериментална грана вежба ──────────────────────────────────────────
  const eToken = await login("proba.eksper", PROBA_PASSWORD);

  const eQuestions = await call("/questions?block=241-260", {}, eToken);
  if (eQuestions.status !== 200) bad(`GET /questions експерименталној грани враћа ${eQuestions.status}`);
  const pitanja = (eQuestions.body ?? []) as { id: number; type: string }[];
  ok(`GET /questions: ${pitanja.length} задатака`);

  // Тачан одговор не сме да стигне пре него што ученик одговори.
  const leaked = ["correctAnswer", "correctAnswers", "correctPairs", "correctTokens", "correctOrder", "correct", "fields", "explanation", "acceptable"];
  const curi = leaked.filter((k) =>
    pitanja.some((q) => {
      const v = (q as Record<string, unknown>)[k];
      if (k === "fields") return Array.isArray(v) && v.some((f) => "accepted" in (f as object));
      return v !== undefined;
    }),
  );
  if (curi.length > 0) bad(`задатак носи поља ${curi.join(", ")} пре одговора`);
  else ok("тачни одговори не излазе пре предаје");

  // Провера једног одговора: тачан одговор из збирке мора да прође, промењен
  // не сме. Задатак 241 је „обој кружић“ са тачним одговором „век“ (индекс 1).
  const z241 = questionById(241);
  const tacan241 = z241?.type === "single" ? String(z241.correctAnswer) : "";
  const cOk = await call(
    "/check",
    { method: "POST", body: JSON.stringify({ questionId: 241, answer: tacan241 }) },
    eToken,
  );
  const cBad = await call(
    "/check",
    { method: "POST", body: JSON.stringify({ questionId: 241, answer: "0" }) },
    eToken,
  );
  if (cOk.body?.correct !== true || cBad.body?.correct !== false) {
    bad("POST /check не разликује тачан и нетачан одговор на задатак 241");
  } else ok("POST /check: тачан одговор признат, нетачан одбијен");

  // Одговори из две целине у једној предаји морају бити одбијени — иначе би
  // ученик свој резултат уписао у целину коју није радио.
  const mixed = await call(
    "/attempts",
    {
      method: "POST",
      body: JSON.stringify({
        answers: [
          { questionId: 241, answer: tacan241 },
          { questionId: 261, answer: "1" },
        ],
      }),
    },
    eToken,
  );
  if (mixed.status !== 400) bad(`предаја из две целине враћа ${mixed.status}, а мора 400`);
  else ok("предаја из две целине: 400");

  // Први задатак се предаје тачно, остала два нетачно — бодовање кроз цео ток
  // мора да донесе бар један поен и да га припише баш задатку 241.
  const izabrani = pitanja.slice(0, 3);
  const attempt = await call(
    "/attempts",
    {
      method: "POST",
      body: JSON.stringify({
        answers: izabrani.map((q, i) => ({
          questionId: q.id,
          answer: i === 0 && q.id === 241 ? tacan241 : "0",
          timeSpentMs: 4200,
        })),
        startedAt: new Date(Date.now() - 90_000).toISOString(),
        durationMs: 90_000,
        clientInfo: { userAgent: "probni-prolaz", screen: "1920x1080", mobile: false },
      }),
    },
    eToken,
  );
  if (attempt.status !== 200) bad(`POST /attempts: ${attempt.status} ${attempt.body?.message}`);
  else ok(`покушај уписан: ${attempt.body.score}/${attempt.body.total}`);

  const r241 = (attempt.body?.results ?? []).find((r: { id: number }) => r.id === 241);
  if (!r241?.correct) bad("тачан одговор на задатак 241 није бодован у покушају");
  else ok("тачан одговор бодован и у покушају");

  // ── Провера да су подаци стварно стигли ──────────────────────────────────
  const attemptId = attempt.body?.id as number | undefined;
  if (attemptId) {
    const [red] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId));
    if (!red) bad("покушај није у бази");
    else {
      if (red.phase !== "vezbanje") bad(`фаза покушаја је „${red.phase}“, а очекује се „vezbanje“`);
      else ok("сервер је уписао фазу");
      if (red.block !== "241-260") bad(`целина покушаја је „${red.block}“, а очекује се „241-260“`);
      else ok("сервер је уписао целину из броја задатка");
      if (!red.durationMs) bad("трајање покушаја није уписано");
      else ok(`трајање: ${Math.round(red.durationMs / 1000)} s`);
      if (!red.clientInfo) bad("подаци о уређају нису уписани");
      else ok("подаци о уређају уписани (без IP адресе)");
    }

    const stavke = await db.select().from(attemptItems).where(eq(attemptItems.attemptId, attemptId));
    if (stavke.length === 0) bad("нема редова у attempt_items — најважнија табела остаје празна");
    else ok(`attempt_items: ${stavke.length} редова`);

    // Време се бележи само за задатке на којима је ученик стварно био; за
    // остале у скупу остаје празно и то је исправно.
    const odgovoreni = new Set(izabrani.map((q) => q.id));
    const saVremenom = stavke.filter((s) => odgovoreni.has(s.questionId) && s.timeSpentMs !== null);
    if (saVremenom.length !== odgovoreni.size) {
      bad(`време по задатку уписано за ${saVremenom.length} од ${odgovoreni.size} одговорених`);
    } else ok("време по задатку уписано");
  }

  // ── Извоз ────────────────────────────────────────────────────────────────
  // Без сагласности испитаник не улази у извоз — то је исправно, али би онда
  // празан извоз прошао и да је покварен. Зато се сагласност овде даје, па се
  // тражи да се псеудоним стварно појави.
  const eId = idOf("proba.eksper");
  const [eUser] = await db.select().from(users).where(eq(users.id, eId));
  const eResearchId = eUser!.researchId!;

  await call(
    `/research/participants/${eId}`,
    { method: "PATCH", body: JSON.stringify({ consentResearch: true }) },
    adminToken,
  );

  // А контролни, без сагласности, не сме да се појави.
  const [kUser] = await db.select().from(users).where(eq(users.id, idOf("proba.kontrola")));
  const kResearchId = kUser!.researchId!;

  for (const oblik of ["wide", "long", "items"]) {
    const res = await fetch(`${BASE}/api/export/${oblik}.csv`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    // `Response.text()` по спецификацији скида водећи BOM при декодирању, па
    // се он мора проверити над самим бајтовима — иначе провера увек пада.
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder("utf-8").decode(bytes);
    const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

    if (res.status !== 200) bad(`извоз ${oblik}: ${res.status}`);
    else if (!hasBom) bad(`извоз ${oblik} нема BOM — Excel ће искривити ћирилицу`);
    else if (/full_name|username|password/.test(text)) bad(`извоз ${oblik} садржи име или лозинку`);
    else if (text.includes("Проба Експеримент") || text.includes("proba.eksper")) {
      bad(`извоз ${oblik} садржи име испитаника уместо псеудонима`);
    } else if (!text.includes(eResearchId)) {
      bad(`извоз ${oblik} не садржи испитаника који је дао сагласност`);
    } else if (text.includes(kResearchId)) {
      bad(`извоз ${oblik} садржи испитаника који НИЈЕ дао сагласност`);
    } else ok(`извоз ${oblik}: ${text.trim().split("\r\n").length - 1} редова`);
  }

  // ── Чишћење ──────────────────────────────────────────────────────────────
  const probni = svi.filter((u) => NALOZI.some((n) => n.username === u.username)).map((u) => u.id);
  if (probni.length > 0) {
    await db.delete(users).where(inArray(users.id, probni));
    ok("пробни налози обрисани");
  }

  if (problems.length > 0) {
    console.error(`\nНађено ${problems.length} проблема — прво мерење не сме да почне.`);
    process.exitCode = 1;
    return;
  }
  console.log("\nПробни пролаз је прошао.");
}

main()
  .catch((err) => {
    console.error("\nПробни пролаз није успео:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
