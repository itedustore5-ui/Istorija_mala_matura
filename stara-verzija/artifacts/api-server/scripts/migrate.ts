/**
 * Примењује SQL миграције из `lib/db/migrations/` редом по називу.
 *
 * Нема табеле са историјом примењених миграција зато што су све писане
 * идемпотентно (IF NOT EXISTS): поновно покретање не мења ништа. Табела са
 * историјом би овде само отварала могућност да се разиђе са стварним стањем
 * базе, а корист би била никаква.
 */
// Мора стајати пре увоза `@workspace/db`: тај модул при учитавању тражи
// DATABASE_URL и баца грешку ако га нема.
import "../src/lib/load-env";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../../lib/db/migrations");

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("Нема миграција.");
  process.exit(0);
}

const client = await pool.connect();
try {
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await client.query(sql);
    console.log(`Примењено: ${file}`);
  }
} finally {
  client.release();
  await pool.end();
}

console.log("Све миграције су примењене.");
