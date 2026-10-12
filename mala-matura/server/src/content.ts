import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { forms, images, questions, subjects, tests, users } from "./db/schema.js";
import { hashPassword } from "./auth.js";
import { orderingIsSolved, shuffleOrdering, validateQuestion, type QuestionInput } from "./questionModel.js";
import { FORMS } from "./study.js";

/**
 * Почетни садржај: предмети, задаци и слике из `data/` уписују се у базу, а
 * тестови са завршних испита из приватне фасцикле (`data-private/`).
 *
 * Задаци живе у бази, а не у коду — после првог уписа мењају се кроз админ.
 * Зато је ово само УПИС ОНОГА ЧЕГА НЕМА: постојећи задатак (исти предмет,
 * тест и број), тест, слика или форма се не дирају, ма шта стајало у фајлу.
 * Поновно покретање seed-а не може да поништи измену направљену у админу.
 */

type SubjectFile = {
  subject: { id: string; name: string; source?: string; position?: number; sections?: unknown[] };
  questions: QuestionInput[];
};

/**
 * Тест са завршног испита. Тачни одговори и делимични бодови су искључиво из
 * „Упутства за прегледање“ Завода. Целина задатака теста је сам тест.
 */
type TestFile = {
  test: {
    key: string;
    subjectId: string;
    year: number;
    label: string;
    term?: string;
    durationMinutes?: number;
    source?: string;
    position?: number;
  };
  questions: (Omit<QuestionInput, "section"> & { section?: string })[];
};

export type SeedReport = {
  subjects: number;
  questions: number;
  tests: number;
  images: number;
  forms: number;
  errors: string[];
};

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * Админ налог из `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Постојећи налог се не
 * дира — ни лозинка: seed покренут поново не сме да поништи лозинку коју је
 * админ у међувремену променио.
 */
export async function ensureAdmin(db: Db, username: string, password: string): Promise<"created" | "exists"> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (existing) return "exists";
  await db
    .insert(users)
    .values({ username, fullName: "Администратор", role: "admin", passwordHash: await hashPassword(password) })
    .onConflictDoNothing();
  return "created";
}

async function insertQuestion(
  db: Db,
  subjectId: string,
  testKey: string | null,
  raw: QuestionInput,
  where: string,
  report: SeedReport,
) {
  const problem = validateQuestion(raw);
  if (problem) {
    report.errors.push(`${where}, задатак ${raw.number}: ${problem}`);
    return;
  }
  let content = raw.content;
  let correct = raw.correct;
  if (raw.type === "ordering" && orderingIsSolved(raw.correct as number[])) {
    const mixed = shuffleOrdering(raw.content.items as string[], raw.correct as number[]);
    content = { ...raw.content, items: mixed.items };
    correct = mixed.correct;
  }
  const rows = await db
    .insert(questions)
    .values({
      subjectId,
      testKey,
      number: raw.number,
      section: raw.section,
      type: raw.type,
      prompt: raw.prompt,
      content,
      correct,
      explanation: raw.explanation,
      points: raw.points,
      partialCredit: raw.partial ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: questions.id });
  report.questions += rows.length;
}

async function insertImages(db: Db, imagesDir: string, report: SeedReport) {
  if (!fs.existsSync(imagesDir)) return;
  for (const name of fs.readdirSync(imagesDir).sort()) {
    const mime = MIME[path.extname(name).toLowerCase()];
    if (!mime) continue;
    const rows = await db
      .insert(images)
      .values({ name, mime, data: fs.readFileSync(path.join(imagesDir, name)) })
      .onConflictDoNothing()
      .returning({ name: images.name });
    report.images += rows.length;
  }
}

export async function seedContent(
  db: Db,
  dataDir: string,
  options: { privateDir?: string } = {},
): Promise<SeedReport> {
  const report: SeedReport = { subjects: 0, questions: 0, tests: 0, images: 0, forms: 0, errors: [] };

  if (fs.existsSync(dataDir)) {
    for (const file of fs.readdirSync(dataDir).filter((f) => f.endsWith(".json")).sort()) {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")) as SubjectFile;
      const s = data.subject;

      const inserted = await db
        .insert(subjects)
        .values({
          id: s.id,
          name: s.name,
          source: s.source ?? null,
          position: s.position ?? 0,
          sections: s.sections ?? [],
        })
        .onConflictDoNothing()
        .returning({ id: subjects.id });
      report.subjects += inserted.length;

      for (const raw of data.questions) await insertQuestion(db, s.id, null, raw, file, report);

      for (const code of FORMS) {
        const rows = await db
          .insert(forms)
          .values({ subjectId: s.id, code, questionNumbers: [] })
          .onConflictDoNothing()
          .returning({ code: forms.code });
        report.forms += rows.length;
      }
    }
    await insertImages(db, path.join(dataDir, "images"), report);
  }

  // Тестови иду после предмета: тест показује на предмет.
  const privateDir = options.privateDir;
  if (privateDir && fs.existsSync(privateDir)) {
    const known = new Set((await db.select({ id: subjects.id }).from(subjects)).map((s) => s.id));
    for (const file of fs.readdirSync(privateDir).filter((f) => f.endsWith(".json")).sort()) {
      const data = JSON.parse(fs.readFileSync(path.join(privateDir, file), "utf8")) as TestFile;
      const t = data.test;
      if (!t?.key || !/^[a-z0-9-]+$/.test(t.key)) {
        report.errors.push(`${file}: кључ теста сме да садржи само мала латинична слова, цифре и цртицу.`);
        continue;
      }
      if (!known.has(t.subjectId)) {
        report.errors.push(`${file}: непознат предмет „${t.subjectId}“.`);
        continue;
      }
      const inserted = await db
        .insert(tests)
        .values({
          key: t.key,
          subjectId: t.subjectId,
          year: t.year,
          label: t.label,
          term: t.term ?? null,
          durationMinutes: t.durationMinutes ?? null,
          source: t.source ?? null,
          position: t.position ?? 0,
        })
        .onConflictDoNothing()
        .returning({ key: tests.key });
      report.tests += inserted.length;

      for (const raw of data.questions)
        await insertQuestion(db, t.subjectId, t.key, { ...raw, section: t.key }, file, report);
    }
    await insertImages(db, path.join(privateDir, "images"), report);
  }

  return report;
}
