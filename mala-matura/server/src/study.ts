import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { attempts, forms, questions, studySettings, users, type StudySettings, type User } from "./db/schema.js";

/**
 * Апликација као инструмент истраживања ретенције знања.
 *
 * Све што о студији одлучује — фаза, форма, право да се вежба или мери — одлучује
 * сервер, никад тело захтева: иначе би ученик свој рад прогласио којом хоће
 * фазом, узео туђу форму или понављао тест док не испадне добро. Скривање
 * дугмета није заштита; провера стоји на самој рути.
 *
 * Фазе: T0 (почетно мерење) → вежбање → T1 → T2 → T3. Називи су редни, а
 * размак између мерења одређује истраживач отварањем термина.
 */

export const PHASES = ["T0", "T1", "T2", "T3"] as const;
export type Phase = (typeof PHASES)[number];
export const FORMS = ["A", "B", "C"] as const;
export type Form = (typeof FORMS)[number];
export const STUDY_ARMS = ["eksperimentalna", "kontrolna"] as const;
export const ROTATION_GROUPS = [1, 2, 3] as const;

export const isPhase = (v: unknown): v is Phase => (PHASES as readonly unknown[]).includes(v);
export const isForm = (v: unknown): v is Form => (FORMS as readonly unknown[]).includes(v);
export const isStudyArm = (v: unknown): v is (typeof STUDY_ARMS)[number] =>
  (STUDY_ARMS as readonly unknown[]).includes(v);

/**
 * Редослед форми по ротационој групи.
 *
 * T0–T2 чине латински квадрат: у свакој фази свака форма ради трећина
 * испитаника, па се тежина форме не меша са фазом. T3 понавља форму из T0 —
 * задржавање знања мери се на истим задацима као почетно стање. Зато се после
 * мерења тачни одговори не приказују (види `routes/tests.ts`).
 */
export const ROTATION: Record<number, Record<Phase, Form>> = {
  1: { T0: "A", T1: "B", T2: "C", T3: "A" },
  2: { T0: "B", T1: "C", T2: "A", T3: "B" },
  3: { T0: "C", T1: "A", T2: "B", T3: "C" },
};

export const formFor = (rotationGroup: number | null, phase: Phase): Form | null =>
  rotationGroup === null ? null : (ROTATION[rotationGroup]?.[phase] ?? null);

export async function getSettings(db: Db): Promise<StudySettings> {
  const [row] = await db.select().from(studySettings).where(eq(studySettings.id, 1));
  if (row) return row;
  const [created] = await db
    .insert(studySettings)
    .values({ id: 1, testOpen: false, practiceOpen: true })
    .onConflictDoNothing()
    .returning();
  return created ?? (await db.select().from(studySettings).where(eq(studySettings.id, 1)))[0]!;
}

export type Decision = { ok: true } | { ok: false; reason: string };

/**
 * Вежбање је интервенција. Контролна група га не добија — иначе обе групе
 * имају исти третман и поређење нестаје.
 */
export function canPractice(user: User, settings: StudySettings): Decision {
  if (user.role === "admin") return { ok: true };
  if (user.studyArm === "kontrolna") {
    return { ok: false, reason: "Вежбање није доступно твојој групи. Радићеш само провере знања." };
  }
  if (!settings.practiceOpen) return { ok: false, reason: "Вежбање тренутно није отворено." };
  return { ok: true };
}

export type TestAssignment = { phase: Phase; form: Form; questionIds: number[] };

/**
 * Мерење: само кад истраживач отвори термин, само форма коју ученику додељује
 * ротација, и само једном по фази (поништен покушај се не рачуна).
 */
