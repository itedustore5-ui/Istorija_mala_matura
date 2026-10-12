import "../src/lib/load-env";

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { attemptItems, db, pool, quizAttempts, studySettings, users } from "@workspace/db";

/**
 * Резервна копија свих табела у локални фолдер.
 *
 * Подаци стоје на једном месту, код једног провајдера. Ово је једина ставка на
 * списку која може да спаси истраживање — покреће се после сваког мерења, а
 * копија иде и ван овог рачунара.
 *
 *   pnpm --filter @workspace/api-server run backup
 *   pnpm --filter @workspace/api-server run backup -- C:\putanja\do\foldera
 */

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// pnpm 11 прослеђује и `--` из `pnpm run backup -- <путања>`, па би без овога
// копија тихо завршила у фасцикли која се зове „--“.
const [folder] = process.argv.slice(2).filter((a) => a !== "--");

const target = folder
  ? resolve(folder)
  : resolve(process.cwd(), "..", "..", "backup", stamp);

async function dump(name: string, rows: unknown[]) {
  const file = join(target, `${name}.json`);
  writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
  console.log(`  ${name}: ${rows.length} редова → ${file}`);
}

async function main() {
  mkdirSync(target, { recursive: true });
  console.log(`Резервна копија у ${target}`);

  await dump("quiz_users", await db.select().from(users));
  await dump("quiz_attempts", await db.select().from(quizAttempts));
  await dump("attempt_items", await db.select().from(attemptItems));
  await dump("study_settings", await db.select().from(studySettings));

  console.log("\nГотово. Копију пренеси и ван овог рачунара.");
}

main()
  .catch((err) => {
    console.error("Резервна копија није успела:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
