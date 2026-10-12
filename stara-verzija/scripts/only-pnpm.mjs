import { rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Одбија инсталацију преко npm-а или yarn-а.
 *
 * Раније је ово била `sh -c '…'` линија у package.json. Она ради у Git Bashu,
 * али у PowerShellu и cmd-у `sh` не постоји, па је свако `pnpm install` са
 * измењеним package.json пуцало пре него што уопште почне. Node је ту увек.
 */

const agent = process.env.npm_config_user_agent ?? "";
const root = resolve(import.meta.dirname, "..");

for (const stray of ["package-lock.json", "yarn.lock"]) {
  rmSync(resolve(root, stray), { force: true });
}

if (/^(npm|yarn)\//.test(agent)) {
  console.error("Овај пројекат се инсталира са pnpm.");
  process.exit(1);
}
