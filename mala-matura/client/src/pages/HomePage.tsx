import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, zadataka, type Subject, type User } from "../api";

/**
 * Почетна: предмет, провера знања (кад је термин отворен) и целине збирке за
 * вежбање, са најбољим резултатом у свакој.
 */
export default function HomePage({ user }: { user: User }) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Subject[]>("/subjects")
      .then(setSubjects)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-5">
      <p className="text-[17px]">
        Здраво, <strong>{user.fullName}</strong>.
      </p>
      {error ? <p className="rounded-lg bg-bad-soft px-4 py-3 text-bad">{error}</p> : null}
      {!subjects && !error ? <p className="text-muted">Учитавање…</p> : null}
      {subjects?.length === 0 ? (
        <p className="rounded-lg bg-white px-4 py-3">
          У бази још нема задатака. Администратор треба да покрене <code>npm run seed</code>.
        </p>
      ) : null}

      {subjects?.map((s) => (
        <section key={s.id} className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">{s.name}</h1>
            {s.source ? <p className="mt-1 text-[15px] leading-snug text-muted">{s.source}</p> : null}
          </div>

          {s.test.available ? (
            <Link
              href={`/provera/${encodeURIComponent(s.id)}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border-2 border-brand bg-brand-soft px-4 py-4"
            >
              <span>
                <span className="block text-[17px] font-bold">Провера знања {s.test.phase}</span>
                <span className="block text-[15px] text-muted">Ради се једном. Резултат видиш после предаје.</span>
              </span>
              <span className="text-2xl" aria-hidden>
                →
              </span>
            </Link>
          ) : null}

          <div>
            <h2 className="mb-2 text-lg font-semibold">Вежбање по целинама</h2>
            {!s.practice.ok ? (
              <p className="rounded-xl border border-line bg-white px-4 py-3 text-[16px]">{s.practice.reason}</p>
            ) : (
              <ul className="space-y-2.5">
                {s.sections.map((sec) => (
                  <li key={sec.key}>
                    <Link
                      href={`/vezbanje/${encodeURIComponent(s.id)}/${encodeURIComponent(sec.key)}`}
                      className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-white px-4 py-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[17px] font-semibold">{sec.label}</span>
                        <span className="block text-[15px] text-muted">
                          {zadataka(sec.questionCount)}
                          {sec.pages ? (
                            <>
                              {" · "}
                              <span className="whitespace-nowrap">збирка, {sec.pages}</span>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-lg px-2.5 py-1 text-[15px] font-bold ${
                          sec.bestPercent === null ? "text-muted" : "bg-brand-soft text-brand"
                        }`}
                      >
                        {sec.bestPercent === null ? "—" : `${sec.bestPercent}%`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Тестови са завршних испита. Сервер их шаље само ученицима ван
              истраживања: учесницима су то форме провера знања. */}
          {s.tests.length > 0 ? (
            <div>
              <h2 className="mb-2 text-lg font-semibold">Завршни испити претходних година</h2>
              <ul className="space-y-2.5">
                {s.tests.map((t) => (
                  <li key={t.key}>
                    <Link
                      href={`/vezbanje-test/${encodeURIComponent(t.key)}`}
                      className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-white px-4 py-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[17px] font-semibold">{t.label}</span>
                        <span className="block text-[15px] text-muted">{zadataka(t.questionCount)} · цео тест</span>
                      </span>
                      <span
                        className={`shrink-0 rounded-lg px-2.5 py-1 text-[15px] font-bold ${
                          t.bestPercent === null ? "text-muted" : "bg-brand-soft text-brand"
                        }`}
                      >
                        {t.bestPercent === null ? "—" : `${t.bestPercent}%`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ))}
    </main>
  );
}
