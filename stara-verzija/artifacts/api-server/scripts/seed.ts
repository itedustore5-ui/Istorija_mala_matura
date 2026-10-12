/**
 * Прави први администраторски налог.
 *
 * Лозинка се чита из `ADMIN_INITIAL_PASSWORD`, а не пише у коду: лозинка
 * уписана у извор остаје у git историји и после сваке касније измене.
 */
import "../src/lib/load-env";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool, users } from "@workspace/db";

const username = process.env.ADMIN_USERNAME ?? "admin";
const password = process.env.ADMIN_INITIAL_PASSWORD;

if (!password) {
  console.error("Постави ADMIN_INITIAL_PASSWORD пре покретања.");
  process.exit(1);
}

// Праг је шест знакова, не осам: налог служи наставнику за приступ админ
// панелу на школском рачунару. Ако апликација изађе из те употребе, ово треба
// подићи.
if (password.length < 6) {
  console.error("Лозинка мора имати бар шест знакова.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);
const [existing] = await db
  .select()
  .from(users)
  .where(eq(users.username, username))
  .limit(1);

if (existing) {
  console.log(`Налог „${username}“ већ постоји. За промену лозинке користи reset-password.`);
} else {
  await db.insert(users).values({
    username,
    passwordHash: hash,
    fullName: "Администратор",
    role: "admin",
    active: true,
    neverExpires: true,
    quizOnce: false,
  });
  console.log(`Направљен администраторски налог „${username}“.`);
}

await pool.end();
