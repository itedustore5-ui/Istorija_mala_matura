import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const users = pgTable("quiz_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  // Лозинка се чува само као хеш. Апликација за српски је чувала и читљиву
  // копију да би је наставник видео; ученици су малолетни, па овде тога нема
  // — наставник лозинку поставља изнова, не чита стару.
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().default("student"),
  active: boolean("active").notNull().default(true),
  neverExpires: boolean("never_expires").notNull().default(true),
  quizOnce: boolean("quiz_once").notNull().default(false),

  // ── Истраживање ──────────────────────────────────────────────────────────
  /** Псеудоним за извоз. Име и корисничко име се никад не извозе. */
  researchId: text("research_id"),
  consentResearch: boolean("consent_research").notNull().default(false),
  /** Одељење, нпр. „VIII-2 ОШ Вук Караџић“. */
  classGroup: text("class_group"),
  /**
   * „eksperimentalna“ | „kontrolna“ | NULL (није у студији).
   * Контролна грана не добија вежбање; да га добије, обе гране имају исти
   * третман и поређење нестаје.
   */
  studyArm: text("study_arm"),
  /**
   * 1 | 2 | 3 — уравнотежење форми латинским квадратом. Одређује којим редом
   * испитаник добија форме кроз фазе, да се тежина теста не помеша са фазом.
   */
  rotationGroup: integer("rotation_group"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quizAttempts = pgTable("quiz_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  /**
   * NULL = вежбање из збирке. Кад стоји кључ теста, покушај је са завршног
   * испита из претходних година. Вежбање и испит се не мешају ни на једном
   * прегледу: бодовање им је различито (0/1 по задатку наспрам делимичних
   * поена), па је просек преко оба бесмислен.
   */
  examKey: text("exam_key"),

  /**
   * Целина збирке („241-260“…) — важи само за вежбање, за испит остаје NULL.
   * Уписује је сервер из броја задатка, никад из тела захтева.
   */
  block: text("block"),

  score: integer("score").notNull(),
  total: integer("total").notNull(),
  percentage: integer("percentage").notNull(),
  passed: boolean("passed").notNull(),

  /** Поени са испита; допуштају половине, па не могу бити integer. */
  pointsEarned: numeric("points_earned", { precision: 6, scale: 2 }),
  pointsTotal: numeric("points_total", { precision: 6, scale: 2 }),

  answers: jsonb("answers").notNull(),

  // ── Истраживање ──────────────────────────────────────────────────────────
  /**
   * „T0“ | „vezbanje“ | „T30“ | „T90“ — уписује сервер из подешавања студије,
   * никад клијент: иначе би испитаник свој рад прогласио којом хоће фазом.
   */
  phase: text("phase"),
  /** Паралелна форма теста („A“ | „B“ | „C“); за вежбање остаје NULL. */
  form: text("form"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  /** Само оно што треба за тумачење (нпр. да ли је мобилни). Без IP адресе. */
  clientInfo: jsonb("client_info"),

  /** Поништен покушај се не брише него означава, да се види и у извозу. */
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidatedBy: integer("invalidated_by"),
  invalidatedReason: text("invalidated_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Један ред = један задатак у једном покушају.
 *
 * Из покушаја се зна колико је неко знао; одавде се зна ШТА је знао — тежина
 * сваке ставке, дискриминативност, поређење типова задатака и, пре свега, шта
 * је заборављено између два мерења. Накнадно се не може реконструисати.
 */
export const attemptItems = pgTable(
  "attempt_items",
  {
    id: serial("id").primaryKey(),
    attemptId: integer("attempt_id")
      .notNull()
      .references(() => quizAttempts.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    questionId: integer("question_id").notNull(),
    questionType: text("question_type").notNull(),

    block: text("block"),
    textKey: text("text_key"),

    answerRaw: text("answer_raw").notNull(),
    isCorrect: boolean("is_correct").notNull(),

    pointsEarned: numeric("points_earned", { precision: 6, scale: 2 }),
    pointsMax: numeric("points_max", { precision: 6, scale: 2 }),

    /**
     * Дуго задржавање уз тачан одговор значи несигурно знање; такве ставке
     * прве „падну“ на каснијем мерењу.
     */
    timeSpentMs: integer("time_spent_ms"),
    position: integer("position"),
  },
  (t) => [
    index("attempt_items_attempt_idx").on(t.attemptId),
    index("attempt_items_question_idx").on(t.questionId),
  ],
);

/**
 * Један ред (id = 1). Истраживач поставља текућу фазу и отвара термин; сервер
 * тиме означава сваки предати рад — један прекидач, без уноса по испитанику.
 */
export const studySettings = pgTable("study_settings", {
  id: integer("id").primaryKey(),
  currentPhase: text("current_phase"),
  examOpen: boolean("exam_open").notNull().default(false),
  practiceOpen: boolean("practice_open").notNull().default(true),

  /**
   * Које су три паралелне форме у употреби. Стоје у бази да се нов тест може
   * пустити без измене кода — али се, кад мерење почне, више не смеју мењати.
   */
  formAExam: text("form_a_exam"),
  formBExam: text("form_b_exam"),
  formCExam: text("form_c_exam"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer("updated_by"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type AttemptItem = typeof attemptItems.$inferSelect;
export type StudySettings = typeof studySettings.$inferSelect;
