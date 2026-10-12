import { useEffect, useState } from "react";
import { api, blockLabel, type ScoreboardEntry } from "@/lib/api";

// Целине се овде наводе само као филтер; које целине постоје и колико имају
// задатака зна сервер (`/catalog`). Кључ непознат серверу враћа све резултате.
const BLOCKS = ["241-260", "261-280", "281-300", "301-320", "321-340", "341-360"];

export default function ScoreboardPage() {
  const [block, setBlock] = useState("");
  const [rows, setRows] = useState<ScoreboardEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = block ? `?block=${encodeURIComponent(block)}` : "";
    api<ScoreboardEntry[]>(`/scoreboard${query}`)
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, [block]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Ранг-листа</h1>
        <p className="mt-1 text-muted-foreground">
          Приказује се само вежбање из збирке. Тестови са завршних испита имају
          другачије бодовање, па се не мешају у исти просек.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <select
          value={block}
          onChange={(e) => setBlock(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Све целине</option>
          {BLOCKS.map((key) => (
            <option key={key} value={key}>
              {blockLabel(key)}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-3">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">Ученик</th>
              <th className="px-4 py-3 text-right font-medium">Најбоље</th>
              <th className="px-4 py-3 text-right font-medium">Покушаја</th>
              <th className="px-4 py-3 text-right font-medium">Последње</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.username} className="border-t border-border">
                <td className="px-4 py-3">{row.rank}</td>
                <td className="px-4 py-3">{row.fullName}</td>
                <td className="px-4 py-3 text-right font-semibold">{row.bestScore}%</td>
                <td className="px-4 py-3 text-right">{row.attemptsCount}</td>
                <td className="px-4 py-3 text-right">
                  {row.lastScore === null ? "—" : `${row.lastScore}%`}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  Нема резултата за изабрани филтер.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
