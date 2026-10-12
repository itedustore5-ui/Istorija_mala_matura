import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api, type AuthUser, type DashboardStats } from "@/lib/api";

/**
 * Почетна страна.
 *
 * Ученик долази да ради, не да гледа статистику: два велика поља воде у
 * збирку и на цео тест, а резултат по целинама стоји у једном реду испод, да
 * се види шта је остало неурађено.
 */
export default function DashboardPage({ user }: { user: AuthUser }) {
  const [, navigate] = useLocation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<DashboardStats>("/dashboard")
      .then(setStats)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Здраво, {user.fullName}.</h1>
        <p className="mt-1 text-muted-foreground">
          Припрема за завршни испит из историје.
        </p>
        {stats ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Урађено {stats.solvedCount} од {stats.questionCount} задатака
            {stats.bestScore > 0 ? ` · најбољи резултат ${stats.bestScore}%` : ""}
          </p>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-3">{error}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Tile
          mark="241–360"
          title="Збирка"
          note="Задаци из збирке по целинама, са објашњењем после сваког одговора"
          onClick={() => navigate("/vezbanje")}
        />
        <Tile
          mark="Тест"
          title="Цео тест"
          note="Тестови са завршних испита из претходних година"
          onClick={() => navigate("/testovi")}
        />
      </div>

      {stats ? (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Најбољи резултат по целинама</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stats.blockScores.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => navigate(`/vezbanje/celina?blok=${encodeURIComponent(b.key)}`)}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:border-primary/60"
              >
                <span>{b.label}</span>
                <span className={b.bestScore === null ? "text-muted-foreground" : "font-semibold text-primary"}>
                  {b.bestScore === null ? "—" : `${b.bestScore}%`}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Велико поље: велика мета за прст, исто на телефону и на рачунару. */
function Tile({
  mark,
  title,
  note,
  onClick,
}: {
  mark: string;
  title: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-48 flex-col items-start justify-between gap-6 rounded-2xl border border-border bg-card p-6 text-left transition hover:border-primary/60"
    >
      <span className="text-3xl font-semibold text-primary">{mark}</span>
      <span>
        <span className="block text-lg font-semibold">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{note}</span>
      </span>
    </button>
  );
}
