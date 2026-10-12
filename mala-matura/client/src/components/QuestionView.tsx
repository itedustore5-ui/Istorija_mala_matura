import type { ReactNode } from "react";
import { imageUrl, type Answer, type DataTable, type Question, type Reveal, type TableCell } from "../api";

/**
 * Један задатак на екрану. Исти приказ ради пре одговора и после провере;
 * после провере стиже `reveal` (кључ и објашњење са сервера). Клијент сам
 * ништа не бодује — боје „тачно/нетачно“ долазе из `reveal`.
 *
 * Мобилни приказ: свака површина за додир има бар 44px, на СВАКОМ типу
 * задатка; ништа не тражи хоризонтално скроловање (табеле се на уском екрану
 * претварају у картице, повезивање иде ред по ред).
 */

type Props = {
  question: Question;
  answer: Answer | undefined;
  onChange: (answer: Answer) => void;
  reveal?: Reveal | null;
  /** После предаје (или провере) одговор се више не мења. */
  locked?: boolean;
};

type Mark = "none" | "chosen" | "right" | "wrong";

function markFor(chosen: boolean, isRight: boolean, revealed: boolean): Mark {
  if (!revealed) return chosen ? "chosen" : "none";
  if (isRight) return "right";
  return chosen ? "wrong" : "none";
}

const markClass: Record<Mark, string> = {
  none: "border-line bg-white",
  chosen: "border-brand bg-brand-soft",
  right: "border-ok bg-ok-soft",
  wrong: "border-bad bg-bad-soft",
};

/** Кружић (један одговор) или квадратић (више одговора), као у збирци. */
function Indicator({ mark, square }: { mark: Mark; square?: boolean }) {
  const fill =
    mark === "chosen" ? "bg-brand border-brand" : mark === "right" ? "bg-ok border-ok" : mark === "wrong" ? "bg-bad border-bad" : "border-slate-400";
  return (
    <span
      aria-hidden
      className={`mt-0.5 inline-block h-5 w-5 shrink-0 border-2 ${square ? "rounded" : "rounded-full"} ${fill}`}
    />
  );
}

function Choice({
  mark,
  square,
  disabled,
  onClick,
  children,
}: {
  mark: Mark;
  square?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={mark === "chosen" || mark === "wrong"}
      className={`flex min-h-11 w-full items-start gap-3 rounded-xl border-2 px-3 py-2.5 text-left text-[17px] leading-snug ${markClass[mark]} disabled:cursor-default`}
    >
      <Indicator mark={mark} square={square} />
      <span className="min-w-0 flex-1 whitespace-pre-line">{children}</span>
    </button>
  );
}

const cellText = (c: TableCell) => (typeof c === "string" ? c : c.text);

/**
 * Табела уз задатак. На ширем екрану права табела (као у збирци), на уском
 * картице „заглавље: вредност“ — пет колона не стаје у 320px без скроловања.
 */
