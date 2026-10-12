import { eq, sql } from "drizzle-orm";
import { db, studySettings, users, type StudySettings, type User } from "@workspace/db";

/**
 * Апликација као инструмент истраживања.
 *
 * Она има две улоге истовремено: алат за учење и инструмент мерења. Те две
 * улоге се сукобљавају — оно што је добро за учење (вежбај колико хоћеш, види
 * одмах тачан одговор, понови тест) уништава мерење. Кад се сукобе, предност
 * има мерење: лош приказ се поправи сутра, а погрешно прикупљен податак се не
 * поправља никад, јер испитаник кроз прво мерење пролази само једном.
 *
 * Овде стоји све што о студији одлучује сервер. Ништа од овога не сме да зависи
 * од тела захтева.
 */

/**
 * Називи фаза су временски (T30, T90), а не редни (T1, T2): из података се
 * после види шта је мерио онај ко их чита, без легенде.
 */
export const PHASES = ["T0", "vezbanje", "T30", "T90"] as const;
export type Phase = (typeof PHASES)[number];

/** Фазе у којима се стварно мери — само у њима се додељује форма. */
export const MEASUREMENT_PHASES = ["T0", "T30", "T90"] as const;
export type MeasurementPhase = (typeof MEASUREMENT_PHASES)[number];

export const FORMS = ["A", "B", "C"] as const;
export type Form = (typeof FORMS)[number];

export const STUDY_ARMS = ["eksperimentalna", "kontrolna"] as const;
export type StudyArm = (typeof STUDY_ARMS)[number];

export const isPhase = (v: unknown): v is Phase =>
  (PHASES as readonly unknown[]).includes(v);

export const isMeasurementPhase = (v: unknown): v is MeasurementPhase =>
  (MEASUREMENT_PHASES as readonly unknown[]).includes(v);

export const isStudyArm = (v: unknown): v is StudyArm =>
  (STUDY_ARMS as readonly unknown[]).includes(v);

/**
 * Уравнотежење форми латинским квадратом.
 *
 * Ако сви на T0 раде форму A, а на T30 форму B, тежина теста се меша са фазом —
 * не зна се да ли је пад од заборављања или зато што је B био тежи. Ротацијом
 * је свака форма подједнако заступљена у свакој фази, па се разлике у тежини
 * поништавају.
 */
const LATIN_SQUARE: Record<number, Record<MeasurementPhase, Form>> = {
  1: { T0: "A", T30: "B", T90: "C" },
  2: { T0: "B", T30: "C", T90: "A" },
  3: { T0: "C", T30: "A", T90: "B" },
};

export const ROTATION_GROUPS = [1, 2, 3] as const;

/** Форма коју испитаник добија у датој фази мерења. */
export function formFor(rotationGroup: number | null, phase: MeasurementPhase): Form | null {
  if (rotationGroup === null) return null;
  return LATIN_SQUARE[rotationGroup]?.[phase] ?? null;
}

/** Тест који та форма означава у текућим подешавањима. */
export function examKeyForForm(settings: StudySettings, form: Form): string | null {
  const byForm: Record<Form, string | null> = {
    A: settings.formAExam,
    B: settings.formBExam,
    C: settings.formCExam,
  };
  return byForm[form];
}

/** Ред подешавања увек постоји; ако га нема, прави се празан. */
export async function getSettings(): Promise<StudySettings> {
  const [row] = await db.select().from(studySettings).where(eq(studySettings.id, 1));
  if (row) return row;

  const [created] = await db
    .insert(studySettings)
    .values({ id: 1, examOpen: false, practiceOpen: true })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [again] = await db.select().from(studySettings).where(eq(studySettings.id, 1));
  return again!;
}

/**
 * Ротациона група се додељује аутоматски, у најмању — да групе остану
 * приближно једнаке. Ручна додела би их с временом развукла, а уравнотежење
 * ради само ако су групе сличне величине.
 */
export async function assignRotationGroup(): Promise<number> {
  const counts = await db
    .select({ group: users.rotationGroup, n: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.rotationGroup);

  const size = new Map<number, number>(ROTATION_GROUPS.map((g) => [g, 0]));
  for (const row of counts) {
    if (row.group !== null && size.has(row.group)) size.set(row.group, row.n);
  }

  let smallest: number = ROTATION_GROUPS[0];
  for (const g of ROTATION_GROUPS) {
    if (size.get(g)! < size.get(smallest)!) smallest = g;
  }
  return smallest;
}

/** Одлука зашто испитаник не може да ради; текст иде ученику. */
export type Denied = { ok: false; reason: string };
export type Allowed = { ok: true };

/**
 * Вежбање је интервенција — независна променљива. Контролна грана га не добија,
 * јер би иначе обе гране имале исти третман.
 *
 * Скривање дугмета није заштита: провера мора да стоји на самој путањи.
 */
export function canPractice(user: User, settings: StudySettings): Allowed | Denied {
  if (user.role === "admin") return { ok: true };

  if (user.studyArm === "kontrolna") {
    return {
      ok: false,
      reason: "Вежбање није доступно твојој групи. Радићеш само провере знања.",
    };
  }

  if (!settings.practiceOpen) {
    return { ok: false, reason: "Вежбање тренутно није отворено." };
  }

  return { ok: true };
}

/**
 * Мерење се ради само кад истраживач отвори термин и само у фази мерења.
 * Испитаник не бира ни тест ни тренутак — иначе би исти тест пре T30 урадио
 * више пута и мерење ретенције би пало.
 */
export function canMeasure(settings: StudySettings): Allowed | Denied {
  if (!settings.examOpen) {
    return { ok: false, reason: "Термин за проверу знања тренутно није отворен." };
  }
  if (!isMeasurementPhase(settings.currentPhase)) {
    return { ok: false, reason: "Истраживач још није поставио фазу мерења." };
  }
  return { ok: true };
}

/** Тест који баш овај испитаник треба да ради у текућој фази. */
export function assignedExam(
  user: User,
  settings: StudySettings,
): { form: Form; examKey: string } | null {
  if (!isMeasurementPhase(settings.currentPhase)) return null;

  const form = formFor(user.rotationGroup, settings.currentPhase);
  if (!form) return null;

  const examKey = examKeyForForm(settings, form);
  if (!examKey) return null;

  return { form, examKey };
}

/**
 * Фаза којом се означава предати рад. Узима се из подешавања, никад из тела
 * захтева. За вежбање се, ако фаза није постављена, уписује „vezbanje“, да се
 * доза интервенције може сабрати и пре него што мерење почне.
 */
export function phaseForAttempt(settings: StudySettings, kind: "practice" | "exam"): string | null {
  if (kind === "exam") {
    return isMeasurementPhase(settings.currentPhase) ? settings.currentPhase : null;
  }
  return settings.currentPhase ?? "vezbanje";
}
