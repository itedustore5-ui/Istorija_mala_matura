/**
 * Нормализација слободно уписаног одговора пре поређења.
 *
 * Дете које откуца „Imenica“ мора добити исто као оно које откуца „именица“:
 * на телефону је тастатура често на латиници, а знање је исто. Зато се
 * латиница пресловљава у ћирилицу, и то исто и за одговор ученика и за
 * прихватљиве облике из кључа.
 *
 * Изједначава се и оно што је куцање, а не знање: велика слова, вишак размака,
 * размак око зареза, дуга и кратка цртица у распону година, тачка на крају.
 */

const DIGRAPHS: [string, string][] = [
  ["dž", "џ"],
  ["lj", "љ"],
  ["nj", "њ"],
];

const LETTERS: Record<string, string> = {
  a: "а",
  b: "б",
  c: "ц",
  č: "ч",
  ć: "ћ",
  d: "д",
  đ: "ђ",
  e: "е",
  f: "ф",
  g: "г",
  h: "х",
  i: "и",
  j: "ј",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  r: "р",
  s: "с",
  š: "ш",
  t: "т",
  u: "у",
  v: "в",
  z: "з",
  ž: "ж",
  // Нема га у српској латиници, али се њиме пишу римски бројеви („XIX“), а
  // ћириличко „Х“ изгледа исто — ученик куца једно или друго.
  x: "х",
};

export function transliterate(value: string): string {
  let out = value;
  for (const [latin, cyrillic] of DIGRAPHS) out = out.split(latin).join(cyrillic);
  return [...out].map((ch) => LETTERS[ch] ?? ch).join("");
}

export function normalizeText(value: string): string {
  const lowered = value.normalize("NFC").toLowerCase();
  return transliterate(lowered)
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "")
    .trim();
}
