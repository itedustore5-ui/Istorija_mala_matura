import "../src/lib/load-env";

import { isNotNull } from "drizzle-orm";
import { db, pool, quizAttempts, users } from "@workspace/db";
import { examByKey } from "../src/data/exams";
import {
  FORMS,
  MEASUREMENT_PHASES,
  ROTATION_GROUPS,
  formFor,
  getSettings,
} from "../src/lib/study";
import { toCsv } from "../src/lib/csv";

/**
 * Провера нацрта студије — оно што се иначе открије тек у анализи.
 *
 * Не проверава да ли је истраживање добро замишљено, него да ли је оно што
 * стоји у бази унутрашње сагласно: да су групе приближно једнаке, да су форме
 * постављене, да уравнотежење стварно ради и да извоз не износи име.
 */

const problems: string[] = [];
const warnings: string[] = [];

const fail = (msg: string) => problems.push(msg);
const warn = (msg: string) => warnings.push(msg);

// ── 1. Латински квадрат ────────────────────────────────────────────────────
// Свака форма мора бити подједнако заступљена у свакој фази; иначе се тежина
// теста меша са фазом и пад се не може приписати заборављању.
function checkLatinSquare() {
  for (const phase of MEASUREMENT_PHASES) {
    const used = ROTATION_GROUPS.map((g) => formFor(g, phase));
    const unique = new Set(used);
    if (unique.size !== FORMS.length) {
      fail(`Фаза ${phase}: групе добијају форме ${used.join(", ")} — нису све три различите.`);
    }
  }

  for (const g of ROTATION_GROUPS) {
    const used = MEASUREMENT_PHASES.map((p) => formFor(g, p));
    if (new Set(used).size !== FORMS.length) {
      fail(`Ротациона група ${g} кроз фазе добија ${used.join(", ")} — понавља форму.`);
    }
  }
}

// ── 2. Извоз не сме да износи име ─────────────────────────────────────────
// Провера над самим кодом извоза: ако се у заглавље икад увуче име, овде пада.
function checkExportHeaders() {
  const forbidden = ["full_name", "fullName", "username", "password", "ime", "prezime"];
  const header = toCsv(["research_id", "study_arm"], [["IS-0001", "kontrolna"]]);

  for (const word of forbidden) {
    if (header.includes(word)) fail(`Извоз садржи забрањено поље „${word}“.`);
  }

  // BOM — без њега Excel искриви ћирилицу.
  if (!header.startsWith("﻿")) fail("CSV не почиње са BOM; Excel ће искривити ћирилицу.");

  // Неутрализација формула.
  const risky = toCsv(["a"], [["=1+1"]]);
  if (!risky.includes("'=1+1")) fail("Водеће = се не неутралише; Excel би то протумачио као формулу.");

  // Неслагање броја колона мора да пукне, а не да се тихо помери.
  let threw = false;
  try {
    toCsv(["a", "b"], [["samo jedno"]]);
  } catch {
    threw = true;
  }
  if (!threw) fail("Ред са мање поља од заглавља не прекида извоз — подаци би се помериле за једно место.");
}

// ── 3. Стање у бази ───────────────────────────────────────────────────────
async function checkDatabase() {
  const settings = await getSettings();

  const forms = { A: settings.formAExam, B: settings.formBExam, C: settings.formCExam };
  const missing = FORMS.filter((f) => !forms[f]);
  if (missing.length > 0) {
    warn(
      `Форме ${missing.join(", ")} још нису везане за тест. Мерење не може да почне док се не поставе.`,
    );
  }
  for (const f of FORMS) {
    const key = forms[f];
    if (key && !examByKey(key)) {
      fail(`Форма ${f} показује на тест „${key}“, којег нема у подацима.`);
    }
  }
  if (new Set(FORMS.map((f) => forms[f]).filter(Boolean)).size < FORMS.filter((f) => forms[f]).length) {
    fail("Две форме показују на исти тест — уравнотежење тада не ради.");
  }

  const participants = await db.select().from(users).where(isNotNull(users.studyArm));

  const sizes = new Map<number, number>(ROTATION_GROUPS.map((g) => [g, 0]));
  let withoutRotation = 0;
  let withoutResearchId = 0;
  let consenting = 0;

  for (const p of participants) {
    if (p.rotationGroup === null) withoutRotation += 1;
    else sizes.set(p.rotationGroup, (sizes.get(p.rotationGroup) ?? 0) + 1);
    if (!p.researchId) withoutResearchId += 1;
    if (p.consentResearch) consenting += 1;
  }

  if (withoutRotation > 0) {
    fail(`${withoutRotation} испитаника нема ротациону групу — не могу добити форму.`);
  }
  if (withoutResearchId > 0) {
    fail(`${withoutResearchId} испитаника нема псеудоним — не могу ући у извоз.`);
  }

  const counts = ROTATION_GROUPS.map((g) => sizes.get(g) ?? 0);
  const spread = Math.max(...counts) - Math.min(...counts);
  if (participants.length > 0 && spread > 1) {
    warn(`Ротационе групе су ${counts.join(" / ")} — разлика већа од једног, уравнотежење слаби.`);
  }

  // Испити предати ван фазе мерења значе да је нешто радило са затвореним
  // термином или пре него што је фаза постављена.
  const attempts = await db.select().from(quizAttempts);
  const strayExams = attempts.filter((a) => a.examKey !== null && !a.phase);
  if (strayExams.length > 0) {
    warn(`${strayExams.length} испитних покушаја нема фазу — рађени су ван мерења.`);
  }

  console.log(`Испитаника у студији: ${participants.length} (сагласност: ${consenting})`);
  console.log(`  Ротационе групе: ${ROTATION_GROUPS.map((g) => `${g}=${sizes.get(g) ?? 0}`).join(", ")}`);
  console.log(`  Текућа фаза: ${settings.currentPhase ?? "није постављена"}`);
  console.log(`  Термин мерења: ${settings.examOpen ? "отворен" : "затворен"}`);
  console.log(`  Вежбање: ${settings.practiceOpen ? "отворено" : "затворено"}`);
  console.log(
    `  Форме: ${FORMS.map((f) => `${f}=${forms[f] ?? "—"}`).join(", ")}`,
  );
}

async function main() {
  checkLatinSquare();
  checkExportHeaders();
  await checkDatabase();

  if (warnings.length > 0) {
    console.log(`\nУпозорења (${warnings.length}):`);
    for (const w of warnings) console.log(`  - ${w}`);
  }

  if (problems.length > 0) {
    console.error(`\nНађено ${problems.length} проблема:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nНацрт студије је сагласан.");
}

main()
  .catch((err) => {
    console.error("Провера није успела:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
