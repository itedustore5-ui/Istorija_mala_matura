import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";
import { MIGRATIONS } from "./migrations.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Database = {
  db: Db;
  kind: "postgres" | "pglite";
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Са `DATABASE_URL` ради прави Postgres (хостинг). Без њега се диже уграђени
 * PGlite — Postgres у самом процесу — да апликација ради локално без икакве
 * инсталације. `dataDir` чува базу на диску; без њега је база у меморији
 * (тестови).
 *
 * PGlite не дозвољава два процеса над истом фасциклом: `npm run seed` док ради
 * `npm run dev` оштетио би базу. Зато сервер оставља `server.lock`, а seed
 * одбија да ради док тај процес живи.
 */
export async function openDatabase(options: { url?: string; dataDir?: string }): Promise<Database> {
  if (options.url) {
    const pool = new pg.Pool({ connectionString: options.url });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return {
      db,
      kind: "postgres",
      exec: async (sql) => {
        await pool.query(sql);
      },
      close: () => pool.end(),
    };
  }

  if (options.dataDir) fs.mkdirSync(options.dataDir, { recursive: true });
  const client = new PGlite(options.dataDir);
  await client.waitReady;
  const db = drizzleLite(client, { schema }) as unknown as Db;
  return {
    db,
    kind: "pglite",
    exec: async (sql) => {
      await client.exec(sql);
    },
    close: () => client.close(),
  };
}

export async function migrate(database: Database): Promise<void> {
  for (const m of MIGRATIONS) await database.exec(m.sql);
}

// ── Брава за PGlite ───────────────────────────────────────────────────────

const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function lockFile(dataDir: string) {
  return path.join(dataDir, "..", "server.lock");
}

/** Ко држи базу, ако је држи жив процес; иначе null. */
export function lockedBy(dataDir: string): number | null {
  const file = lockFile(dataDir);
  if (!fs.existsSync(file)) return null;
  const pid = Number(fs.readFileSync(file, "utf8").trim());
  return Number.isInteger(pid) && pid !== process.pid && processAlive(pid) ? pid : null;
}

export function takeLock(dataDir: string): void {
  const file = lockFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(process.pid), "utf8");
  const release = () => {
    try {
      if (fs.readFileSync(file, "utf8").trim() === String(process.pid)) fs.rmSync(file);
    } catch {
      // брава је већ уклоњена
    }
  };
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      release();
      process.exit(0);
    });
  }
}
