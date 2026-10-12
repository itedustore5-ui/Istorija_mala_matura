import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { QuestionView } from "@/components/QuestionView";
import {
  api,
  type AnswerMap,
  type ExamAttemptResult,
  type ExamDetail,
  type ExamSummary,
} from "@/lib/api";

/** Листа тестова са претходних завршних испита. */
export function ExamsPage() {
  const [, navigate] = useLocation();
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ExamSummary[]>("/exams")
      .then(setExams)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-3">{error}</p>;
  }
  if (!exams) {
    return <p className="py-16 text-center text-muted-foreground">Учитавање…</p>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Тестови из претходних година</h1>
        <p className="mt-1 text-muted-foreground">
          Тестови са завршних испита раде се у целини и боду ју се по испитном
          кључу, где се код већине задатака признаје и делимично тачан одговор.
        </p>
      </header>

      {exams.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-10 text-center">
          <p className="text-muted-foreground">Још нема унетих тестова.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Тестови се уносе скриптом{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">scripts/import-exam.mjs</code>. Овде се
            намерно не приказују измишљени тестови: ученику би деловали као
            званични, а не би то били.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {exams.map((exam) => (
            <button
              key={exam.key}
              type="button"
              onClick={() => navigate(`/testovi/test?key=${encodeURIComponent(exam.key)}`)}
              className="rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{exam.label}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {exam.year}
                    {exam.term ? ` · ${exam.term} рок` : ""}
                  </p>
                </div>
                {exam.bestPoints !== null ? (
                  <span className="shrink-0 rounded-md bg-primary/15 px-2 py-1 text-sm font-semibold text-primary">
                    {exam.bestPoints}/{exam.totalPoints}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {exam.questionCount} задатака · {exam.totalPoints} поена
                {exam.durationMinutes ? ` · ${exam.durationMinutes} минута` : ""}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Решавање једног теста. */
export function ExamPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const key = new URLSearchParams(search).get("key");

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [result, setResult] = useState<ExamAttemptResult | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!key) return;
    api<ExamDetail>(`/exams/${encodeURIComponent(key)}`)
      .then(setExam)
      .catch((err: Error) => setError(err.message));
  }, [key]);

  const reveal = useMemo(
    () => (result ? new Map(result.reveal.map((r) => [r.id, r])) : null),
    [result],
  );
  const points = useMemo(
    () => (result ? new Map(result.results.map((r) => [r.id, r.points])) : null),
    [result],
  );

  async function submit() {
    if (!exam) return;
    setSending(true);
    setError("");
    try {
      const payload = exam.questions
        .filter((q) => (answers[q.id] ?? "").trim() !== "")
        .map((q) => ({ questionId: q.id, answer: answers[q.id]! }));
      const attempt = await api<ExamAttemptResult>(
        `/exams/${encodeURIComponent(exam.key)}/attempts`,
        { method: "POST", body: JSON.stringify({ answers: payload }) },
      );
      setResult(attempt);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (error) {
    return <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-3">{error}</p>;
  }
  if (!exam) {
    return <p className="py-16 text-center text-muted-foreground">Учитавање…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <header>
        <button
          type="button"
          onClick={() => navigate("/testovi")}
          className="mb-3 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Назад на тестове
        </button>
        <h1 className="text-2xl font-semibold">{exam.label}</h1>
        <p className="mt-1 text-muted-foreground">
          {exam.totalPoints} поена
          {exam.durationMinutes ? ` · ${exam.durationMinutes} минута` : ""}
        </p>
      </header>

      {result ? (
        <div className="rounded-xl border border-primary/50 bg-primary/10 p-5">
          <p className="text-lg font-semibold">
            {result.pointsEarned} од {result.pointsTotal} поена ({result.percentage}%)
          </p>
        </div>
      ) : null}

      {exam.texts.map((text) => (
        <section key={text.key} className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="mb-1 text-lg font-semibold">{text.title}</h2>
          {text.author ? (
            <p className="mb-4 text-sm text-muted-foreground">{text.author}</p>
          ) : null}
          <div className="space-y-3 text-[15px] leading-relaxed">
            {text.body.map((paragraph, i) => (
              <p key={i} className="whitespace-pre-line">
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      ))}

      <div className="space-y-4">
        {exam.questions.map((q, i) => (
          <QuestionView
            key={q.id}
            index={i + 1}
            question={q}
            answer={answers[q.id] ?? ""}
            onChange={(value) => setAnswers((prev) => ({ ...prev, [q.id]: value }))}
            reveal={reveal?.get(q.id)}
            correct={points ? points.get(q.id) === q.points : undefined}
            earnedPoints={points?.get(q.id)}
          />
        ))}
      </div>

      {!result ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-end px-4 py-3">
            <button
              type="button"
              onClick={submit}
              disabled={sending}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {sending ? "Предајем…" : "Предај тест"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
