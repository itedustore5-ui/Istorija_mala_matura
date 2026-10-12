import { useEffect, useState } from "react";
import {
  api,
  TOKEN_KEY,
  type AdminUser,
  type Completion,
  type CompletionRow,
  type MeasurementPhase,
  type Phase,
  type ResearchAttempt,
  type StudyArm,
  type StudySettings,
} from "@/lib/api";

/**
 * Управљање студијом.
 *
 * Овај екран постоји зато што се без њега на дан мерења отвара SQL едитор:
 * фаза се поставља, термин отвара и затвара, види се ко је шта урадио, а
 * покушај који је пукао се поништава. Све то се ради пре него што термин
 * буде затворен, не после.
 */

const PHASE_LABELS: Record<Phase, string> = {
  T0: "T0 — почетно мерење",
  vezbanje: "Вежбање (интервенција)",
  T30: "T30 — после 30 дана",
  T90: "T90 — после 90 дана",
};

const MEASUREMENTS: MeasurementPhase[] = ["T0", "T30", "T90"];

const minutes = (ms: number) => Math.round(ms / 60000);

export default function ResearchPage() {
  const [settings, setSettings] = useState<StudySettings | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [attempts, setAttempts] = useState<ResearchAttempt[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      const [s, c, a] = await Promise.all([
        api<StudySettings>("/research/settings"),
        api<Completion>("/research/completion"),
        api<ResearchAttempt[]>("/research/attempts"),
      ]);
      setSettings(s);
      setCompletion(c);
      setAttempts(a);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await api("/research/settings", { method: "PATCH", body: JSON.stringify(body) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function invalidate(attempt: ResearchAttempt) {
    const reason = window.prompt(
      `Поништавање покушаја ${attempt.fullName} (${attempt.percentage}%). Разлог:`,
    );
    if (!reason || reason.trim().length < 3) return;

    setBusy(true);
    setError("");
    try {
      await api(`/research/attempts/${attempt.id}/invalidate`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!settings || !completion) {
    return <p className="py-16 text-center text-muted-foreground">Учитавање…</p>;
  }

  const formsSet = Object.values(settings.forms).filter(Boolean).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      <header>
        <h1 className="text-xl font-semibold">Студија</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Апликација уз учење служи и као инструмент мерења. Кад се две улоге
          сукобе, предност има мерење — лош приказ се поправи сутра, погрешно
          прикупљен податак никад.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      {/* ── Подешавања ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 font-semibold">Подешавања</h2>

        <label className="block text-sm">
          <span className="text-muted-foreground">Текућа фаза</span>
          <select
            disabled={busy}
            value={settings.currentPhase ?? ""}
            onChange={(e) => patch({ currentPhase: e.target.value || null })}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-foreground"
          >
            <option value="">— није постављена —</option>
            {settings.options?.phases.map((p) => (
              <option key={p} value={p}>
                {PHASE_LABELS[p]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            Сервер њоме означава сваки предати рад — ученик на то не може да утиче.
          </span>
        </label>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Toggle
            label="Термин мерења отворен"
            hint="Док је затворен, тестови се не отварају ни ако се зна адреса."
            checked={settings.examOpen}
            disabled={busy}
            onChange={(v) => patch({ examOpen: v })}
          />
          <Toggle
            label="Вежбање отворено"
            hint="Контролна грана не вежба ни кад је отворено."
            checked={settings.practiceOpen}
            disabled={busy}
            onChange={(v) => patch({ practiceOpen: v })}
          />
        </div>

        <div className="mt-5">
          <p className="text-sm font-medium">Паралелне форме</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Ротација их распоређује латинским квадратом, да се тежина теста не
            помеша са фазом. Кад мерење почне, више се не могу мењати.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["A", "B", "C"] as const).map((f) => (
              <label key={f} className="block text-sm">
                <span className="text-muted-foreground">Форма {f}</span>
                <select
                  disabled={busy}
                  value={settings.forms[f] ?? ""}
                  onChange={(e) => patch({ forms: { [f]: e.target.value || null } })}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-foreground"
                >
                  <option value="">— није постављена —</option>
                  {settings.options?.exams.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {formsSet < 3 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {settings.options?.exams.length === 0
                ? "Нема унетих тестова. Мерење не може да почне док се не унесу три завршна испита из претходних година."
                : "Мерење не може да почне док све три форме не буду постављене."}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Попуњеност ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">Попуњеност</h2>
          <span className="text-sm text-muted-foreground">
            {completion.rows.length} испитаника у студији
          </span>
        </div>

        {completion.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Још нико није уписан у студију. Уписивање додељује псеудоним и
            ротациону групу.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="border-b border-border py-2 pr-3 font-medium">Испитаник</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Грана</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Рот.</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Вежбање</th>
                  {MEASUREMENTS.map((p) => (
                    <th key={p} className="border-b border-border py-2 pr-3 font-medium">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {completion.rows.map((row) => (
                  <CompletionLine key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Уписивање ────────────────────────────────────────────────────── */}
      <Enrollment enrolledIds={completion.rows.map((r) => r.id)} onDone={load} />

      {/* ── Извоз ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-2 font-semibold">Извоз</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Извозе се само испитаници који су дали сагласност, и то без имена —
          само псеудоним.
        </p>
        <div className="flex flex-wrap gap-2">
          <ExportLink href="/api/export/wide.csv" title="Широки" note="SPSS, jamovi" />
          <ExportLink href="/api/export/long.csv" title="Дуги" note="R, мешовити модели" />
          <ExportLink href="/api/export/items.csv" title="По ставци" note="тежина, дискриминативност" />
        </div>
      </section>

      {/* ── Покушаји ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-2 font-semibold">Покушаји</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Поништен покушај се не брише него означава — и у извозу се види да је
          поништен и зашто.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="border-b border-border py-2 pr-3 font-medium">Кад</th>
                <th className="border-b border-border py-2 pr-3 font-medium">Испитаник</th>
                <th className="border-b border-border py-2 pr-3 font-medium">Врста</th>
                <th className="border-b border-border py-2 pr-3 font-medium">Фаза</th>
                <th className="border-b border-border py-2 pr-3 font-medium">%</th>
                <th className="border-b border-border py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {attempts.slice(0, 50).map((a) => (
                <tr key={a.id} className={a.invalidatedAt ? "opacity-45" : ""}>
                  <td className="border-b border-border/50 py-2 pr-3 whitespace-nowrap">
                    {new Date(a.createdAt).toLocaleString("sr-RS")}
                  </td>
                  <td className="border-b border-border/50 py-2 pr-3">{a.fullName}</td>
                  <td className="border-b border-border/50 py-2 pr-3">
                    {a.examKey ? `мерење · ${a.form ?? "—"}` : "вежбање"}
                  </td>
                  <td className="border-b border-border/50 py-2 pr-3">{a.phase ?? "—"}</td>
                  <td className="border-b border-border/50 py-2 pr-3">{a.percentage}%</td>
                  <td className="border-b border-border/50 py-2 text-right">
                    {a.invalidatedAt ? (
                      <span className="text-xs text-muted-foreground">
                        поништен · {a.invalidatedReason}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => invalidate(a)}
                        className="text-xs text-rose-500 hover:underline"
                      >
                        поништи
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * Уписивање у студију.
 *
 * Ротациона група се не бира ручно — сервер је додељује у најмању, да групе
 * остану приближно једнаке. Уравнотежење форми ради само ако јесу.
 */
function Enrollment({ enrolledIds, onDone }: { enrolledIds: number[]; onDone: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [arm, setArm] = useState<StudyArm>("eksperimentalna");
  const [classGroup, setClassGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<AdminUser[]>("/admin/users")
      .then(setUsers)
      .catch((err: Error) => setError(err.message));
  }, [enrolledIds.length]);

  const available = users.filter((u) => u.role !== "admin" && !enrolledIds.includes(u.id));

  async function enroll() {
    if (picked.length === 0) return;
    setBusy(true);
    setError("");
    try {
      await api("/research/enroll", {
        method: "POST",
        body: JSON.stringify({
          userIds: picked,
          studyArm: arm,
          classGroup: classGroup.trim() || null,
        }),
      });
      setPicked([]);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-2 font-semibold">Уписивање у студију</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Уписивање додељује псеудоним и ротациону групу. Контролна грана не
        добија вежбање, али ради иста мерења.
      </p>

      {error ? <p className="mb-3 text-sm text-rose-500">{error}</p> : null}

      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">Сви налози су већ уписани.</p>
      ) : (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-muted-foreground">Грана</span>
              <select
                value={arm}
                onChange={(e) => setArm(e.target.value as StudyArm)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-foreground"
              >
                <option value="eksperimentalna">експериментална (вежба)</option>
                <option value="kontrolna">контролна (не вежба)</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Одељење</span>
              <input
                value={classGroup}
                onChange={(e) => setClassGroup(e.target.value)}
                placeholder="нпр. VIII-2"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-foreground"
              />
            </label>
          </div>

          <div className="mb-3 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {available.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(u.id)}
                  onChange={(e) =>
                    setPicked((prev) =>
                      e.target.checked ? [...prev, u.id] : prev.filter((x) => x !== u.id),
                    )
                  }
                  className="size-4"
                />
                <span>{u.fullName}</span>
                <span className="text-xs text-muted-foreground">{u.username}</span>
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={busy || picked.length === 0}
            onClick={enroll}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Упиши {picked.length > 0 ? `(${picked.length})` : ""}
          </button>
        </>
      )}
    </section>
  );
}

function CompletionLine({ row }: { row: CompletionRow }) {
  return (
    <tr>
      <td className="border-b border-border/50 py-2 pr-3">
        <span className="font-medium">{row.fullName}</span>
        <span className="ml-2 text-xs text-muted-foreground">{row.researchId}</span>
        {!row.consentResearch ? (
          <span className="ml-2 text-xs text-amber-500">без сагласности</span>
        ) : null}
      </td>
      <td className="border-b border-border/50 py-2 pr-3">
        {row.studyArm === "kontrolna" ? "контролна" : "експериментална"}
      </td>
      <td className="border-b border-border/50 py-2 pr-3">{row.rotationGroup ?? "—"}</td>
      <td className="border-b border-border/50 py-2 pr-3 whitespace-nowrap">
        {row.practiceCount}× · {minutes(row.practiceMs)} мин
      </td>
      {MEASUREMENTS.map((p) => {
        const m = row.measurements[p];
        return (
          <td key={p} className="border-b border-border/50 py-2 pr-3 whitespace-nowrap">
            {m.done ? (
              <span className="font-medium text-emerald-500">{m.percentage}%</span>
            ) : (
              <span className="text-muted-foreground">
                {m.expectedForm ? `чека ${m.expectedForm}` : "—"}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function ExportLink({ href, title, note }: { href: string; title: string; note: string }) {
  const token = localStorage.getItem(TOKEN_KEY);
  return (
    <button
      type="button"
      onClick={async () => {
        // Извоз тражи Authorization заглавље, па не може обичан <a href>.
        const res = await fetch(href, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = href.split("/").pop() ?? "izvoz.csv";
        a.click();
        URL.revokeObjectURL(url);
      }}
      className="rounded-lg border border-border px-4 py-2 text-left text-sm hover:border-foreground"
    >
      <span className="block font-medium">{title}</span>
      <span className="block text-xs text-muted-foreground">{note}</span>
    </button>
  );
}
