/**
 * Мења лозинку постојећем налогу. Без аргумента излистава налоге.
 *
 *   pnpm --filter @workspace/api-server run reset-password            # листа
 *   NEW_PASSWORD=... pnpm --filter @workspace/api-server run reset-password ana
 */
import "../src/lib/load-env";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool, users } from "@workspace/db";

const username = process.argv[2];

if (!username) {
  const all = await db.select().from(users).orderBy(users.username);
  console.log(`Налога: ${all.length}`);
  for (const u of all) {
    const status = u.active ? "активан" : "неактиван";
    console.log(`  ${u.username.padEnd(20)} ${u.role.padEnd(8)} ${status}  ${u.fullName}`);
  }
  await pool.end();
  process.exit(0);
}

const password = process.env.NEW_PASSWORD;
if (!password) {
  console.error("Постави NEW_PASSWORD пре покретања.");
  await pool.end();
  process.exit(1);
}
if (password.length < 8) {
  console.error("Лозинка мора имати бар осам знакова.");
  await pool.end();
  process.exit(1);
}

const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
if (!user) {
  console.error(`Налог „${username}“ не постоји.`);
  await pool.end();
  process.exit(1);
}

await db
  .update(users)
  .set({ passwordHash: await bcrypt.hash(password, 10) })
  .where(eq(users.username, username));

console.log(`Лозинка за „${username}“ је промењена.`);
await pool.end();
