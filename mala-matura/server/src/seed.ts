import path from "node:path";
import { loadEnv, serverRoot } from "./env.js";

loadEnv();

const { lockedBy, migrate, openDatabase } = await import("./db/client.js");
const { ensureAdmin, seedContent } = await import("./content.js");

/**
 * Почетно пуњење базе: админ налог и задаци из `data/`.
 *
 * Сме САМО да убаци оно чега нема. Постојећи налог (ни лозинку), задатак,
 * слику или форму не дира, ништа не брише — поновно покретање је безбедно и не
 * може да поништи измене из админа. Нова лозинка се поставља кроз админ.
 *
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run seed
 */

const username = process.env.ADMIN_USERNAME?.trim();
const password = process.env.ADMIN_PASSWORD;

if (!username || !password) {
  console.error("Постави ADMIN_USERNAME и ADMIN_PASSWORD (у .env или окружењу) пре покретања.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("ADMIN_PASSWORD мора имати бар 8 знакова.");
  process.exit(1);
}

const url = process.env.DATABASE_URL || undefined;
const dataDir = path.join(serverRoot, ".data", "pglite");
if (!url) {
  const pid = lockedBy(dataDir);
  if (pid) {
    console.error(
      `Сервер (процес ${pid}) тренутно користи уграђену базу. Заустави га (npm run dev) па покрени seed — ` +
        "PGlite не дозвољава два процеса над истом базом.",
    );
    process.exit(1);
  }
}

const database = await openDatabase({ url, dataDir: url ? undefined : dataDir });
try {
  await migrate(database);

  const admin = await ensureAdmin(database.db, username, password);
  console.log(
    admin === "created"
      ? `Направљен админ налог „${username}“.`
      : `Налог „${username}“ већ постоји — не дира се (ни лозинка).`,
  );

  const report = await seedContent(database.db, path.join(serverRoot, "data"));
  console.log(
    `Уписано ново: предмета ${report.subjects}, задатака ${report.questions}, слика ${report.images}, форми ${report.forms}.`,
  );
  if (report.errors.length) {
    console.error(`Прескочено због грешке (${report.errors.length}):`);
    for (const e of report.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
  }
} finally {
  await database.close();
}
