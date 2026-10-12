// Типови прате оно што сервер стварно шаље. Тачни одговори нису део задатка
// него стижу тек у одговору на предају (`AttemptResult.reveal`) — зато их овде
// и нема на `Question`.

/** Целина збирке — двадесет узастопних задатака, „241-260“… */
export type BlockKey = string;

export type QuestionType =
  | "single"
  | "multi"
  | "fill"
  | "match"
  | "order"
  | "tf"
  | "pick"
  | "open";

export type TableCell = string | { text: string; rowSpan?: number; colSpan?: number };

export type DataTable = {
  caption?: string;
  head: TableCell[];
  rows: TableCell[][];
};

export type Question = {
  id: number;
  textKey?: string;
  points: number;
  type: QuestionType;
  question: string;
  passage?: string;
  source?: string;
  image?: string;
  table?: DataTable;
  scored: boolean;
  options?: string[];
  /** Кад су понуђени одговори слике; `options` су тада натписи испод њих. */
  optionImages?: string[];
  fields?: { label: string }[];
  hint?: string;
  leftItems?: string[];
  rightItems?: string[];
  extraRight?: boolean;
  items?: string[];
  statements?: string[];
  trueLabel?: string;
  falseLabel?: string;
  tokens?: string[];
  lines?: number;
};

export type Revealed = {
  id: number;
  explanation: string;
  correctAnswer?: number;
  correctAnswers?: number[];
  correctFields?: string[][];
  correctPairs?: number[];
  correctOrder?: number[];
  correct?: boolean[];
  correctTokens?: number[];
  acceptable?: string;
  unacceptable?: string;
};

/** Одговор на проверу једног задатка; `correct` је null за задатке писања. */
export type CheckResult = {
  id: number;
  scored: boolean;
  correct: boolean | null;
  reveal: Revealed;
};

export type AttemptResult = {
  id: number;
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  createdAt: string;
  reveal: Revealed[];
  results: { id: number; correct: boolean }[];
};

export type ExamAttemptResult = {
  id: number;
  pointsEarned: number;
  pointsTotal: number;
  percentage: number;
  createdAt: string;
  reveal: Revealed[];
  results: { id: number; points: number; maxPoints: number }[];
};

export type CatalogBlock = {
  key: BlockKey;
  label: string;
  /** Стране збирке, нпр. „стр. 63–66“. */
  pages: string;
  questionCount: number;
  scoredCount: number;
  bestScore: number | null;
  attemptsCount: number;
};

export type Catalog = {
  /** Контролна грана не вежба; каталог се и тада приказује, али са разлогом. */
  practiceAllowed: boolean;
  practiceReason: string | null;
  blocks: CatalogBlock[];
};

export type SelectedText = {
  key: string;
  title: string;
  author?: string;
  body: string[];
  note?: string;
};

export type DashboardStats = {
  attemptsCount: number;
  bestScore: number;
  lastScore: number | null;
  solvedCount: number;
  questionCount: number;
  blockScores: {
    key: BlockKey;
    label: string;
    attemptsCount: number;
    bestScore: number | null;
  }[];
};

export type ExamSummary = {
  key: string;
  year: number;
  label: string;
  term?: string;
  totalPoints: number;
  durationMinutes?: number;
  note?: string;
  questionCount: number;
  attemptsCount: number;
  bestPoints: number | null;
};

export type ExamDetail = {
  key: string;
  year: number;
  label: string;
  term?: string;
  totalPoints: number;
  durationMinutes?: number;
  note?: string;
  texts: SelectedText[];
  questions: Question[];
};

export type AuthUser = {
  id: number;
  username: string;
  fullName: string;
  role: "admin" | "student";
  active: boolean;
  neverExpires: boolean;
  quizOnce: boolean;
};

export type ScoreboardEntry = {
  rank: number;
  username: string;
  fullName: string;
  bestScore: number;
  attemptsCount: number;
  lastScore: number | null;
};

/** Лозинка се не враћа ни админу — сервер је чува само као хеш. */
export type AdminUser = AuthUser & { createdAt: string };

export type AdminResult = {
  id: number;
  userId: number;
  username: string;
  fullName: string;
  examKey: string | null;
  block: BlockKey | null;
  score: number;
  total: number;
  percentage: number;
  pointsEarned: number | null;
  pointsTotal: number | null;
  passed: boolean;
  createdAt: string;
};

// Друкчији кључ него у апликацији за српски: обе апликације могу да раде на
// истом рачунару (и истом домену у развоју), па би делиле пријаву.
export const TOKEN_KEY = "istorija-matura-token";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data as { message?: string })?.message ?? "Дошло је до грешке.");
  }
  return data as T;
}

/** „241-260“ → „Задаци 241–260“; натпис се гради из кључа, не држи се листа. */
export const blockLabel = (key: string) => `Задаци ${key.replace("-", "–")}`;

/**
 * Одговор се шаље као стринг, у формату који сервер очекује по типу задатка.
 * Клијент нигде не пореди одговор са тачним — тачан одговор ни не добија док
 * не преда своје решење.
 */
export type AnswerMap = Record<number, string>;

// ── Истраживање ────────────────────────────────────────────────────────────
// Апликација уз улогу алата за учење служи и као инструмент мерења. Ови типови
// прате оно што о студији враћа сервер; клијент ни овде ништа не одлучује.

export type Phase = "T0" | "vezbanje" | "T30" | "T90";
export type MeasurementPhase = "T0" | "T30" | "T90";
export type StudyArm = "eksperimentalna" | "kontrolna";

export type StudySettings = {
  currentPhase: Phase | null;
  examOpen: boolean;
  practiceOpen: boolean;
  forms: { A: string | null; B: string | null; C: string | null };
  updatedAt: string;
  options?: {
    phases: Phase[];
    measurementPhases: MeasurementPhase[];
    forms: ("A" | "B" | "C")[];
    arms: StudyArm[];
    rotationGroups: number[];
    exams: { key: string; label: string }[];
  };
};

export type CompletionRow = {
  id: number;
  fullName: string;
  researchId: string | null;
  classGroup: string | null;
  studyArm: StudyArm | null;
  rotationGroup: number | null;
  consentResearch: boolean;
  practiceCount: number;
  practiceMs: number;
  measurements: Record<
    MeasurementPhase,
    { done: true; percentage: number; at: string } | { done: false; expectedForm: string | null }
  >;
};

export type Completion = {
  currentPhase: Phase | null;
  examOpen: boolean;
  rows: CompletionRow[];
};

export type ResearchAttempt = {
  id: number;
  userId: number;
  fullName: string;
  researchId: string | null;
  examKey: string | null;
  block: BlockKey | null;
  phase: Phase | null;
  form: string | null;
  percentage: number;
  durationMs: number | null;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
  createdAt: string;
};

/**
 * Подаци о уређају колико треба за тумачење (нпр. да ли је рађено на телефону).
 * IP адресу клијент не шаље, а сервер је ни не бележи.
 */
export function clientInfo() {
  return {
    userAgent: navigator.userAgent,
    screen: `${window.screen.width}x${window.screen.height}`,
    mobile: window.matchMedia("(max-width: 767px)").matches,
  };
}
