import { useEffect, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import NotFound from "@/pages/not-found";
import DashboardPage from "@/pages/DashboardPage";
import CatalogPage from "@/pages/CatalogPage";
import PracticePage from "@/pages/PracticePage";
import ScoreboardPage from "@/pages/ScoreboardPage";
import AdminPage from "@/pages/AdminPage";
import ResearchPage from "@/pages/ResearchPage";
import { ExamPage, ExamsPage } from "@/pages/ExamsPage";
import { api, TOKEN_KEY, type AuthUser } from "@/lib/api";

function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    api<AuthUser>("/auth/me")
      .then(setUser)
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  return { user, setUser, loading };
}

function Login({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api<{ token: string; user: AuthUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      onLogin(data.user);
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Историја</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Припрема за завршни испит у основном образовању
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-muted-foreground">Корисничко име</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-muted-foreground">Лозинка</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary"
          />
        </label>

        {error ? <p className="mb-3 text-sm text-rose-400">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {loading ? "Пријава…" : "Пријави се"}
        </button>
      </form>
    </div>
  );
}

/**
 * Трака прати збирку: задаци из збирке по целинама и цео тест са завршног
 * испита.
 *
 * `owns` набраја екране који припадају ставци, уместо да се гледа почетак
 * путање: са `startsWith` би `/vezbanje/celina` палио и ставку `/vezbanje` и
 * сваку будућу ставку чија путања почиње истим речима.
 */
type NavLink = { href: string; label: string; owns: string[] };

const NAV: NavLink[] = [
  { href: "/", label: "Почетна", owns: ["/"] },
  { href: "/vezbanje", label: "Збирка", owns: ["/vezbanje", "/vezbanje/celina"] },
  { href: "/testovi", label: "Цео тест", owns: ["/testovi", "/testovi/test"] },
  { href: "/rang-lista", label: "Ранг-листа", owns: ["/rang-lista"] },
];

function Shell({
  user,
  onLogout,
  children,
}: {
  user: AuthUser;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [location, navigate] = useLocation();
  const links: NavLink[] =
    user.role === "admin"
      ? [
          ...NAV,
          { href: "/admin", label: "Админ", owns: ["/admin"] },
          { href: "/studija", label: "Студија", owns: ["/studija"] },
        ]
      : NAV;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold">Историја — мала матура</span>
          <nav className="flex flex-wrap gap-1">
            {links.map((link) => {
              const active = link.owns.includes(location);
              return (
                <button
                  key={link.href}
                  type="button"
                  onClick={() => navigate(link.href)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={onLogout}
            className="ml-auto text-sm text-muted-foreground hover:text-foreground"
          >
            Одјава
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

export default function App() {
  const auth = useAuth();

  if (auth.loading) {
    return <p className="py-24 text-center text-muted-foreground">Учитавање…</p>;
  }

  if (!auth.user) {
    return <Login onLogin={auth.setUser} />;
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    auth.setUser(null);
  };

  return (
    <Shell user={auth.user} onLogout={logout}>
      <Switch>
        <Route path="/">{() => <DashboardPage user={auth.user!} />}</Route>
        <Route path="/vezbanje">{() => <CatalogPage />}</Route>
        <Route path="/vezbanje/celina">{() => <PracticePage />}</Route>
        <Route path="/testovi">{() => <ExamsPage />}</Route>
        <Route path="/testovi/test">{() => <ExamPage />}</Route>
        <Route path="/rang-lista">{() => <ScoreboardPage />}</Route>
        <Route path="/admin">
          {() => (auth.user!.role === "admin" ? <AdminPage /> : <DashboardPage user={auth.user!} />)}
        </Route>
        <Route path="/studija">
          {() =>
            auth.user!.role === "admin" ? <ResearchPage /> : <DashboardPage user={auth.user!} />
          }
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}