export async function assignTest(
  db: Db,
  user: User,
  subjectId: string,
  settings: StudySettings,
): Promise<{ ok: true; assignment: TestAssignment } | { ok: false; reason: string; status: number }> {
  if (!settings.testOpen) {
    return { ok: false, status: 403, reason: "Термин за проверу знања тренутно није отворен." };
  }
  if (!isPhase(settings.currentPhase)) {
    return { ok: false, status: 403, reason: "Истраживач још није поставио фазу мерења." };
  }
  if (!user.studyArm || user.rotationGroup === null) {
    return { ok: false, status: 403, reason: "Ниси уписан у истраживање. Јави се наставнику." };
  }
  const phase = settings.currentPhase;
  const form = formFor(user.rotationGroup, phase);
  if (!form) return { ok: false, status: 403, reason: "Није ти додељена форма теста." };

  const questionIds = await formQuestionIds(db, subjectId, form);
  if (questionIds.length === 0) {
    return { ok: false, status: 403, reason: "Тест за твоју групу још није припремљен." };
  }

  const [done] = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, user.id),
        eq(attempts.subjectId, subjectId),
        eq(attempts.kind, "merenje"),
        eq(attempts.phase, phase),
        isNotNull(attempts.submittedAt),
        isNull(attempts.invalidatedAt),
      ),
    )
    .limit(1);
  if (done) return { ok: false, status: 409, reason: "Ову проверу си већ урадио." };

  return { ok: true, assignment: { phase, form, questionIds } };
}

/**
 * Задаци форме, редом како се решавају: цео тест са завршног испита (ако је
 * форма везана за тест) или задаци из збирке са бројевима које је уписао
 * истраживач. Бројеви из збирке се траже само међу задацима збирке — задаци
 * тестова имају бројеве 1–20 и не смеју да се помешају.
 */
export async function formQuestionIds(db: Db, subjectId: string, code: Form): Promise<number[]> {
  const [row] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.subjectId, subjectId), eq(forms.code, code)));
  if (!row) return [];

  if (row.testKey) {
    const list = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.testKey, row.testKey), eq(questions.active, true)))
      .orderBy(asc(questions.number));
    return list.map((q) => q.id);
  }

  const numbers = Array.isArray(row.questionNumbers) ? (row.questionNumbers as number[]) : [];
  if (numbers.length === 0) return [];
  const list = await db
    .select({ id: questions.id, number: questions.number })
    .from(questions)
    .where(
      and(
        eq(questions.subjectId, subjectId),
        isNull(questions.testKey),
        eq(questions.active, true),
        inArray(questions.number, numbers),
      ),
    );
  const byNumber = new Map(list.map((q) => [q.number, q.id]));
  return numbers.map((n) => byNumber.get(n)).filter((id): id is number => id !== undefined);
}

/**
 * Вежбање целих тестова са завршног испита. Ученик у истраживању их не добија
 * ни у експерименталној групи: тестови су форме мерења, па би их вежбањем
 * упознао пре провере и мерење би пало.
 */
export function canPracticeTests(user: User, settings: StudySettings): Decision {
  if (user.role === "admin") return { ok: true };
  if (user.studyArm) {
    return {
      ok: false,
      reason: "Тестови са завршних испита су део истраживања, па их не вежбаш — радићеш их на проверама знања.",
    };
  }
  if (!settings.practiceOpen) return { ok: false, reason: "Вежбање тренутно није отворено." };
  return { ok: true };
}

/** Ротациона група се додељује аутоматски, у најмању — да групе остану приближно једнаке. */
export async function assignRotationGroup(db: Db): Promise<number> {
  const counts = await db
    .select({ group: users.rotationGroup, n: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.rotationGroup);
  const size = new Map<number, number>(ROTATION_GROUPS.map((g) => [g, 0]));
  for (const r of counts) if (r.group !== null && size.has(r.group)) size.set(r.group, Number(r.n));
  let smallest: number = ROTATION_GROUPS[0];
  for (const g of ROTATION_GROUPS) if (size.get(g)! < size.get(smallest)!) smallest = g;
  return smallest;
}

/** Да ли је мерење почело — тада се форме више не смеју мењати. */
export async function measurementStarted(db: Db, subjectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(and(eq(attempts.subjectId, subjectId), eq(attempts.kind, "merenje"), isNull(attempts.invalidatedAt)))
    .limit(1);
  return Boolean(row);
}
