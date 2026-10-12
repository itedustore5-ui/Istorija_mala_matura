import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Учитава `.env` из фасцикле сервера пре него што ишта прочита `process.env`.
 *
 * Постојеће вредности се не преписују: оно што је постављено на хостингу
 * (Render, Environment таб) јаче је од фајла, а фајл служи само за локални рад.
 */
export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnv(file = path.join(serverRoot, ".env")): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
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
