import { useEffect, useState } from "react";
import { api, blockLabel, type AdminResult, type AdminUser } from "@/lib/api";

type UserInput = {
  username: string;
  password: string;
  fullName: string;
  role: "admin" | "student";
  active: boolean;
  neverExpires: boolean;
  quizOnce: boolean;
};

const emptyUser: UserInput = {
  username: "",
  password: "",
  fullName: "",
  role: "student",
  active: true,
  neverExpires: true,
  quizOnce: false,
};

export default function AdminPage() {
  const [tab, setTab] = useState<"users" | "results">("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [results, setResults] = useState<AdminResult[]>([]);
  const [form, setForm] = useState<UserInput>(emptyUser);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadUsers = () =>
    api<AdminUser[]>("/admin/users").then(setUsers).catch((e: Error) => setError(e.message));
  const loadResults = () =>
    api<AdminResult[]>("/admin/results").then(setResults).catch((e: Error) => setError(e.message));

  useEffect(() => {
    void loadUsers();
    void loadResults();
  }, []);

  async function save() {
    setError("");
    try {
      if (editingId === null) {
        await api("/admin/users", { method: "POST", body: JSON.stringify(form) });
      } else {
        await api(`/admin/users/${editingId}`, { method: "PUT", body: JSON.stringify(form) });
      }
      setForm(emptyUser);
      setEditingId(null);
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Обрисати налог и све његове резултате?")) return;
    await api(`/admin/users/${id}`, { method: "DELETE" });
    await loadUsers();
    await loadResults();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Администрација</h1>

      <div className="flex gap-2">
        {(["users", "results"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              tab === key ? "bg-primary text-primary-foreground" : "border border-border"
            }`}
          >
            {key === "users" ? "Налози" : "Резултати"}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-3">{error}</p>
      ) : null}

      {tab === "users" ? (
        <>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 font-semibold">
              {editingId === null ? "Нови налог" : "Измена налога"}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Корисничко име">
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary"
                />
              </Field>
              {/*
                Лозинка се не може прочитати — сервер чува само хеш. Кад је
                ученик заборави, наставник овде уписује нову.
              */}
              <Field label={editingId === null ? "Лозинка" : "Нова лозинка (празно = не мењај)"}>
                <input
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingId === null ? "најмање 6 знакова" : "остави празно да остане иста"}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary"
                />
              </Field>
              <Field label="Име и презиме">
                <input
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary"
                />
              </Field>
              <Field label="Улога">
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "student" })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary"
                >
                  <option value="student">ученик</option>
                  <option value="admin">администратор</option>
                </select>
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              налог је активан
            </label>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={save}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Сачувај
              </button>
              {editingId !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setForm(emptyUser);
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-sm"
                >
                  Одустани
                </button>
              ) : null}
            </div>
          </section>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Корисник</th>
                  <th className="px-4 py-3 text-left font-medium">Име</th>
                  <th className="px-4 py-3 text-left font-medium">Улога</th>
                  <th className="px-4 py-3 text-left font-medium">Стање</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-4 py-3">{u.username}</td>
                    <td className="px-4 py-3">{u.fullName}</td>
                    <td className="px-4 py-3">{u.role === "admin" ? "админ" : "ученик"}</td>
                    <td className="px-4 py-3">{u.active ? "активан" : "неактиван"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(u.id);
                          setForm({
                            username: u.username,
                            password: "",
                            fullName: u.fullName,
                            role: u.role,
                            active: u.active,
                            neverExpires: u.neverExpires,
                            quizOnce: u.quizOnce,
                          });
                        }}
                        className="mr-3 text-primary hover:underline"
                      >
                        измени
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(u.id)}
                        className="text-rose-400 hover:underline"
                      >
                        обриши
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Ученик</th>
                <th className="px-4 py-3 text-left font-medium">Шта</th>
                <th className="px-4 py-3 text-right font-medium">Резултат</th>
                <th className="px-4 py-3 text-right font-medium">Датум</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-3">{r.fullName}</td>
                  <td className="px-4 py-3">
                    {r.examKey
                      ? `тест: ${r.examKey}`
                      : r.block
                        ? `вежбање · ${blockLabel(r.block)}`
                        : "вежбање"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.examKey && r.pointsEarned !== null
                      ? `${r.pointsEarned}/${r.pointsTotal} поена`
                      : `${r.score}/${r.total} (${r.percentage}%)`}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("sr-RS")}
                  </td>
                </tr>
              ))}
              {results.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    Још нема резултата.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