function DataTableView({ table }: { table: DataTable }) {
  const head = table.head.map(cellText);
  // Ред коме недостаје прва ћелија (спојена са редом изнад) добија је назад
  // за приказ у картицама.
  let carry: TableCell | null = null;
  let carryLeft = 0;
  const fullRows = table.rows.map((row) => {
    let cells = row;
    if (carryLeft > 0 && carry) {
      cells = [carry, ...row];
      carryLeft -= 1;
    }
    const first = row[0];
    if (typeof first === "object" && first.rowSpan && first.rowSpan > 1) {
      carry = first;
      carryLeft = first.rowSpan - 1;
    }
    // Ћелија која заузима више колона понавља се, да број поља одговара заглављу.
    return cells.flatMap((c) => Array.from({ length: typeof c === "object" ? (c.colSpan ?? 1) : 1 }, () => cellText(c)));
  });

  return (
    <div className="my-4">
      {table.caption ? <p className="mb-2 text-[15px] font-semibold">{table.caption}</p> : null}
      <table className="hidden w-full border-collapse text-[15px] sm:table">
        <thead>
          <tr>
            {table.head.map((c, i) => (
              <th
                key={i}
                colSpan={typeof c === "object" ? c.colSpan : undefined}
                className="border border-line bg-slate-100 px-2 py-2 font-semibold"
              >
                {cellText(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((c, i) => (
                <td
                  key={i}
                  rowSpan={typeof c === "object" ? c.rowSpan : undefined}
                  colSpan={typeof c === "object" ? c.colSpan : undefined}
                  className="border border-line bg-white px-2 py-2 text-center"
                >
                  {cellText(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-2 sm:hidden">
        {fullRows.map((cells, r) => (
          <dl key={r} className="rounded-lg border border-line bg-white px-3 py-2 text-[15px]">
            {cells.map((value, i) =>
              value === "" && (head[i] ?? "") === "" ? null : (
                <div key={i} className="flex justify-between gap-3 border-b border-slate-100 py-1 last:border-0">
                  <dt className="text-muted">{head[i] || "—"}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ),
            )}
          </dl>
        ))}
      </div>
    </div>
  );
}

export function QuestionView({ question, answer, onChange, reveal, locked }: Props) {
  const c = question.content;
  const revealed = Boolean(reveal);
  const isLocked = Boolean(locked || reveal);

  return (
    <article className="space-y-4">
      <header>
        <p className="text-sm font-semibold text-muted">Задатак {question.number}</p>
        <h2 className="mt-1 whitespace-pre-line text-[17px] font-medium leading-relaxed">{question.prompt}</h2>
        {c.hint ? <p className="mt-1 text-[15px] text-muted">{c.hint}</p> : null}
      </header>

      {c.image ? (
        <a href={imageUrl(c.image)} target="_blank" rel="noreferrer" className="block">
          <img
            src={imageUrl(c.image)}
            alt={`Прилог уз задатак ${question.number}`}
            className="mx-auto max-h-[70vh] rounded-lg border border-line bg-white"
          />
          <span className="mt-1 block text-center text-sm text-muted">Додирни слику за увећање</span>
        </a>
      ) : null}

      {c.table ? <DataTableView table={c.table} /> : null}

      {c.passage ? (
        <blockquote className="whitespace-pre-line rounded-lg border-l-4 border-slate-300 bg-white px-4 py-3 text-[16px] leading-relaxed">
          {c.passage}
        </blockquote>
      ) : null}
      {c.source ? <p className="text-right text-[15px] italic text-muted">{c.source}</p> : null}

      <Body question={question} answer={answer} onChange={onChange} reveal={reveal ?? null} locked={isLocked} revealed={revealed} />

      {reveal ? <RevealBox question={question} reveal={reveal} /> : null}
    </article>
  );
}

function Body({
  question,
  answer,
  onChange,
  reveal,
  locked,
  revealed,
}: {
  question: Question;
  answer: Answer | undefined;
  onChange: (a: Answer) => void;
  reveal: Reveal | null;
  locked: boolean;
  revealed: boolean;
}) {
  const c = question.content;

  switch (question.type) {
    case "single":
    case "multi": {
      const multi = question.type === "multi";
      const chosen = (i: number) => (multi ? Array.isArray(answer) && (answer as number[]).includes(i) : answer === i);
      const right = (i: number) =>
        multi ? Array.isArray(reveal?.correct) && (reveal!.correct as number[]).includes(i) : reveal?.correct === i;
      const toggle = (i: number) => {
        if (!multi) return onChange(i);
        const list = Array.isArray(answer) ? (answer as number[]) : [];
        onChange(list.includes(i) ? list.filter((v) => v !== i) : [...list, i].sort((a, b) => a - b));
      };
      const options = c.options ?? [];

      if (c.optionImages) {
        // „Обој кружић испод оног који…“ — слике са кружићем испод, као у збирци.
        return (
          <div className="grid grid-cols-2 gap-3">
            {options.map((label, i) => {
              const mark = markFor(chosen(i), right(i), revealed);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={locked}
                  onClick={() => toggle(i)}
                  className={`flex min-h-11 flex-col items-center gap-2 rounded-xl border-2 p-2 ${markClass[mark]} disabled:cursor-default`}
                >
                  <img src={imageUrl(c.optionImages![i]!)} alt={label} className="h-36 w-full rounded bg-white object-contain" />
                  <span className="flex items-center gap-2 text-[16px] font-medium">
                    <Indicator mark={mark} square={multi} />
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        );
      }

      return (
        <div className="space-y-2.5">
          {multi ? <p className="text-[15px] text-muted">Изабери све тачне одговоре.</p> : null}
          {options.map((option, i) => (
            <Choice key={i} mark={markFor(chosen(i), right(i), revealed)} square={multi} disabled={locked} onClick={() => toggle(i)}>
              {option}
            </Choice>
          ))}
        </div>
      );
    }

    case "text": {
      const fields = c.fields ?? [];
      const values = Array.isArray(answer) ? (answer as string[]) : fields.map(() => "");
      return (
        <div className="space-y-4">
          {fields.map((field, i) => (
            <label key={i} className="block">
              <span className="mb-1.5 block text-[16px] leading-snug">{field.label}</span>
              <input
                type="text"
                disabled={locked}
                value={values[i] ?? ""}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => {
                  const next = fields.map((_, j) => values[j] ?? "");
                  next[i] = e.target.value;
                  onChange(next);
                }}
                className="field text-[17px] disabled:bg-slate-100"
                placeholder="Упиши одговор"
              />
            </label>
          ))}
        </div>
      );
    }

    case "matching": {
      // У збирци је ово табела са кружићима. На телефону табела од пет-шест
      // колона не стаје у ширину, па свака врста добија своју картицу, а колоне
      // су дугмад испод ње.
      const rows = c.rows ?? [];
      const columns = c.columns ?? [];
      const values = Array.isArray(answer) ? (answer as (number | null)[]) : rows.map(() => null);
      const key = Array.isArray(reveal?.correct) ? (reveal!.correct as number[]) : null;
      return (
        <div className="space-y-4">
          <p className="text-[15px] text-muted">За сваки ред изабери одговарајућу колону.</p>
          {rows.map((row, r) => (
            <section key={r} className="rounded-xl border border-line bg-white p-3">
              <p className="mb-2 text-[17px] font-medium leading-snug">{row}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {columns.map((col, j) => (
                  <Choice
                    key={j}
                    mark={markFor(values[r] === j, key ? key[r] === j : false, revealed)}
                    disabled={locked}
                    onClick={() => {
                      const next = rows.map((_, k) => (typeof values[k] === "number" ? values[k] : null));
                      next[r] = j;
                      onChange(next);
                    }}
                  >
                    {col}
                  </Choice>
                ))}
              </div>
            </section>
          ))}
        </div>
      );
    }

    case "ordering": {
      const items = c.items ?? [];
      const order = Array.isArray(answer) ? (answer as number[]) : (c.initialOrder ?? items.map((_, i) => i));
      const move = (from: number, to: number) => {
        if (to < 0 || to >= order.length) return;
        const next = [...order];
        [next[from], next[to]] = [next[to]!, next[from]!];
        onChange(next);
      };
      return (
        <div className="space-y-2.5">
          <p className="text-[15px] text-muted">Поређај стрелицама, од првог ка последњем.</p>
          {order.map((itemIndex, pos) => (
            <div key={itemIndex} className="flex items-center gap-2 rounded-xl border-2 border-line bg-white p-2">
              <span className="w-7 shrink-0 text-center text-[17px] font-semibold text-muted">{pos + 1}.</span>
              <span className="min-w-0 flex-1 text-[17px] leading-snug">{items[itemIndex]}</span>
              {/* Стрелице су пуне површине за додир (44×44), не ситне иконице. */}
              <button
                type="button"
                className="btn btn-ghost h-11 w-11 px-0 text-xl"
                disabled={locked || pos === 0}
                onClick={() => move(pos, pos - 1)}
                aria-label="Помери горе"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-ghost h-11 w-11 px-0 text-xl"
                disabled={locked || pos === order.length - 1}
                onClick={() => move(pos, pos + 1)}
                aria-label="Помери доле"
              >
                ↓
              </button>
            </div>
          ))}
        </div>
      );
    }
  }
}

function RevealBox({ question, reveal }: { question: Question; reveal: Reveal }) {
  const c = question.content;
  let correctText: ReactNode = null;

  if (question.type === "text" && Array.isArray(reveal.correct)) {
    const fields = c.fields ?? [];
    correctText = (
      <ul className="space-y-1">
        {(reveal.correct as string[][]).map((variants, i) => (
          <li key={i}>
            {fields[i]?.label ? <span className="text-muted">{fields[i]!.label} </span> : null}
            <strong>{variants[0]}</strong>
            {variants.length > 1 ? <span className="text-muted"> (прихвата се и: {variants.slice(1).join(" · ")})</span> : null}
          </li>
        ))}
      </ul>
    );
  }
  if (question.type === "ordering" && Array.isArray(reveal.correct)) {
    correctText = (
      <ol className="list-inside list-decimal space-y-0.5">
        {(reveal.correct as number[]).map((i) => (
          <li key={i}>{c.items?.[i]}</li>
        ))}
      </ol>
    );
  }

  return (
    <section
      className={`rounded-xl border-2 p-4 text-[16px] leading-relaxed ${reveal.isCorrect ? "border-ok bg-ok-soft" : "border-bad bg-bad-soft"}`}
      aria-live="polite"
    >
      <p className="text-[17px] font-semibold">{reveal.isCorrect ? "Тачно ✓" : "Није тачно"}</p>
      {correctText ? (
        <div className="mt-2">
          <p className="text-sm font-semibold text-muted">Тачан одговор</p>
          {correctText}
        </div>
      ) : null}
      {reveal.explanation ? (
        <div className="mt-2">
          <p className="text-sm font-semibold text-muted">Објашњење</p>
          <p className="whitespace-pre-line">{reveal.explanation}</p>
        </div>
      ) : null}
    </section>
  );
}
