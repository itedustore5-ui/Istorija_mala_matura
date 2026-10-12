import { useEffect, useState, type FormEvent } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { api, TOKEN_KEY, type User } from "./api";
import { flush } from "./telemetry";
import HomePage from "./pages/HomePage";
import PracticePage from "./pages/PracticePage";
import TestPage from "./pages/TestPage";
import AdminPage from "./pages/AdminPage";

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ token: string; user: User }>("/auth/login", { body: { username, password } });
      localStorage.setItem(TOKEN_KEY, data.token);
      onLogin(data.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-white p-5">
        <div>
          <h1 className="text-xl font-bold">Мала матура</h1>
          <p className="text-[15px] text-muted">Припрема за завршни испит — историја</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-[15px]">Корисничко име</span>
          <input
            className="field"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="off"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[15px]">Лозинка</span>
          <input
            className="field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error ? <p className="text-[15px] text-bad">{error}</p> : null}
        <button type="submit" className="btn btn-primary w-full" disabled={busy || !username || !password}>
          {busy ? "Пријава…" : "Пријави се"}
        </button>
      </form>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    api<User>("/auth/me")
      .then(setUser)
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="py-20 text-center text-muted">Учитавање…</p>;
  if (!user) return <Login onLogin={setUser} />;

  const logout = () => {
    flush();
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    navigate("/");
  };

  // Током решавања заглавље не лепи за врх: трака при дну је навигација, а
  // екран остаје задатку.
  const solving = location.startsWith("/vezbanje/") || location.startsWith("/provera/");

  return (
    <div className="min-h-dvh">
      <header className={`${solving ? "" : "sticky top-0"} z-10 border-b border-line bg-white`}>
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-1.5">
          <Link href="/" className="flex min-h-11 min-w-0 flex-1 items-center font-bold">
            <span className="truncate">Мала матура · историја</span>
          </Link>
          {user.role === "admin" ? (
            <Link href="/admin" className="btn btn-ghost px-3">
              Админ
            </Link>
          ) : null}
          <button type="button" className="btn btn-ghost px-3" onClick={logout}>
            Одјава
          </button>
        </div>
      </header>
      <Switch>
        <Route path="/">{() => <HomePage user={user} />}</Route>
        <Route path="/vezbanje/:subject/:section">
          {(params) => <PracticePage subjectId={decodeURIComponent(params.subject)} section={decodeURIComponent(params.section)} />}
        </Route>
        <Route path="/provera/:subject">{(params) => <TestPage subjectId={decodeURIComponent(params.subject)} />}</Route>
        <Route path="/admin">{() => (user.role === "admin" ? <AdminPage /> : <HomePage user={user} />)}</Route>
        <Route>
          <main className="mx-auto max-w-2xl px-4 py-10 text-center">
            <p className="mb-4">Ова страна не постоји.</p>
            <Link href="/" className="btn btn-primary">
              Почетна
            </Link>
          </main>
        </Route>
      </Switch>
    </div>
  );
}
