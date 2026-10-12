import path from "node:path";
import { loadEnv, serverRoot } from "./env.js";

loadEnv();

const { createApp } = await import("./app.js");
const { lockedBy, migrate, openDatabase, takeLock } = await import("./db/client.js");
const { sessionSecret } = await import("./auth.js");
const { subjects } = await import("./db/schema.js");

/**
 * Покретање сервера.
 *
 * Са `DATABASE_URL` ради над правим Postgres-ом (хостинг). Без њега диже
 * уграђени PGlite у `server/.data/pglite`, да апликација ради локално без
 * икакве инсталације базе.
 */

sessionSecret(); // у продукцији пуца одмах ако тајна није постављена

const url = process.env.DATABASE_URL || undefined;
const dataDir = path.join(serverRoot, ".data", "pglite");

if (!url) {
  const pid = lockedBy(dataDir);
  if (pid) {
    console.error(`Базу у ${dataDir} већ користи процес ${pid}. Заустави га па покрени поново.`);
    process.exit(1);
  }
  takeLock(dataDir);
}

const database = await openDatabase({ url, dataDir: url ? undefined : dataDir });
await migrate(database);

const known = await database.db.select({ id: subjects.id }).from(subjects);
if (known.length === 0) {
  console.warn("У бази још нема задатака. Заустави сервер и покрени: npm run seed");
}

const app = createApp(database.db, { clientDir: path.resolve(serverRoot, "..", "client", "dist") });
const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(
    `Сервер ради на http://localhost:${port} (база: ${database.kind === "pglite" ? `уграђени PGlite, ${dataDir}` : "PostgreSQL"})`,
  );
});
