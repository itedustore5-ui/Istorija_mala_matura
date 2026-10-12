import {
  bigserial,
  boolean,
  customType,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Шема базе. Табеле прави `migrations.ts` (SQL); тестови пуштају све упите
 * кроз ову шему над базом из тих миграција, па се разилажење одмах види.
 */

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

export const subjects = pgTable("subjects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Одакле су задаци, нпр. „Збирка задатака за завршни испит 2025/2026“. */
  source: text("source"),
  position: integer("position").notNull().default(0),
  /** Целине за вежбање: [{ key, label, pages }] — редом као у збирци. */
  sections: jsonb("sections").notNull().default([]),
});

/**
 * Тестови са претходних завршних испита (2023–2026). Користе се као форме
 * мерења у истраживању; ученици ван истраживања их могу вежбати.
 *
 * Садржај теста не сме јавно да се објављује без сагласности Завода (пише на
 * свакој страни теста), па подаци за упис стоје у `data-private/`, ван git-а.
 */
export const tests = pgTable("tests", {
  key: text("key").primaryKey(),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  year: integer("year").notNull(),
  label: text("label").notNull(),
  term: text("term"),
  durationMinutes: integer("duration_minutes"),
  source: text("source"),
  position: integer("position").notNull().default(0),
});

export const questions = pgTable(
  "questions",
  {
    id: serial("id").primaryKey(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id),
    /**
     * NULL за задатак из збирке; кључ теста за задатак са завршног испита.
     * Број је јединствен у оквиру предмета и теста (индекс у миграцији 0002):
     * задаци теста имају бројеве 1–20 као на папиру.
     */
    testKey: text("test_key").references(() => tests.key),
    /** Број задатка у збирци (или у тесту) — исти онај који ученик види на папиру. */
    number: integer("number").notNull(),
    section: text("section").notNull(),
    type: text("type").notNull(),
    prompt: text("prompt").notNull(),
    /** Све што ученик види: понуђени одговори, одломак, слика, табела… */
    content: jsonb("content").notNull(),
    /** Кључ. Никад не напушта сервер пре предаје — види `sanitize.ts`. */
    correct: jsonb("correct").notNull(),
    explanation: text("explanation").notNull().default(""),
    points: integer("points").notNull().default(1),
    /** Делимични бодови из упутства за прегледање, нпр. [{ correct: 2, points: 0.5 }]. */
    partialCredit: jsonb("partial_credit"),
    /** Задатак се не брише (на њега показују покушаји) него искључује. */
    active: boolean("active").notNull().default(true),
    /** Расте при свакој измени; уписује се уз одговор, да се зна шта је решавано. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

/** Слике уз задатке стоје у бази, не на диску: диск на хостингу се брише при деплоју. */
export const images = pgTable("images", {
  name: text("name").primaryKey(),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().default("student"),
  active: boolean("active").notNull().default(true),
  /** Псеудоним за извоз. Име и корисничко име се никад не извозе. */
  researchId: text("research_id").unique(),
  /**
   * Капија за сваки извоз. Поставља се ручно, тек кад стигне потписан образац
   * сагласности родитеља/старатеља.
   */
  consentResearch: boolean("consent_research").notNull().default(false),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  classGroup: text("class_group"),
  /** „eksperimentalna“ | „kontrolna“ | NULL (није у студији). */
  studyArm: text("study_arm"),
  /** 1 | 2 | 3 — редослед форми кроз фазе (види `study.ts`). */
  rotationGroup: integer("rotation_group"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Један ред (id = 1): текућа фаза и шта је отворено. */
export const studySettings = pgTable("study_settings", {
  id: integer("id").primaryKey(),
  currentPhase: text("current_phase"),
  testOpen: boolean("test_open").notNull().default(false),
  practiceOpen: boolean("practice_open").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Паралелне форме A/B/C по предмету, које бира истраживач: или тест са
 * завршног испита (`testKey`), или бројеви задатака из збирке. Тест има
 * предност кад је постављен.
 */
export const forms = pgTable(
  "forms",
  {
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id),
    code: text("code").notNull(),
    testKey: text("test_key").references(() => tests.key),
    questionNumbers: jsonb("question_numbers").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.subjectId, t.code] })],
);

export const attempts = pgTable("attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  /** „vezbanje“ | „merenje“ — бодују се исто, али се никад не мешају у прегледу. */
  kind: text("kind").notNull(),
  section: text("section"),
  /** T0–T3 за мерење; за вежбање фаза у којој је рађено (или NULL). */
  phase: text("phase"),
  form: text("form"),
  /** Задаци покушаја, редом како су приказани. */
  questionIds: jsonb("question_ids").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  /** Делимични бодови (0,5) из упутства за прегледање — зато није цео број. */
  score: doublePrecision("score"),
  maxScore: integer("max_score"),
  clientInfo: jsonb("client_info"),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidatedReason: text("invalidated_reason"),
  invalidatedBy: integer("invalidated_by"),
});

/** Један ред = један задатак у једном покушају. Накнадно се не може реконструисати. */
export const attemptItems = pgTable(
  "attempt_items",
  {
    id: serial("id").primaryKey(),
    attemptId: integer("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id),
    questionVersion: integer("question_version").notNull(),
    position: integer("position").notNull(),
    answer: jsonb("answer"),
    isCorrect: boolean("is_correct"),
    points: doublePrecision("points"),
    timeMs: integer("time_ms"),
    /** Колико пута је ученик мењао одговор пре предаје. */
    changes: integer("changes").notNull().default(0),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    submitted: boolean("submitted").notNull().default(false),
  },
  (t) => [unique("attempt_items_attempt_question").on(t.attemptId, t.questionId)],
);

/** Телеметрија: шта је ученик радио на екрану (приказ задатка, измена, одлазак из апликације). */
export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  attemptId: integer("attempt_id").references(() => attempts.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  questionId: integer("question_id"),
  type: text("type").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  value: jsonb("value"),
});

export type Subject = typeof subjects.$inferSelect;
export type TestRow = typeof tests.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type User = typeof users.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
export type AttemptItem = typeof attemptItems.$inferSelect;
export type StudySettings = typeof studySettings.$inferSelect;
