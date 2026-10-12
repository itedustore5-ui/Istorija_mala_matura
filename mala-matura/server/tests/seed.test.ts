import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkPassword } from "../src/auth.js";
import { ensureAdmin, seedContent } from "../src/content.js";
import { migrate, openDatabase, type Database } from "../src/db/client.js";
import { questions, users } from "../src/db/schema.js";

/** Seed сме само да убаци оно чега нема — ништа не брише, ништа не преписује. */

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
let database: Database;

beforeAll(async () => {
  database = await openDatabase({});
  await migrate(database);
});

afterAll(async () => {
  await database?.close();
});

describe("seed", () => {
  it("први пут уписује све задатке и слике", async () => {
    const report = await seedContent(database.db, dataDir);
    expect(report).toMatchObject({ subjects: 1, questions: 120, images: 22, forms: 3, errors: [] });
  });

  it("поновно покретање не уписује ништа и не преписује измену из админа", async () => {
    await database.db.update(questions).set({ prompt: "Измењено у админу" }).where(eq(questions.number, 241));
    const again = await seedContent(database.db, dataDir);
    expect(again).toMatchObject({ subjects: 0, questions: 0, images: 0, forms: 0 });
    const [q] = await database.db.select().from(questions).where(eq(questions.number, 241));
    expect(q!.prompt).toBe("Измењено у админу");
  });

  it("постојећем админу не мења лозинку", async () => {
    expect(await ensureAdmin(database.db, "admin", "prva-lozinka")).toBe("created");
    expect(await ensureAdmin(database.db, "admin", "druga-lozinka")).toBe("exists");
    const [admin] = await database.db.select().from(users).where(eq(users.username, "admin"));
    expect(await checkPassword("prva-lozinka", admin!.passwordHash)).toBe(true);
  });

  it("миграције се могу пустити више пута", async () => {
    await expect(migrate(database)).resolves.toBeUndefined();
  });
});
