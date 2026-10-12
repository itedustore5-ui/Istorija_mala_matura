/**
 * Позиви серверу и типови онако како их сервер шаље.
 *
 * Кључ (`correct`) и објашњење нису део задатка — стижу само у одговору на
 * `/submit` (тип `Reveal`). Клијент нигде не пореди одговор са тачним.
 */

export const TOKEN_KEY = "mala-matura-token";

export type TableCell = string | { text: string; rowSpan?: number; colSpan?: number };
export type DataTable = { caption?: string; head: TableCell[]; rows: TableCell[][] };

export type QuestionType = "single" | "multi" | "text" | "matching" | "ordering";

export type Question = {
  id: number;
  number: number;
  section: string;
  type: QuestionType;
  prompt: string;
  points: number;
  content: {
    passage?: string;
    source?: string;
    image?: string;
    table?: DataTable;
    hint?: string;
    options?: string[];
    optionImages?: string[];
    fields?: { label: string }[];
    rows?: string[];
    columns?: string[];
    items?: string[];
    initialOrder?: number[];
  };
};

/** Одговор у облику који очекује `server/src/scoring.ts`. */
export type Answer = number | number[] | string[] | (number | null)[] | null;

export type Reveal = {
  questionId: number;
  alreadySubmitted: boolean;
  answer: Answer;
  isCorrect: boolean;
  points: number;
  correct: unknown;
  explanation: string;
};

export type User = {
  id: number;
  username: string;
  fullName: string;
  role: "admin" | "student";
  studyArm: string | null;
};

export type Section = {
  key: string;
  label: string;
  pages: string | null;
  questionCount: number;
  attempts: number;
  bestPercent: number | null;
};

export type Subject = {
  id: string;
  name: string;
  source: string | null;
  practice: { ok: boolean; reason?: string };
  test: { available: boolean; phase?: string; reason?: string };
  sections: Section[];
};

export type Summary = {
  attemptId: number;
  score: number;
  maxScore: number;
  answered: number;
  total: number;
  percentage: number;
  phase?: string | null;
  form?: string | null;
};

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`/api${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401 && token) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.assign("/");
  }
  if (!res.ok) throw new Error((data as { message?: string } | null)?.message ?? "Дошло је до грешке.");
  return data as T;
}

/** Преузимање фајла (CSV) уз токен — обичан линк не шаље заглавље за пријаву. */
export async function download(path: string, filename: string) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("Преузимање није успело.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const imageUrl = (name: string) => `/api/images/${encodeURIComponent(name)}`;

/** Од уређаја се шаље само оно што треба за тумачење; IP адресу сервер не бележи. */
export const clientInfo = () => ({
  mobile: window.matchMedia("(max-width: 767px)").matches,
  screen: `${window.screen.width}x${window.screen.height}`,
});

/** „1 задатак“, „3 задатка“, „5 задатака“, „12 задатака“, „22 задатка“. */
export function zadataka(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} задатак`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} задатка`;
  return `${n} задатака`;
}

/** Да ли је одговор попуњен довољно да се провери. */
export function isAnswered(q: Question, a: Answer | undefined): boolean {
  if (a === null || a === undefined) return false;
  switch (q.type) {
    case "single":
      return typeof a === "number";
    case "multi":
      return Array.isArray(a) && a.length > 0;
    case "text":
      return Array.isArray(a) && a.some((v) => typeof v === "string" && v.trim() !== "");
    case "matching":
      return Array.isArray(a) && a.some((v) => typeof v === "number");
    case "ordering":
      return Array.isArray(a) && a.length === (q.content.items?.length ?? 0);
  }
}
