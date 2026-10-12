import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api, type Catalog } from "@/lib/api";

/**
 * Задаци из збирке, по целинама од двадесет узастопних бројева.
 *
 * Збирка историју не дели на нивое ни области, па ни екран не измишља поделу:
 * целина је само распон бројева из књиге, уз стране на којима стоји — ученик
 * који има књигу пред собом увек зна где је.
 */
export default function CatalogPage() {
  const [, navigate] = useLocation();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Catalog>("/catalog")
      .then(setCatalog)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-3">{error}</p>
    );
  }
  if (!catalog) {
    return <p className="py-16 text-center text-muted-foreground">Учитавање…</p>;
  }

  const total = catalog.blocks.reduce((n, b) => n + b.questionCount, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mb-2 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Почетна
        </button>
        <h1 className="text-2xl font-semibold">Збирка — историја</h1>
        <p className="mt-1 text-muted-foreground">
          {total} задатака из збирке за завршни испит (241–360), редом као у
          књизи. Вежба се по двадесет задатака; после сваког одговора видиш да
          ли је тачан и зашто.
        </p>
      </header>

      {/*
        Вежбање је интервенција у студији; контролна грана га не добија. Уместо
        да екран остане празан или да дугмад ништа не раде, ученик добија разлог
        — саму заштиту носи сервер, не ово што се овде приказује.
      */}
      {!catalog.practiceAllowed ? (
        <p className="rounded-xl border border-border bg-card px-5 py-4 text-[15px] leading-relaxed">
          {catalog.practiceReason}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {catalog.blocks.map((block) => {
          const empty = block.questionCount === 0 || !catalog.practiceAllowed;
          return (
            <button
              key={block.key}
              type="button"
              disabled={empty}
              onClick={() => navigate(`/vezbanje/celina?blok=${encodeURIComponent(block.key)}`)}
              className={`rounded-xl border p-4 text-left transition ${
                empty
                  ? "cursor-not-allowed border-border/50 opacity-50"
                  : "border-border bg-card hover:border-primary/60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{block.label}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">Збирка, {block.pages}</p>
                </div>
                {block.bestScore !== null ? (
                  <span className="shrink-0 rounded-md bg-primary/15 px-2 py-1 text-sm font-semibold text-primary">
                    {block.bestScore}%
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {block.questionCount === 0
                  ? "још нема задатака"
                  : `${block.questionCount} задатака · ${block.attemptsCount} покушаја`}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
