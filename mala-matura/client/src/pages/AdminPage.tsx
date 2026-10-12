import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, download, imageUrl, zadataka, type DataTable, type QuestionType } from "../api";

/**
 * Админ: налози и сагласност, задаци (садржај се мења само овде — задаци
 * живе у бази), истраживање (фаза, термини, форме A/B/C) и покушаји са
 * извозом. Клијент ништа не одлучује: сва правила проверава сервер, а овде се
 * приказује његова порука.
 */

type Tab = "users" | "questions" | "study" | "attempts";

const TABS: { key: Tab; label: string }[] = [
  { key: "users", label: "Ученици" },
  { key: "questions", label: "Задаци" },
  { key: "study", label: "Истраживање" },
  { key: "attempts", label: "Покушаји" },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-5">
      <h1 className="text-2xl font-bold">Администрација</h1>
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`btn ${tab === t.key ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "users" ? <UsersTab /> : null}
      {tab === "questions" ? <QuestionsTab /> : null}
      {tab === "study" ? <StudyTab /> : null}
      {tab === "attempts" ? <AttemptsTab /> : null}
    </main>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-white p-4">
      {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[15px] text-muted">{text}</span>
      {children}
    </label>
  );
}

function Message({ text, bad }: { text: string; bad?: boolean }) {
  if (!text) return null;
  return <p className={`rounded-lg px-3 py-2 text-[15px] ${bad ? "bg-bad-soft text-bad" : "bg-ok-soft text-ok"}`}>{text}</p>;
}

// ── Ученици ───────────────────────────────────────────────────────────────

type AdminUser = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  active: boolean;
  researchId: string | null;
  consentResearch: boolean;
  consentAt: string | null;
  classGroup: string | null;
  studyArm: string | null;
  rotationGroup: number | null;
};

function UsersTab() {
  const [list, setList] = useState<AdminUser[]>([]);
  const [msg, setMsg] = useState({ text: "", bad: false });
  const [form, setForm] = useState({ username: "", fullName: "", password: "", classGroup: "", role: "student" });

  const load = () => api<AdminUser[]>("/admin/users").then(setList).catch((e: Error) => setMsg({ text: e.message, bad: true }));
  useEffect(() => {
    void load();
  }, []);

  async function run(action: () => Promise<unknown>, ok: string) {
    setMsg({ text: "", bad: false });
    try {
      await action();
      setMsg({ text: ok, bad: false });
      await load();
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    }
  }

  const update = (u: AdminUser, body: Record<string, unknown>, ok: string) =>
    run(() => api(`/admin/users/${u.id}`, { method: "PUT", body }), ok);

  return (
    <div className="space-y-4">
      <Message {...msg} />
      <Card title="Нови налог">
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Име и презиме">
            <input className="field" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </Label>
          <Label text="Корисничко име (латиница)">
            <input className="field" value={form.username} autoCapitalize="off" onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Label>
          <Label text="Лозинка (најмање 6 знакова)">
            <input className="field" value={form.password} autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Label>
          <Label text="Одељење">
            <input className="field" value={form.classGroup} placeholder="нпр. VIII-2" onChange={(e) => setForm({ ...form, classGroup: e.target.value })} />
          </Label>
          <Label text="Улога">
            <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="student">ученик</option>
              <option value="admin">администратор</option>
            </select>
          </Label>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            run(async () => {
              await api("/admin/users", { body: form });
              setForm({ username: "", fullName: "", password: "", classGroup: "", role: "student" });
            }, "Налог је направљен.")
          }
        >
          Направи налог
        </button>
      </Card>

      <Card title={`Налози (${list.length})`}>
        <ul className="space-y-3">
          {list.map((u) => (
            <li key={u.id} className="space-y-3 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[17px] font-semibold">
                  {u.fullName} <span className="text-[15px] font-normal text-muted">({u.username})</span>
                </p>
                <p className="text-sm text-muted">
                  {u.role === "admin" ? "администратор" : "ученик"}
                  {u.classGroup ? ` · ${u.classGroup}` : ""}
                  {u.active ? "" : " · искључен"}
                </p>
              </div>

              {u.role === "student" ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Label text="Група у истраживању">
                    <select
                      className="field"
                      value={u.studyArm ?? ""}
                      onChange={(e) => update(u, { studyArm: e.target.value || null }, "Група је сачувана.")}
                    >
                      <option value="">није у истраживању</option>
                      <option value="eksperimentalna">експериментална (вежба)</option>
                      <option value="kontrolna">контролна (само провере)</option>
                    </select>
                  </Label>
                  <div className="text-[15px]">
                    <span className="mb-1 block text-muted">Псеудоним · ротација</span>
                    <span className="flex min-h-11 items-center font-medium">
                      {u.researchId ?? "—"} · {u.rotationGroup ?? "—"}
                    </span>
                  </div>
                  <label className="flex min-h-11 items-center gap-3 self-end text-[15px]">
                    <input
                      type="checkbox"
                      className="h-6 w-6"
                      checked={u.consentResearch}
                      onChange={(e) => {
                        const on = e.target.checked;
                        // Сагласност се уписује ручно, тек уз потписан образац.
                        if (on && !window.confirm(`Да ли је примљен потписан образац сагласности родитеља/старатеља за ученика ${u.fullName}?`)) return;
                        void update(u, { consentResearch: on }, on ? "Сагласност је уписана." : "Сагласност је повучена.");
                      }}
                    />
                    сагласност (потписан образац)
                  </label>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    const password = window.prompt(`Нова лозинка за ${u.fullName} (најмање 6 знакова):`);
                    if (password) void update(u, { password }, "Лозинка је промењена.");
                  }}
                >
                  Нова лозинка
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => update(u, { active: !u.active }, u.active ? "Налог је искључен." : "Налог је укључен.")}>
                  {u.active ? "Искључи" : "Укључи"}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    if (window.confirm(`Обрисати налог ${u.fullName} и све његове покушаје?`))
                      void run(() => api(`/admin/users/${u.id}`, { method: "DELETE" }), "Налог је обрисан.");
                  }}
                >
                  Обриши
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ── Задаци ────────────────────────────────────────────────────────────────

type SubjectRow = { id: string; name: string; sections: { key: string; label: string }[] };

type AdminQuestion = {
  id: number;
  subjectId: string;
  /** NULL — задатак из збирке; иначе кључ теста са завршног испита. */
  testKey: string | null;
  partialCredit: { correct: number; points: number }[] | null;
  number: number;
  section: string;
  type: QuestionType;
  prompt: string;
  content: Record<string, unknown>;
  correct: unknown;
  explanation: string;
  points: number;
  active: boolean;
  version: number;
};

const TYPE_LABELS: Record<QuestionType, string> = {
  single: "један тачан одговор",
  multi: "више тачних одговора",
  text: "упиши одговор",
  matching: "табела — повежи",
  ordering: "поређај",
};

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

/** Облик за уређивање: листе као текст, ред по ред. */
type Draft = {
  id: number | null;
  number: string;
  section: string;
  type: QuestionType;
  prompt: string;
  passage: string;
  source: string;
  image: string;
  hint: string;
  tableJson: string;
  explanation: string;
  points: string;
  active: boolean;
  options: string;
  optionImages: string;
  single: number;
  multi: number[];
  fields: { label: string; accepted: string }[];
  rows: string;
  columns: string;
  matching: number[];
  /** Ставке за ређање уносе се ТАЧНИМ редом; сервер их чува измешане. */
  items: string;
};

function emptyDraft(section: string): Draft {
  return {
    id: null,
    number: "",
    section,
    type: "single",
    prompt: "",
    passage: "",
    source: "",
    image: "",
    hint: "",
    tableJson: "",
    explanation: "",
    points: "1",
    active: true,
    options: "",
    optionImages: "",
    single: 0,
    multi: [],
    fields: [{ label: "Одговор", accepted: "" }],
    rows: "",
    columns: "",
    matching: [],
    items: "",
  };
}

function toDraft(q: AdminQuestion): Draft {
  const c = q.content as Record<string, unknown>;
  const d = emptyDraft(q.section);
  const strs = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
  Object.assign(d, {
    id: q.id,
    number: String(q.number),
    type: q.type,
    prompt: q.prompt,
    passage: String(c.passage ?? ""),
    source: String(c.source ?? ""),
    image: String(c.image ?? ""),
    hint: String(c.hint ?? ""),
    tableJson: c.table ? JSON.stringify(c.table, null, 2) : "",
    explanation: q.explanation,
    points: String(q.points),
    active: q.active,
    options: strs(c.options).join("\n"),
    optionImages: strs(c.optionImages).join(", "),
    rows: strs(c.rows).join("\n"),
    columns: strs(c.columns).join("\n"),
  });
  if (q.type === "single") d.single = Number(q.correct);
  if (q.type === "multi") d.multi = (q.correct as number[]) ?? [];
  if (q.type === "matching") d.matching = (q.correct as number[]) ?? [];
  if (q.type === "text") {
    const labels = (c.fields as { label: string }[] | undefined) ?? [];
    d.fields = labels.map((f, i) => ({ label: f.label, accepted: ((q.correct as string[][])[i] ?? []).join("\n") }));
  }
  if (q.type === "ordering") d.items = (q.correct as number[]).map((i) => strs(c.items)[i]).join("\n");
  return d;
}

function fromDraft(d: Draft, subjectId: string): { body?: Record<string, unknown>; error?: string } {
  const content: Record<string, unknown> = {};
  if (d.passage.trim()) content.passage = d.passage.trim();
  if (d.source.trim()) content.source = d.source.trim();
  if (d.image) content.image = d.image;
  if (d.hint.trim()) content.hint = d.hint.trim();
  if (d.tableJson.trim()) {
    try {
      content.table = JSON.parse(d.tableJson) as DataTable;
    } catch {
      return { error: "Табела није исправан JSON." };
    }
  }
  let correct: unknown;
  switch (d.type) {
    case "single":
    case "multi":
      content.options = lines(d.options);
      if (d.optionImages.trim()) content.optionImages = d.optionImages.split(",").map((s) => s.trim()).filter(Boolean);
      correct = d.type === "single" ? d.single : d.multi;
      break;
    case "text":
      content.fields = d.fields.map((f) => ({ label: f.label.trim() }));
      correct = d.fields.map((f) => lines(f.accepted));
      break;
    case "matching":
      content.rows = lines(d.rows);
      content.columns = lines(d.columns);
      correct = lines(d.rows).map((_, i) => d.matching[i] ?? -1);
      break;
    case "ordering":
      content.items = lines(d.items);
      correct = lines(d.items).map((_, i) => i);
      break;
  }
  return {
    body: {
      subjectId,
      number: Number(d.number),
      section: d.section.trim(),
      type: d.type,
      prompt: d.prompt,
      content,
      correct,
      explanation: d.explanation,
      points: Number(d.points),
      active: d.active,
    },
  };
}

type TestRow = { key: string; subjectId: string; label: string };

/** Извор задатака у админу: збирка или један тест са завршног испита. */
const COLLECTION = "zbirka";

function QuestionsTab() {
  const [subjectsList, setSubjects] = useState<SubjectRow[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [testsList, setTests] = useState<TestRow[]>([]);
  const [source, setSource] = useState(COLLECTION);
  const [list, setList] = useState<AdminQuestion[]>([]);
  const [section, setSection] = useState("");
  const [editing, setEditing] = useState<AdminQuestion | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [imagesList, setImages] = useState<{ name: string }[]>([]);
  const [msg, setMsg] = useState({ text: "", bad: false });

  useEffect(() => {
    api<SubjectRow[]>("/admin/subjects").then((s) => {
      setSubjects(s);
      if (s[0]) setSubjectId(s[0].id);
    });
    api<{ name: string }[]>("/admin/images").then(setImages);
    api<TestRow[]>("/admin/tests").then(setTests);
  }, []);

  const load = () =>
    subjectId
      ? api<AdminQuestion[]>(
          `/admin/questions?subjectId=${encodeURIComponent(subjectId)}&source=${encodeURIComponent(source)}`,
        ).then(setList)
      : Promise.resolve();
  useEffect(() => {
    setSection("");
    void load();
  }, [subjectId, source]);

  const testLabel = (key: string | null) => testsList.find((t) => t.key === key)?.label ?? key ?? "";

  const sections = useMemo(() => [...new Set(list.map((q) => q.section))], [list]);
  const shown = list.filter((q) => !section || q.section === section);

  async function save() {
    if (!draft) return;
    const { body, error } = fromDraft(draft, subjectId);
    if (!body) {
      setMsg({ text: error ?? "", bad: true });
      return;
    }
    try {
      if (draft.id === null) await api("/admin/questions", { body });
      else await api(`/admin/questions/${draft.id}`, { method: "PUT", body });
      setMsg({ text: "Задатак је сачуван.", bad: false });
      setDraft(null);
      setEditing(null);
      await load();
      window.scrollTo({ top: 0 });
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    }
  }

  async function upload(file: File) {
    const name = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("Слика није прочитана."));
      reader.readAsDataURL(file);
    });
    try {
      await api("/admin/images", { body: { name, mime: file.type, dataBase64 } });
      setImages(await api<{ name: string }[]>("/admin/images"));
      if (draft) setDraft({ ...draft, image: name });
      setMsg({ text: `Слика ${name} је додата.`, bad: false });
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    }
  }

  if (draft) {
    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
    const options = lines(draft.options);
    const rows = lines(draft.rows);
    const columns = lines(draft.columns);
    return (
      <div className="space-y-4">
        <Message {...msg} />
        <Card title={draft.id === null ? "Нови задатак" : `Задатак ${draft.number}`}>
          {editing?.testKey ? (
            <p className="rounded-lg bg-brand-soft px-3 py-2 text-[15px]">
              Задатак из теста „{testLabel(editing.testKey)}“. Тачан одговор мора остати онај из Упутства за
              прегледање.
              {editing.partialCredit?.length
                ? ` Делимични бодови по упутству: ${editing.partialCredit
                    .map((r) => `${r.correct} тачна реда и ниједан нетачан — ${String(r.points).replace(".", ",")} бода`)
                    .join("; ")} — остају при измени.`
                : ""}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Label text={editing?.testKey ? "Број у тесту" : "Број у збирци"}>
              <input className="field" inputMode="numeric" value={draft.number} onChange={(e) => set({ number: e.target.value })} />
            </Label>
            {editing?.testKey ? null : (
              <Label text="Целина">
                <input className="field" list="sections" value={draft.section} onChange={(e) => set({ section: e.target.value })} />
                <datalist id="sections">
                  {sections.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Label>
            )}
            <Label text="Тип">
              <select className="field" value={draft.type} onChange={(e) => set({ type: e.target.value as QuestionType })}>
                {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Label>
          </div>
          <Label text="Текст задатка">
            <textarea className="field min-h-24" value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} />
          </Label>
          <Label text="Одломак из извора (није обавезно)">
            <textarea className="field min-h-20" value={draft.passage} onChange={(e) => set({ passage: e.target.value })} />
          </Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Извор одломка">
              <input className="field" value={draft.source} onChange={(e) => set({ source: e.target.value })} />
            </Label>
            <Label text="Напомена ученику">
              <input className="field" value={draft.hint} onChange={(e) => set({ hint: e.target.value })} />
            </Label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Слика (карта, фотографија)">
              <select className="field" value={draft.image} onChange={(e) => set({ image: e.target.value })}>
                <option value="">без слике</option>
                {imagesList.map((i) => (
                  <option key={i.name} value={i.name}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Додај нову слику (JPG, PNG)">
              <input
                className="field"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
              />
            </Label>
          </div>
          {draft.image ? <img src={imageUrl(draft.image)} alt="" className="max-h-60 rounded border border-line" /> : null}
        </Card>

        <Card title="Одговори и кључ">
          {draft.type === "single" || draft.type === "multi" ? (
            <>
              <Label text="Понуђени одговори — сваки у свом реду">
                <textarea className="field min-h-28" value={draft.options} onChange={(e) => set({ options: e.target.value })} />
              </Label>
              <p className="text-[15px] text-muted">Означи {draft.type === "single" ? "тачан одговор" : "све тачне одговоре"}:</p>
              <div className="space-y-2">
                {options.map((o, i) => (
                  <label key={i} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3">
                    <input
                      type={draft.type === "single" ? "radio" : "checkbox"}
                      className="h-5 w-5"
                      checked={draft.type === "single" ? draft.single === i : draft.multi.includes(i)}
                      onChange={() =>
                        draft.type === "single"
                          ? set({ single: i })
                          : set({ multi: draft.multi.includes(i) ? draft.multi.filter((v) => v !== i) : [...draft.multi, i].sort((a, b) => a - b) })
                      }
                    />
                    <span>{o}</span>
                  </label>
                ))}
              </div>
              <Label text="Слике као понуђени одговори (називи, раздвојени зарезом — није обавезно)">
                <input className="field" value={draft.optionImages} onChange={(e) => set({ optionImages: e.target.value })} />
              </Label>
            </>
          ) : null}

          {draft.type === "text" ? (
            <>
              {draft.fields.map((f, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
                  <Label text={`Поље ${i + 1} — натпис`}>
                    <input
                      className="field"
                      value={f.label}
                      onChange={(e) => set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                    />
                  </Label>
                  <Label text="Прихватљиви одговори — сваки у свом реду">
                    <textarea
                      className="field min-h-20"
                      value={f.accepted}
                      onChange={(e) => set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, accepted: e.target.value } : x)) })}
                    />
                  </Label>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => set({ fields: [...draft.fields, { label: "", accepted: "" }] })}>
                  Додај поље
                </button>
                {draft.fields.length > 1 ? (
                  <button type="button" className="btn btn-ghost" onClick={() => set({ fields: draft.fields.slice(0, -1) })}>
                    Уклони последње
                  </button>
                ) : null}
              </div>
              <p className="text-sm text-muted">Латиница у одговору ученика признаје се као ћирилица; велика слова и размаци не сметају.</p>
            </>
          ) : null}

          {draft.type === "matching" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Label text="Редови табеле — сваки у свом реду">
                  <textarea className="field min-h-28" value={draft.rows} onChange={(e) => set({ rows: e.target.value })} />
                </Label>
                <Label text="Колоне табеле — свака у свом реду">
                  <textarea className="field min-h-28" value={draft.columns} onChange={(e) => set({ columns: e.target.value })} />
                </Label>
              </div>
              {rows.map((r, i) => (
                <Label key={i} text={`Тачна колона за: ${r}`}>
                  <select
                    className="field"
                    value={draft.matching[i] ?? -1}
                    onChange={(e) => {
                      const next = rows.map((_, j) => draft.matching[j] ?? -1);
                      next[i] = Number(e.target.value);
                      set({ matching: next });
                    }}
                  >
                    <option value={-1}>—</option>
                    {columns.map((c, j) => (
                      <option key={j} value={j}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Label>
              ))}
            </>
          ) : null}

          {draft.type === "ordering" ? (
            <Label text="Ставке ТАЧНИМ редом — свака у свом реду (сервер их чува измешане)">
              <textarea className="field min-h-28" value={draft.items} onChange={(e) => set({ items: e.target.value })} />
            </Label>
          ) : null}

          <Label text="Табела уз задатак — JSON { head: [...], rows: [[...]] } (није обавезно)">
            <textarea className="field min-h-20 font-mono text-[15px]" value={draft.tableJson} onChange={(e) => set({ tableJson: e.target.value })} />
          </Label>
          <Label text="Објашњење (види се тек после провере)">
            <textarea className="field min-h-24" value={draft.explanation} onChange={(e) => set({ explanation: e.target.value })} />
          </Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Поени">
              <input className="field" inputMode="numeric" value={draft.points} onChange={(e) => set({ points: e.target.value })} />
            </Label>
            <label className="flex min-h-11 items-center gap-3 self-end text-[15px]">
              <input type="checkbox" className="h-6 w-6" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
              задатак је активан (види се ученицима)
            </label>
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={save}>
            Сачувај
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setDraft(null);
              setEditing(null);
            }}
          >
            Одустани
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Message {...msg} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Label text="Предмет">
            <select className="field" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjectsList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Извор">
            <select className="field" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value={COLLECTION}>збирка</option>
              {testsList
                .filter((t) => t.subjectId === subjectId)
                .map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
            </select>
          </Label>
          {source === COLLECTION ? (
            <Label text="Целина">
              <select className="field" value={section} onChange={(e) => setSection(e.target.value)}>
                <option value="">све</option>
                {sections.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Label>
          ) : null}
        </div>
        {/* Нови задаци иду само у збирку: тестови са завршних испита су
            затворени скупови од 20 задатака из Завода. */}
        {source === COLLECTION ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setDraft(emptyDraft(section || sections[0] || ""));
            }}
          >
            Нови задатак
          </button>
        ) : null}
      </Card>
      <ul className="space-y-2">
        {shown.map((q) => (
          <li key={q.id}>
            <button
              type="button"
              className="flex min-h-11 w-full items-start gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-left"
              onClick={() => {
                setMsg({ text: "", bad: false });
                setEditing(q);
                setDraft(toDraft(q));
                window.scrollTo({ top: 0 });
              }}
            >
              <span className="w-12 shrink-0 font-bold">{q.number}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-[16px]">{q.prompt}</span>
                <span className="block text-sm text-muted">
                  {TYPE_LABELS[q.type]} · верзија {q.version}
                  {q.active ? "" : " · искључен"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Истраживање ───────────────────────────────────────────────────────────

type FormRow = { testKey: string | null; questionNumbers: number[]; questionCount: number };

type Study = {
  currentPhase: string | null;
  testOpen: boolean;
  practiceOpen: boolean;
  phases: string[];
  rotation: Record<string, Record<string, string>>;
  subjects: {
    id: string;
    name: string;
    measurementStarted: boolean;
    tests: { key: string; label: string; year: number }[];
    forms: Record<string, FormRow>;
  }[];
};

/** Избор за форму: кључ теста или „бројеви из збирке“. */
const FROM_COLLECTION = "";

function StudyTab() {
  const [study, setStudy] = useState<Study | null>(null);
  const [formsText, setFormsText] = useState<Record<string, string>>({});
  const [formsTest, setFormsTest] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState({ text: "", bad: false });

  const load = () =>
    api<Study>("/admin/study").then((s) => {
      setStudy(s);
      const text: Record<string, string> = {};
      const test: Record<string, string> = {};
      for (const subj of s.subjects)
        for (const [code, f] of Object.entries(subj.forms)) {
          text[`${subj.id}/${code}`] = f.questionNumbers.join(", ");
          test[`${subj.id}/${code}`] = f.testKey ?? FROM_COLLECTION;
        }
      setFormsText(text);
      setFormsTest(test);
    });
  useEffect(() => {
    void load();
  }, []);

  async function put(path: string, body: unknown, ok: string) {
    try {
      await api(path, { method: "PUT", body });
      setMsg({ text: ok, bad: false });
      await load();
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    }
  }

  if (!study) return <p className="text-muted">Учитавање…</p>;

  return (
    <div className="space-y-4">
      <Message {...msg} />
      <Card title="Фаза и термини">
        <div className="grid gap-3 sm:grid-cols-3">
          <Label text="Текућа фаза мерења">
            <select
              className="field"
              value={study.currentPhase ?? ""}
              onChange={(e) => put("/admin/study", { currentPhase: e.target.value || null }, "Фаза је сачувана.")}
            >
              <option value="">није постављена</option>
              {study.phases.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Label>
          <label className="flex min-h-11 items-center gap-3 self-end text-[15px]">
            <input
              type="checkbox"
              className="h-6 w-6"
              checked={study.testOpen}
              onChange={(e) => put("/admin/study", { testOpen: e.target.checked }, e.target.checked ? "Термин провере је отворен." : "Термин провере је затворен.")}
            />
            термин провере отворен
          </label>
          <label className="flex min-h-11 items-center gap-3 self-end text-[15px]">
            <input
              type="checkbox"
              className="h-6 w-6"
              checked={study.practiceOpen}
              onChange={(e) => put("/admin/study", { practiceOpen: e.target.checked }, "Сачувано.")}
            />
            вежбање отворено
          </label>
        </div>
        <p className="text-sm text-muted">
          Ротација форми (група → T0, T1, T2, T3):{" "}
          {Object.entries(study.rotation)
            .map(([g, r]) => `${g}: ${Object.values(r).join(" ")}`)
            .join(" · ")}
          . T3 понавља форму из T0 — мерење задржавања на истим задацима.
        </p>
      </Card>

      {study.subjects.map((s) => (
        <Card key={s.id} title={`Форме A/B/C — ${s.name}`}>
          {s.measurementStarted ? (
            <p className="text-[15px] text-muted">Мерење је почело — форме се више не могу мењати.</p>
          ) : (
            <p className="text-[15px] text-muted">
              За сваку форму изабери тест са завршног испита или упиши бројеве задатака из збирке. Форме бира
              истраживач; апликација их не прави сама. Исти тест не може бити у две форме.
            </p>
          )}
          {Object.keys(s.forms).map((code) => {
            const key = `${s.id}/${code}`;
            const chosenTest = formsTest[key] ?? FROM_COLLECTION;
            return (
              <div key={code} className="space-y-2 rounded-xl border border-line p-3">
                <Label text={`Форма ${code} — сада: ${zadatakaShort(s.forms[code]!.questionCount)}`}>
                  <select
                    className="field"
                    disabled={s.measurementStarted}
                    value={chosenTest}
                    onChange={(e) => setFormsTest({ ...formsTest, [key]: e.target.value })}
                  >
                    {s.tests.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                    <option value={FROM_COLLECTION}>задаци из збирке (по бројевима)</option>
                  </select>
                </Label>
                {chosenTest === FROM_COLLECTION ? (
                  <Label text="Бројеви задатака из збирке, раздвојени зарезом">
                    <input
                      className="field"
                      disabled={s.measurementStarted}
                      value={formsText[key] ?? ""}
                      onChange={(e) => setFormsText({ ...formsText, [key]: e.target.value })}
                    />
                  </Label>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={s.measurementStarted}
                  onClick={() =>
                    put(
                      `/admin/forms/${encodeURIComponent(s.id)}/${code}`,
                      chosenTest !== FROM_COLLECTION
                        ? { testKey: chosenTest }
                        : {
                            questionNumbers: (formsText[key] ?? "")
                              .split(/[\s,;]+/)
                              .filter(Boolean)
                              .map(Number),
                          },
                      `Форма ${code} је сачувана.`,
                    )
                  }
                >
                  Сачувај форму {code}
                </button>
              </div>
            );
          })}
        </Card>
      ))}
    </div>
  );
}

const zadatakaShort = (n: number) => (n === 0 ? "празна" : zadataka(n));

// ── Покушаји и извоз ──────────────────────────────────────────────────────

type AttemptRow = {
  id: number;
  fullName: string;
  subjectId: string;
  kind: string;
  section: string | null;
  phase: string | null;
  form: string | null;
  score: number | null;
  maxScore: number | null;
  startedAt: string;
  submittedAt: string | null;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
};

function AttemptsTab() {
  const [list, setList] = useState<AttemptRow[]>([]);
  const [msg, setMsg] = useState({ text: "", bad: false });
  const load = () => api<AttemptRow[]>("/admin/attempts").then(setList);
  useEffect(() => {
    void load();
  }, []);

  async function get(path: string, name: string) {
    try {
      await download(path, name);
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    }
  }

  return (
    <div className="space-y-4">
      <Message {...msg} />
      <Card title="Извоз за анализу (CSV)">
        <p className="text-[15px] text-muted">
          Само ученици са уписаном сагласношћу, под псеудонимом — без имена. Колоне су исте на свим платформама.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => get("/admin/export/attempts.csv", "pokusaji.csv")}>
            Покушаји
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => get("/admin/export/items.csv", "zadaci.csv")}>
            Задаци
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => get("/admin/export/events.csv", "dogadjaji.csv")}>
            Телеметрија
          </button>
        </div>
      </Card>

      <Card title={`Последњи покушаји (${list.length})`}>
        <ul className="space-y-2">
          {list.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
              <div className="min-w-0 text-[15px]">
                <p className="font-semibold">{a.fullName}</p>
                <p className="text-muted">
                  {a.kind === "merenje" ? `провера ${a.phase} · форма ${a.form}` : `вежбање ${a.section ?? ""}`} ·{" "}
                  {a.submittedAt ? `${a.score}/${a.maxScore}` : "није завршено"} · {new Date(a.startedAt).toLocaleString("sr-RS")}
                  {a.invalidatedAt ? ` · поништено (${a.invalidatedReason})` : ""}
                </p>
              </div>
              {!a.invalidatedAt ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    const reason = window.prompt("Разлог поништавања (нпр. пукла веза):");
                    if (!reason) return;
                    try {
                      await api(`/admin/attempts/${a.id}/invalidate`, { body: { reason } });
                      setMsg({ text: "Покушај је поништен.", bad: false });
                      await load();
                    } catch (e) {
                      setMsg({ text: (e as Error).message, bad: true });
                    }
                  }}
                >
                  Поништи
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
