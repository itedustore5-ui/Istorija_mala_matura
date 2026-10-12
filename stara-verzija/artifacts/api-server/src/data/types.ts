// Модел задатака прати Збирку задатака за завршни испит у основном образовању
// и васпитању (ЗВКОВ, 2025/2026), део ИСТОРИЈА: задаци 241–360, у једном низу.
//
// Збирка историју не дели на нивое ни области — задаци иду редом, без
// наслова између. Апликација не измишља своју поделу: целине за вежбање су
// само узастопни бројеви из збирке, по двадесет, па ученик увек зна где је
// у књизи. Целина се зато изводи из броја задатка и не пише се на задатак.

export type BlockKey =
  | "241-260"
  | "261-280"
  | "281-300"
  | "301-320"
  | "321-340"
  | "341-360";

export type Block = {
  key: BlockKey;
  from: number;
  to: number;
  label: string;
  /** Стране збирке на којима стоје задаци целине. */
  pages: string;
};

export const BLOCKS: Block[] = [
  { key: "241-260", from: 241, to: 260, label: "Задаци 241–260", pages: "стр. 63–66" },
  { key: "261-280", from: 261, to: 280, label: "Задаци 261–280", pages: "стр. 66–71" },
  { key: "281-300", from: 281, to: 300, label: "Задаци 281–300", pages: "стр. 72–81" },
  { key: "301-320", from: 301, to: 320, label: "Задаци 301–320", pages: "стр. 81–86" },
  { key: "321-340", from: 321, to: 340, label: "Задаци 321–340", pages: "стр. 87–91" },
  { key: "341-360", from: 341, to: 360, label: "Задаци 341–360", pages: "стр. 91–99" },
];

export const isBlockKey = (value: unknown): value is BlockKey =>
  BLOCKS.some((b) => b.key === value);

/** Целина којој задатак припада; `null` за задатке ван збирке (тестови). */
export const blockOf = (id: number): BlockKey | null =>
  BLOCKS.find((b) => id >= b.from && id <= b.to)?.key ?? null;

/**
 * Табела уз задатак (подаци о увозу, односу снага…). Чува се као текст, а не
 * као исечена слика: на телефону се слика табеле смањи до нечитљивости, а
 * табела у HTML-у се прелама и скролује.
 */
export type TableCell = string | { text: string; rowSpan?: number; colSpan?: number };

export type DataTable = {
  caption?: string;
  head: TableCell[];
  rows: TableCell[][];
};

type Base = {
  /** Број задатка у збирци — исти онај који ученик види у књизи. */
  id: number;
  /** Кључ текста из теста са завршног испита; задаци из збирке га немају. */
  textKey?: string;
  points: number;
  question: string;
  /** Одломак из историјског извора који стоји изнад захтева. */
  passage?: string;
  /** Извор одломка, нпр. „Борба, 19. октобар 1969.“ */
  source?: string;
  /**
   * Назив слике у `public/images/` (карта, фотографија, графикон). Чува се
   * само назив: путању гради клијент, па премештање фолдера не тражи измену
   * података о задацима.
   */
  image?: string;
  table?: DataTable;
  explanation: string;
};

/** Обој кружић испред тачног одговора. */
export type SingleQ = Base & {
  type: "single";
  options: string[];
  /**
   * Кад су понуђени одговори слике („обој кружић испод оног који…“), ово су
   * називи слика редом; `options` су тада само натписи испод њих.
   */
  optionImages?: string[];
  correctAnswer: number;
};

/** Обој кружиће испред свих тачних одговора. */
export type MultiQ = Base & {
  type: "multi";
  options: string[];
  optionImages?: string[];
  correctAnswers: number[];
};

/**
 * Напиши / допуни одговор. Свако поље има своју листу прихватљивих облика.
 */
export type FillQ = Base & {
  type: "fill";
  fields: { label: string; accepted: string[] }[];
  hint?: string;
};

/**
 * Повежи ставке леве и десне колоне. У збирци историје то су табеле „обој
 * кружић у одговарајућем пољу“: редови табеле су леве ставке, колоне десне.
 * Више редова сме да има исту колону (два феномена у XX веку).
 */
export type MatchQ = Base & {
  type: "match";
  leftItems: string[];
  rightItems: string[];
  /** correctPairs[индекс леве ставке] = индекс десне ставке. */
  correctPairs: number[];
  /** Тачно је када десна колона има ставки више него лева („једна је вишак“). */
  extraRight?: boolean;
};

/** Поређај ставке по траженом редоследу. */
export type OrderQ = Base & {
  type: "order";
  items: string[];
  /** correctOrder[индекс ставке] = позиција (1-базно). */
  correctOrder: number[];
};

/** Тачно / нетачно по тврдњи. */
export type TrueFalseQ = Base & {
  type: "tf";
  statements: string[];
  /** correct[i] = тачна вредност тврдње i. */
  correct: boolean[];
  /** Натписи колона; подразумевано „Тачно“/„Нетачно“. */
  trueLabel?: string;
  falseLabel?: string;
};

/**
 * Подвуци / обој кружиће испод тражених речи у датом тексту.
 * Текст је унапред исечен на жетоне; ученик бира подскуп.
 */
export type PickQ = Base & {
  type: "pick";
  tokens: string[];
  correctTokens: number[];
};

/**
 * Одговор који ученик пише слободно. Сервер га НЕ бодује: не постоји начин да
 * се аутоматски процени да ли је образложење прихватљиво, а погрешно бодовање
 * би искривило статистику. После предаје се приказује модел одговора.
 */
export type OpenQ = Base & {
  type: "open";
  /** Оквирни број редова поља за одговор. */
  lines?: number;
  acceptable: string;
  unacceptable?: string;
};

export type Question =
  | SingleQ
  | MultiQ
  | FillQ
  | MatchQ
  | OrderQ
  | TrueFalseQ
  | PickQ
  | OpenQ;

/** Типови које сервер уме да бодује; `open` намерно није међу њима. */
export const SCORED_TYPES = [
  "single",
  "multi",
  "fill",
  "match",
  "order",
  "tf",
  "pick",
] as const;

export const isScored = (q: Question) =>
  (SCORED_TYPES as readonly string[]).includes(q.type);

/** Текст уз тест са завршног испита. */
export type SelectedText = {
  key: string;
  title: string;
  author?: string;
  /** Пасуси; празан низ раздваја строфе. */
  body: string[];
  note?: string;
};

/**
 * Прихватљиви облици кад се тражи више појмова, а редослед није битан
 * („Која се три града налазе на простору Феникије?“).
 *
 * Једно поље уместо по једног за сваки појам: са више поља ученик који исти
 * град упише двапут добио би поен. Прима сваки редослед, са зарезима или са
 * „и“ пре последњег појма.
 */
export function anyOrder(parts: string[]): string[] {
  const permutations = (list: string[]): string[][] =>
    list.length <= 1
      ? [list]
      : list.flatMap((item, i) =>
          permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]),
        );

  const out = new Set<string>();
  for (const p of permutations(parts)) {
    out.add(p.join(", "));
    out.add(`${p.slice(0, -1).join(", ")} и ${p[p.length - 1]}`);
  }
  return [...out];
}
