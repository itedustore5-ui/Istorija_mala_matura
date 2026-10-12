/**
 * Учитава `.env` из корена репозиторијума пре него што било шта дотакне
 * `process.env`.
 *
 * Скрипте се покрећу из `artifacts/api-server`, а `.env` стоји у корену, па би
 * без овога свака скрипта тражила да јој се `DATABASE_URL` дописује у команду —
 * а онда би се лозинка базе нашла у историји љуске.
 *
 * Постојеће променљиве се не преписују: оно што је већ у окружењу (нпр. на
 * серверу) јаче је од фајла.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "../../../../.env");

if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
