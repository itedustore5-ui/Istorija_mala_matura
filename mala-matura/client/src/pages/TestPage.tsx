import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { api, clientInfo, formatPoints, isAnswered, zadataka, type Answer, type Question, type Summary } from "../api";
import { BottomBar } from "../components/BottomBar";
import { QuestionView } from "../components/QuestionView";
import { flush, setTelemetryContext, track } from "../telemetry";

/**
 * Провера знања (мерење T0–T3). Форму и фазу одређује сервер.
 *
 * Одговор се чува чим се промени (без повратне информације), па пукла веза
 * или затворен прозор не бришу урађено — поновни улазак наставља исти тест.
 * Предаје се једном; после предаје се види само резултат, без кључа.
 */
export default function TestPage({ subjectId }: { subjectId: string }) {
  const [attempt, setAttempt] = useState<{ id: number; phase: string; form: string } | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const enteredAt = useRef(Date.now());
  const spent = useRef<Record<number, number>>({});
  const changes = useRef<Record<number, number>>({});
  const pending = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    api<{ attempt: { id: number; phase: string; form: string }; questions: Question[]; answers: Record<string, Answer> }>(
      "/tests/start",
      { body: { subjectId, clientInfo: clientInfo() } },
    )
      .then((data) => {
        setAttempt(data.attempt);
        setQuestions(data.questions);
        const initial: Record<number, Answer> = {};
        for (const q of data.questions) {
          const saved = data.answers[String(q.id)];
          if (saved !== undefined && saved !== null) initial[q.id] = saved;
          else if (q.type === "ordering" && q.content.initialOrder) initial[q.id] = q.content.initialOrder;
        }
        setAnswers(initial);
      })
      .catch((e: Error) => setError(e.message));
  }, [subjectId]);

  const question = questions[index];

  useEffect(() => {
    if (!question || !attempt) return;
    window.scrollTo({ top: 0 });
    enteredAt.current = Date.now();
    setTelemetryContext(attempt.id, question.id);
    track("view");
    return () => {
      spent.current[question.id] = (spent.current[question.id] ?? 0) + (Date.now() - enteredAt.current);
    };
  }, [question, attempt]);

  useEffect(() => () => {
    flush();
    setTelemetryContext(null);
  }, []);

  async function save(questionId: number, answer: Answer) {
    if (!attempt) return;
    setSaving("saving");
    try {
      await api(`/attempts/${attempt.id}/answers/${questionId}`, {
        method: "PUT",
        body: {
          answer,
          timeMs: (spent.current[questionId] ?? 0) + (Date.now() - enteredAt.current),
          changes: changes.current[questionId] ?? 0,
        },
      });
      setSaving("saved");
    } catch {
      setSaving("error");
    }
  }

  function change(value: Answer) {
    if (!question) return;
    const id = question.id;
    changes.current[id] = (changes.current[id] ?? 0) + 1;
    setAnswers((prev) => ({ ...prev, [id]: value }));
    track("answer");
    // Упис са кратким закашњењем: куцање у поље не шаље захтев за свако слово.
    const timer = pending.current.get(id);
    if (timer) window.clearTimeout(timer);
    pending.current.set(
      id,
      window.setTimeout(() => {
        pending.current.delete(id);
        void save(id, value);
      }, 600),
    );
  }

  async function submit() {
    if (!attempt) return;
    setBusy(true);
    setError("");
    try {
      // Одговори чије чување још чека иду пре предаје.
      for (const [id, timer] of pending.current) {
        window.clearTimeout(timer);
        await save(id, answers[id] ?? null);
      }
      pending.current.clear();
      track("finish");
      flush();
      const result = await api<Summary>(`/attempts/${attempt.id}/submit`, { body: { clientInfo: clientInfo() } });
      setSummary(result);
      setConfirming(false);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !attempt) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <p className="rounded-lg bg-white px-4 py-3 text-[17px]">{error}</p>
        <Link href="/" className="btn btn-ghost">
          Почетна
        </Link>
      </main>
    );
  }
  if (summary) {
    return (
      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6">
        <section className="rounded-2xl border border-line bg-white p-6 text-center">
          <p className="text-sm font-semibold text-muted">Провера знања {summary.phase}</p>
          <p className="mt-2 text-5xl font-bold">{summary.percentage}%</p>
          <p className="mt-2 text-[17px]">
            Бодови: {formatPoints(summary.score)} од {formatPoints(summary.maxScore)}
          </p>
          <p className="mt-3 text-[15px] leading-snug text-muted">
            Тачни одговори се после провере не приказују — исти задаци се поново раде на једној од
            следећих провера, па би приказ кључа покварио мерење. Вежбање и даље показује одговоре.
          </p>
        </section>
        <Link href="/" className="btn btn-primary w-full">
          Почетна
        </Link>
      </main>
    );
  }
  if (!question || !attempt) return <p className="py-20 text-center text-muted">Учитавање…</p>;

  const unanswered = questions.filter((q) => !isAnswered(q, answers[q.id])).length;
  const last = index === questions.length - 1;
  const note = saving === "saving" ? "чувам…" : saving === "saved" ? "сачувано" : saving === "error" ? "није сачувано!" : "";

  return (
    <main className="mx-auto max-w-2xl px-4 pt-4 pb-44">
      <p className="mb-3 text-sm text-muted">Провера знања {attempt.phase}</p>
      {error ? <p className="mb-3 rounded-lg bg-bad-soft px-4 py-3 text-bad">{error}</p> : null}

      {confirming ? (
        <section className="space-y-4 rounded-2xl border-2 border-brand bg-white p-5">
          <p className="text-[17px] font-semibold">Предаш проверу?</p>
          <p className="text-[16px]">
            {unanswered > 0 ? `Без одговора: ${zadataka(unanswered)}. ` : "Сви задаци имају одговор. "}
            После предаје одговори се више не могу мењати.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" className="btn btn-primary w-full" onClick={submit} disabled={busy}>
              {busy ? "Предајем…" : "Предај"}
            </button>
            <button type="button" className="btn btn-ghost w-full" onClick={() => setConfirming(false)} disabled={busy}>
              Назад на задатке
            </button>
          </div>
        </section>
      ) : (
        <QuestionView question={question} answer={answers[question.id]} onChange={change} />
      )}

      {!confirming ? (
        <BottomBar
          progress={{ current: index + 1, total: questions.length, note }}
          onPrev={index > 0 ? () => setIndex((i) => i - 1) : undefined}
          onNext={!last ? () => setIndex((i) => i + 1) : undefined}
        >
          {last ? (
            <button type="button" className="btn btn-primary flex-1" onClick={() => setConfirming(true)}>
              Предај
            </button>
          ) : (
            <button type="button" className="btn btn-primary flex-1" onClick={() => setIndex((i) => i + 1)}>
              Следећи
            </button>
          )}
        </BottomBar>
      ) : null}
    </main>
  );
}
