import type { Question, SelectedText } from "../types";

/**
 * Тестови са претходних завршних испита (мала матура).
 *
 * Држе се одвојено од збирке зато што им је бодовање другачије: на завршном
 * испиту задатак носи 0,5 или 1 поен и код већине задатака се признаје
 * делимично тачан одговор, док се задаци за вежбање бодују 0/1. Просек преко
 * једног и другог не значи ништа, па се и покушаји чувају одвојено —
 * `quiz_attempts.exam_key` је NULL за вежбање, а за испит носи кључ теста.
 */
export type ExamTest = {
  /** Стабилан кључ, нпр. „zavrsni-2025-juni“. Уписује се у покушај. */
  key: string;
  year: number;
  label: string;
  /** Рок: „јунски“, „августовски“ и сл. */
  term?: string;
  /** Укупан број поена на тесту — по правилу 20. */
  totalPoints: number;
  /** Трајање у минутима, како је прописано на испиту. */
  durationMinutes?: number;
  note?: string;
  texts: SelectedText[];
  questions: Question[];
};

/**
 * Тестови се уносе скриптом `scripts/import-exam.mjs`, која из JSON-а гради
 * фајл у овом фолдеру и додаје га овде. Листа је намерно празна док се не унесу
 * званични тестови: измишљен „пример теста са претходне године“ ученику би
 * деловао као оригинал, а не би то био.
 */
export const exams: ExamTest[] = [];

const byKey = new Map(exams.map((e) => [e.key, e]));

export const examByKey = (key: string): ExamTest | undefined => byKey.get(key);

/** Преглед за листу тестова — без задатака, да ништа не цури пре почетка. */
export const examSummaries = () =>
  exams.map((e) => ({
    key: e.key,
    year: e.year,
    label: e.label,
    term: e.term,
    totalPoints: e.totalPoints,
    durationMinutes: e.durationMinutes,
    note: e.note,
    questionCount: e.questions.length,
  }));
