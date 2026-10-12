import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Провера да ниједан текст који види корисник не меша писма.
 *
 * `verify:scoring` то проверава над задацима, али поруке апликације — грешке,
 * дугмад, натписи — стоје у самом коду и нису биле проверене ниједном. Тако је
 * у поруци за пријаву месецима стајало „корисничко ime“: латинично усред
 * ћириличне реченице, готово невидљиво на екрану.
 *
 * Проверавају се само стрингови у изворном коду, не и коментари: коментари су
 * писани латиницом намерно.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SKIP = new Set(["node_modules", ".git", "dist", "backup", "attached_assets"]);

const isCyrillic = (ch: string) => /\p{Script=Cyrillic}/u.test(ch);
const isLatin = (ch: string) => /[a-zA-Z]|[šđčćžŠĐČĆŽ]/u.test(ch);

/** Наводници сва три облика, са прескакањем избегнутих знакова. */
const STRINGS = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/gs;

const problems: string[] = [];

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(name)) yield full;
  }
}

for (const file of sourceFiles(ROOT)) {
  const text = readFileSync(file, "utf8");

  for (const match of text.matchAll(STRINGS)) {
    const literal = match[0].slice(1, -1);
    if (![...literal].some(isCyrillic)) continue;

    const line = text.slice(0, match.index).split("\n").length;

    // `${...}` је код, а `\n` и `\"` нису текст.
    const clean = literal.replace(/\$\{[^}]*\}/g, " ").replace(/\\./g, " ");

    for (const word of clean.split(/[^\p{L}\p{N}]+/u)) {
      if (![...word].some(isCyrillic)) continue;
      const stray = [...word].find(isLatin);
      if (stray) {
        problems.push(
          `${relative(ROOT, file)}:${line}  реч „${word}“ меша ћирилицу и латинично „${stray}“`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`Нађено ${problems.length} места где се мешају писма:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("Ниједан текст у коду не меша писма.");
