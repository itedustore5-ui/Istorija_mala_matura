import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { QuestionView } from "@/components/QuestionView";
import {
  api,
  blockLabel,
  clientInfo,
  type AnswerMap,
  type AttemptResult,
  type CheckResult,
  type Question,
} from "@/lib/api";

/**
 * Вежбање: задатак по задатак, са провером одмах после одговора.
 *
 * Цела целина као један радни лист са предајом на крају личила би на тест:
 * ученик би тек после двадесет задатака сазнао шта је погрешио, а дотад би
 * исту грешку поновио више пута. Овде свака провера одмах показује тачан
 * одговор и објашњење.
 *
 * Покушај се уписује тек на крају целине, из скупљених одговора — једно
 * вежбање је један покушај, па преглед напретка остаје упоредив.
 */
export default function PracticePage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const block = new URLSearchParams(search).get("blok");

  const [questions, setQuestions] = useState<Question[]>([]);

  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [checks, setChecks] = useState<Record<number, CheckResult>>({});
  const [selfMarks, setSelfMarks] = useState<Record<number, boolean>>({});

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Време по задатку: дуго задржавање уз тачан одговор значи несигурно знање,
  // и такве ставке прве „падну“ на каснијем мерењу. Мери се задржавање на
  // екрану, не тачно време размишљања — груба, али једина доступна мера.
  const sessionStart = useRef(new Date().toISOString());
  const enteredAt = useRef(Date.now());
  const timePerQuestion = useRef<Record<number, number>>({});

  useEffect(() => {
    const shown = questions[current]?.id;
    enteredAt.current = Date.now();
    return () => {
      if (shown === undefined) return;
      const spent = Date.now() - enteredAt.current;
      timePerQuestion.current[shown] = (timePerQuestion.current[shown] ?? 0) + spent;
    };
  }, [current, questions]);
  const [finished, setFinished] = useState<AttemptResult | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    setCurrent(0);
    setAnswers({});
    setChecks({});
    setSelfMarks({});
    setFinished(null);

    api<Question[]>(`/questions?block=${encodeURIComponent(block ?? "")}`)
      .then(setQuestions)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [block]);

  const question = questions[current];
  const check = question ? checks[question.id] : undefined;
  const answered = Object.keys(checks).length;

  const isCorrect = (q: Question) => {
    const c = checks[q.id];
    if (!c) return false;
    return c.scored ? c.correct === true : selfMarks[q.id] === true;
  };

  const correctCount = questions.filter(isCorrect).length;

  async function checkCurrent() {
    if (!question) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<CheckResult>("/check", {
        method: "POST",
        body: JSON.stringify({
          questionId: question.id,
          answer: answers[question.id] ?? "",
        }),
      });
      setChecks((prev) => ({ ...prev, [question.id]: result }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Покушај се уписује једном, кад се вежбање заврши. */
  async function finish() {
    setBusy(true);
    setError("");
    try {
      // Задржавање на задатку који је тренутно на екрану још није уписано у
      // ref (то ради чишћење ефекта), па се додаје овде.
      const shown = questions[current]?.id;
      if (shown !== undefined) {
        timePerQuestion.current[shown] =
          (timePerQuestion.current[shown] ?? 0) + (Date.now() - enteredAt.current);
      }

      const payload = questions
        .filter((q) => checks[q.id])
        .map((q) => ({
          questionId: q.id,
          answer: answers[q.id] ?? "",
          timeSpentMs: timePerQuestion.current[q.id] ?? null,
        }));

      if (payload.length === 0) {
        navigate("/vezbanje");
        return;
      }

      const attempt = await api<AttemptResult>("/attempts", {
        method: "POST",
        body: JSON.stringify({
          answers: payload,
          // Збир вежбања између мерења је доза интервенције; без ње се може
          // рећи само да је резултат опао, што би се десило и без апликације.
          startedAt: sessionStart.current,
          durationMs: Date.now() - new Date(sessionStart.current).getTime(),
          clientInfo: clientInfo(),
        }),
      });
      setFinished(attempt);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="py-16 text-center text-muted-foreground">Учитавање…</p>;
  }

  const title = block ? blockLabel(block) : "Вежбање";
  const subtitle = "Збирка задатака за завршни испит — историја";

  if (questions.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink onClick={() => navigate("/vezbanje")} />
        <p className="rounded-xl border border-border bg-card px-5 py-10 text-center text-muted-foreground">
          {error || "У овој целини још нема унетих задатака."}
        </p>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <BackLink onClick={() => navigate("/vezbanje")} />
        <div className="rounded-xl border border-primary/50 bg-primary/10 p-6 text-center">
          <p className="text-3xl font-semibold">{finished.percentage}%</p>
          <p className="mt-2 text-muted-foreground">
            Тачно {finished.score} од {finished.total} бодованих задатака
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Покушај је забележен.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setChecks({});
                setAnswers({});
                setSelfMarks({});
                setCurrent(0);
                setFinished(null);
              }}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
            >
              Вежбај поново
            </button>
            <button
              type="button"
              onClick={() => navigate("/vezbanje")}
              className="rounded-lg border border-border px-5 py-2 text-sm"
            >
              Друга целина
            </button>
          </div>
        </div>
      </div>
    );
  }

  const last = current === questions.length - 1;

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-28">
      <header>
        <BackLink onClick={() => navigate("/vezbanje")} />
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </header>

      {error ? (
        <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      {question ? (
        <QuestionView
          key={question.id}
          index={question.id}
          question={question}
          answer={answers[question.id] ?? ""}
          onChange={(value) =>
            setAnswers((prev) => ({ ...prev, [question.id]: value }))
          }
          reveal={check?.reveal}
          correct={check?.correct ?? undefined}
          selfMark={selfMarks[question.id] ?? null}
          onSelfMark={(value) =>
            setSelfMarks((prev) => ({ ...prev, [question.id]: value }))
          }
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={current === 0}
          onClick={() => setCurrent((i) => i - 1)}
          className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40"
        >
          ← Претходни
        </button>

        {!check ? (
          <button
            type="button"
            onClick={checkCurrent}
            disabled={busy || (answers[question!.id] ?? "").trim() === ""}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Проверавам…" : "Провери одговор"}
          </button>
        ) : last ? (
          <button
            type="button"
            onClick={finish}
            disabled={busy}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Чувам…" : "Заврши вежбање"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCurrent((i) => i + 1)}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
          >
            Следећи задатак →
          </button>
        )}

        <button
          type="button"
          disabled={last}
          onClick={() => setCurrent((i) => i + 1)}
          className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40"
        >
          Прескочи →
        </button>
      </div>

      <ProgressBar
        questions={questions}
        current={current}
        checks={checks}
        isCorrect={isCorrect}
        correctCount={correctCount}
        answered={answered}
        onJump={setCurrent}
        onFinish={finish}
        busy={busy}
      />
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 text-sm text-muted-foreground hover:text-foreground"
    >
      ← Назад на целине
    </button>
  );
}

function ProgressBar({
  questions,
  current,
  checks,
  isCorrect,
  correctCount,
  answered,
  onJump,
  onFinish,
  busy,
}: {
  questions: Question[];
  current: number;
  checks: Record<number, unknown>;
  isCorrect: (q: Question) => boolean;
  correctCount: number;
  answered: number;
  onJump: (index: number) => void;
  onFinish: () => void;
  busy: boolean;
}) {
  const percent = Math.round((answered / questions.length) * 100);

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
      <div className="mx-auto max-w-3xl px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Задатак {current + 1} од {questions.length}
          </span>
          <span className="text-muted-foreground">
            тачно {correctCount} / {answered}
          </span>
        </div>

        <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Квадратићи су и преглед и навигација — ученик види шта је промашио
            и може да се врати на тај задатак. */}
        <div className="flex flex-wrap gap-1">
          {questions.map((q, i) => {
            const done = checks[q.id] !== undefined;
            const ok = done && isCorrect(q);
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => onJump(i)}
                title={`Задатак ${q.id}`}
                className={`h-2.5 w-5 rounded-sm transition ${
                  i === current
                    ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                    : ""
                } ${
                  !done
                    ? "bg-muted-foreground/30"
                    : ok
                      ? "bg-emerald-500"
                      : "bg-rose-500"
                }`}
              />
            );
          })}
          {answered > 0 ? (
            <button
              type="button"
              onClick={onFinish}
              disabled={busy}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              заврши и сачувај
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
