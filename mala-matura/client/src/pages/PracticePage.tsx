import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { api, clientInfo, formatPoints, isAnswered, type Answer, type Question, type Reveal, type Summary } from "../api";
import { BottomBar } from "../components/BottomBar";
import { QuestionView } from "../components/QuestionView";
import { flush, setTelemetryContext, track } from "../telemetry";

/** Шта се вежба: целина збирке или цео тест са завршног испита. */
export type PracticeSource = { subjectId: string; section: string } | { testKey: string };

/**
 * Вежбање: једно питање по екрану, провера одмах.
 *
 * „Провери“ шаље одговор на `/submit` тог задатка; тек тада стижу кључ и
 * објашњење. Први предати одговор се рачуна — нема погађања до тачног.
 * На крају се целина (или тест) затвара као један покушај.
 */
export default function PracticePage({ source }: { source: PracticeSource }) {
  const sourceKey = "testKey" in source ? `test:${source.testKey}` : `${source.subjectId}/${source.section}`;
  const [title, setTitle] = useState("testKey" in source ? "" : source.section);
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [reveals, setReveals] = useState<Record<number, Reveal>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  // Време на задатку и број измена одговора — за истраживање.
  const enteredAt = useRef(Date.now());
  const spent = useRef<Record<number, number>>({});
  const changes = useRef<Record<number, number>>({});

  useEffect(() => {
    let cancelled = false;
    setError("");
    setSummary(null);
    setIndex(0);
    setAnswers({});
    setReveals({});
    spent.current = {};
    changes.current = {};
    api<{ attempt: { id: number; title: string }; questions: Question[] }>("/practice/start", {
      body: { ...source, clientInfo: clientInfo() },
    })
      .then((data) => {
        if (cancelled) return;
        setAttemptId(data.attempt.id);
        setTitle(data.attempt.title);
        setQuestions(data.questions);
        // Ставке за ређање почињу редом који је сервер изабрао — измешано и
        // никад тачно.
        const initial: Record<number, Answer> = {};
        for (const q of data.questions) if (q.type === "ordering" && q.content.initialOrder) initial[q.id] = q.content.initialOrder;
        setAnswers(initial);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // `source` је нов објекат при сваком приказу; `sourceKey` носи исто, а стабилан је.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, round]);

  const question = questions[index];

  useEffect(() => {
    if (!question || attemptId === null) return;
    window.scrollTo({ top: 0 });
    enteredAt.current = Date.now();
    setTelemetryContext(attemptId, question.id);
    track("view");
    return () => {
      spent.current[question.id] = (spent.current[question.id] ?? 0) + (Date.now() - enteredAt.current);
    };
  }, [question, attemptId]);

  useEffect(() => () => {
    flush();
    setTelemetryContext(null);
  }, []);

  function change(value: Answer) {
    if (!question) return;
    changes.current[question.id] = (changes.current[question.id] ?? 0) + 1;
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
    track("answer");
  }

  async function check() {
    if (!question || attemptId === null) return;
    setBusy(true);
    setError("");
    try {
      const timeMs = (spent.current[question.id] ?? 0) + (Date.now() - enteredAt.current);
      const reveal = await api<Reveal>(`/attempts/${attemptId}/questions/${question.id}/submit`, {
        body: { answer: answers[question.id] ?? null, timeMs, changes: changes.current[question.id] ?? 0 },
      });
      setReveals((prev) => ({ ...prev, [question.id]: reveal }));
      if (reveal.alreadySubmitted) setAnswers((prev) => ({ ...prev, [question.id]: reveal.answer }));
      track("check", { correct: reveal.isCorrect });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (attemptId === null) return;
    setBusy(true);
    try {
      track("finish");
      flush();
      const result = await api<Summary>(`/attempts/${attemptId}/finish`, { body: { clientInfo: clientInfo() } });
      setSummary(result);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && questions.length === 0) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <p className="rounded-lg bg-bad-soft px-4 py-3 text-bad">{error}</p>
        <Link href="/" className="btn btn-ghost">
          Почетна
        </Link>
      </main>
    );
  }
  if (!question) return <p className="py-20 text-center text-muted">Учитавање…</p>;

  if (summary) {
    return (
      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6">
        <section className="rounded-2xl border border-line bg-white p-6 text-center">
          <p className="text-sm font-semibold text-muted">{title}</p>
          <p className="mt-2 text-5xl font-bold">{summary.percentage}%</p>
          <p className="mt-2 text-[17px]">
            Бодови: {formatPoints(summary.score)} од {formatPoints(summary.maxScore)}
          </p>
          <p className="mt-1 text-[15px] text-muted">
            Урађено {summary.answered} од {summary.total} задатака. Покушај је сачуван.
          </p>
        </section>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" className="btn btn-primary w-full" onClick={() => setRound((r) => r + 1)}>
            Вежбај поново
          </button>
          <Link href="/" className="btn btn-ghost w-full">
            Почетна
          </Link>
        </div>
      </main>
    );
  }

  const reveal = reveals[question.id];
  const last = index === questions.length - 1;
  const checkedCount = Object.keys(reveals).length;
  const correctCount = Object.values(reveals).filter((r) => r.isCorrect).length;

  return (
    <main className="mx-auto max-w-2xl px-4 pt-4 pb-44">
      <p className="mb-3 text-sm text-muted">
        <Link href="/" className="inline-flex min-h-11 items-center underline">
          Почетна
        </Link>{" "}
        · {title}
      </p>
      {error ? <p className="mb-3 rounded-lg bg-bad-soft px-4 py-3 text-bad">{error}</p> : null}

      <QuestionView question={question} answer={answers[question.id]} onChange={change} reveal={reveal ?? null} />

      <BottomBar
        progress={{ current: index + 1, total: questions.length, note: `тачно ${correctCount} / ${checkedCount}` }}
        onPrev={index > 0 ? () => setIndex((i) => i - 1) : undefined}
        onNext={!last ? () => setIndex((i) => i + 1) : undefined}
      >
        {!reveal ? (
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={check}
            disabled={busy || !isAnswered(question, answers[question.id])}
          >
            {busy ? "Провера…" : "Провери"}
          </button>
        ) : last ? (
          <button type="button" className="btn btn-primary flex-1" onClick={finish} disabled={busy}>
            Заврши
          </button>
        ) : (
          <button type="button" className="btn btn-primary flex-1" onClick={() => setIndex((i) => i + 1)}>
            Следећи
          </button>
        )}
        {reveal && !last ? (
          <button type="button" className="btn btn-ghost" onClick={finish} disabled={busy}>
            Крај
          </button>
        ) : null}
      </BottomBar>
    </main>
  );
}
