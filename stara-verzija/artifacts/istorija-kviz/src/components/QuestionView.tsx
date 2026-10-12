import { useMemo } from "react";
import type { DataTable, Question, Revealed, TableCell } from "@/lib/api";

/**
 * Приказ једног задатка.
 *
 * Изглед намерно прати збирку: одговори стоје иза празних кружића које ученик
 * „боји“, повезивање је табела са кружићима у пољима, а подвлачење се ради
 * кружићима испод речи. Раније су то била дугмад са оквирима; ученик који
 * вежба из књиге и решава овде видео је два различита задатка, па је морао да
 * преводи једно у друго уместо да ради.
 *
 * Иста компонента ради и док се решава и у прегледу решења; разлика је у томе
 * што у прегледу стиже `reveal`. Клијент нигде не одлучује шта је тачно —
 * `correct` долази са сервера.
 */

type Props = {
  index: number;
  question: Question;
  answer: string;
  onChange: (value: string) => void;
  reveal?: Revealed;
  correct?: boolean;
  earnedPoints?: number;
  /** Сопствена оцена за задатке писања; null док ученик не одлучи. */
  selfMark?: boolean | null;
  onSelfMark?: (correct: boolean) => void;
};

const parse = (answer: string) =>
  answer
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map(Number);

/**
 * Код `pick` задатака жетони већ исписују цео текст, па би одломак изнад њих
 * приказао исту реченицу двапут — ученик тражи где је разлика, а разлике нема.
 * Одломак остаје само кад носи нешто чега у жетонима нема (увод, наслов).
 */
function showPassage(question: Question): boolean {
  if (!question.passage) return false;
  if (question.type !== "pick") return true;
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  return flat(question.tokens?.join(" ") ?? "") !== flat(question.passage);
}

type CircleState = "empty" | "filled" | "correct" | "wrong";

/** Кружић какав стоји у збирци: празан обод који се боји. */
function Circle({ state, size = 16 }: { state: CircleState; size?: number }) {
  const cls =
    state === "correct"
      ? "border-emerald-500 bg-emerald-500"
      : state === "wrong"
        ? "border-rose-500 bg-rose-500"
        : state === "filled"
          ? "border-foreground bg-foreground"
          : "border-muted-foreground/70";

  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 rounded-full border-2 ${cls}`}
    />
  );
}

/** Стање кружића: пре предаје прати избор, после предаје тачност. */
function circleState(chosen: boolean, isCorrect: boolean, locked: boolean): CircleState {
  if (!locked) return chosen ? "filled" : "empty";
  if (isCorrect) return "correct";
  if (chosen) return "wrong";
  return "empty";
}

export function QuestionView({
  index,
  question,
  answer,
  onChange,
  reveal,
  correct,
  earnedPoints,
  selfMark,
  onSelfMark,
}: Props) {
  const locked = reveal !== undefined;
  const selected = useMemo(() => parse(answer), [answer]);

  // Задатке писања сервер не бодује, па исход прати сопствену оцену.
  const outcome = question.scored ? correct : (selfMark ?? undefined);

  return (
    <article className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <header className="mb-4 flex items-start gap-3">
        <span className="text-lg font-semibold tabular-nums">{index}.</span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-line text-[15px] leading-relaxed">{question.question}</p>
          {question.hint ? (
            <p className="mt-1 text-sm text-muted-foreground">{question.hint}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          {earnedPoints !== undefined
            ? `${earnedPoints}/${question.points}`
            : locked && outcome !== undefined
              ? `${outcome ? question.points : 0}/${question.points}`
              : `${question.points} поен${question.points === 1 ? "" : "а"}`}
        </span>
      </header>

      {/*
        Карте и фотографије се на телефону смање, а натписи на карти су ситни;
        додир отвара слику у пуној величини, где може да се увећа прстима.
      */}
      {question.image ? (
        <a
          href={`${import.meta.env.BASE_URL}images/${question.image}`}
          target="_blank"
          rel="noreferrer"
          className="mb-4 block"
        >
          <img
            src={`${import.meta.env.BASE_URL}images/${question.image}`}
            alt="Прилог уз задатак"
            className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg border border-border bg-white"
          />
          <span className="mt-1 block text-center text-xs text-muted-foreground">
            додирни слику за увећање
          </span>
        </a>
      ) : null}

      {question.table ? <DataTableView table={question.table} /> : null}

      {showPassage(question) ? (
        <blockquote className="mb-4 whitespace-pre-line border-l-2 border-border pl-4 text-[15px] leading-relaxed">
          {question.passage}
        </blockquote>
      ) : null}

      {question.source ? (
        <p className="mb-4 text-right text-sm italic text-muted-foreground">
          ({question.source})
        </p>
      ) : null}

      <Body
        question={question}
        answer={answer}
        selected={selected}
        onChange={onChange}
        locked={locked}
        reveal={reveal}
      />

      {reveal ? (
        <Reveal
          question={question}
          reveal={reveal}
          selfMark={selfMark}
          onSelfMark={onSelfMark}
        />
      ) : null}
    </article>
  );
}

/** Табела уз задатак, са спојеним ћелијама као у збирци. */
function DataTableView({ table }: { table: DataTable }) {
  const cell = (c: TableCell) =>
    typeof c === "string" ? { text: c, rowSpan: undefined, colSpan: undefined } : c;

  return (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        {table.caption ? (
          <caption className="border border-b-0 border-border px-3 py-2 font-semibold">
            {table.caption}
          </caption>
        ) : null}
        <thead>
          <tr>
            {table.head.map((raw, j) => {
              const c = cell(raw);
              return (
                <th
                  key={j}
                  rowSpan={c.rowSpan}
                  colSpan={c.colSpan}
                  className="border border-border bg-muted/40 px-3 py-2 font-semibold"
                >
                  {c.text}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((raw, j) => {
                const c = cell(raw);
                return (
                  <td
                    key={j}
                    rowSpan={c.rowSpan}
                    colSpan={c.colSpan}
                    className="border border-border px-3 py-2 text-center tabular-nums"
                  >
                    {c.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Body({
  question,
  answer,
  selected,
  onChange,
  locked,
  reveal,
}: {
  question: Question;
  answer: string;
  selected: number[];
  onChange: (v: string) => void;
  locked: boolean;
  reveal?: Revealed;
}) {
  switch (question.type) {
    // ── Обој кружић испред тачног одговора ────────────────────────────────
    case "single":
    case "multi": {
      const multi = question.type === "multi";

      const toggle = (i: number, chosen: boolean) => {
        if (multi) {
          const next = chosen
            ? selected.filter((v) => v !== i)
            : [...selected, i].sort((a, b) => a - b);
          onChange(next.join(","));
        } else {
          onChange(String(i));
        }
      };

      // Понуђени одговори су слике — у збирци „обој кружић испод оног који…“.
      // Кружић иде испод слике, као у књизи.
      if (question.optionImages) {
        const images = question.optionImages;
        return (
          <div className="grid grid-cols-2 gap-4">
            {(question.options ?? []).map((label, i) => {
              const chosen = multi ? selected.includes(i) : selected[0] === i;
              const isCorrect = multi
                ? (reveal?.correctAnswers?.includes(i) ?? false)
                : reveal?.correctAnswer === i;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={locked}
                  onClick={() => toggle(i, chosen)}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-2 disabled:cursor-default ${
                    chosen && !locked ? "border-foreground" : "border-border"
                  }`}
                >
                  <img
                    src={`${import.meta.env.BASE_URL}images/${images[i]}`}
                    alt={label}
                    className="h-40 w-full rounded bg-white object-contain sm:h-52"
                  />
                  <span className="flex items-center gap-2 text-sm">
                    <Circle state={circleState(chosen, isCorrect, locked)} />
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        );
      }

      return (
        <ul className="space-y-2.5">
          {(question.options ?? []).map((option, i) => {
            const chosen = multi ? selected.includes(i) : selected[0] === i;
            const isCorrect = multi
              ? (reveal?.correctAnswers?.includes(i) ?? false)
              : reveal?.correctAnswer === i;
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => toggle(i, chosen)}
                  className="flex w-full items-start gap-3 text-left text-[15px] leading-relaxed disabled:cursor-default"
                >
                  <span className="mt-[3px]">
                    <Circle state={circleState(chosen, isCorrect, locked)} />
                  </span>
                  <span className="whitespace-pre-line">{option}</span>
                </button>
              </li>
            );
          })}
        </ul>
      );
    }

    // ── Допуни ────────────────────────────────────────────────────────────
    case "fill": {
      const parts = answer.split("|");
      return (
        <div className="space-y-3">
          {(question.fields ?? []).map((field, i) => (
            <label key={i} className="flex flex-wrap items-baseline gap-2">
              {/* Натпис који је већ питање („Која држава…?“) или редни број
                  („1.“) не добија још и двотачку. */}
              <span className="text-[15px]">
                {/[.:?]$/.test(field.label) ? field.label : `${field.label}:`}
              </span>
              <input
                type="text"
                disabled={locked}
                value={parts[i] ?? ""}
                onChange={(e) => {
                  const next = [...parts];
                  while (next.length < (question.fields?.length ?? 0)) next.push("");
                  next[i] = e.target.value;
                  onChange(next.join("|"));
                }}
                className="min-w-[12rem] flex-1 border-0 border-b border-muted-foreground/60 bg-transparent px-1 py-0.5 text-[15px] outline-none focus:border-foreground disabled:opacity-70"
              />
            </label>
          ))}
        </div>
      );
    }

    // ── Повежи: табела са кружићима, као у збирци ─────────────────────────
    case "match": {
      const right = question.rightItems ?? [];
      const left = question.leftItems ?? [];

      // Табела се цртa док год их збирка црта — а њена најшира има шест колона
      // (нпр. задатак 336: субјекат, апозиција, прави и неправи објекат, две
      // прилошке одредбе). Преко тога збирка прелази на листу, па и овде.
      // Ужи екрани табелу хоризонтално скролују, што је боље него да ученик
      // исти задатак види другачије него у књизи.
      if (right.length > 6) {
        return (
          <div className="space-y-2">
            {left.map((item, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="flex-1 whitespace-pre-line text-[15px] leading-relaxed">
                  {item}
                </span>
                <select
                  disabled={locked}
                  value={
                    selected[i] === undefined || Number.isNaN(selected[i])
                      ? ""
                      : String(selected[i])
                  }
                  onChange={(e) => {
                    const next = [...selected];
                    while (next.length < left.length) next.push(-1);
                    next[i] = Number(e.target.value);
                    onChange(next.join(","));
                  }}
                  className={`rounded-lg border bg-background px-2 py-1.5 text-sm outline-none sm:w-72 ${
                    locked && reveal?.correctPairs
                      ? reveal.correctPairs[i] === selected[i]
                        ? "border-emerald-500"
                        : "border-rose-500"
                      : "border-border focus:border-foreground"
                  }`}
                >
                  <option value="">— изабери —</option>
                  {right.map((option, j) => (
                    <option key={j} value={j}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {question.extraRight ? (
              <p className="text-sm text-muted-foreground">
                Једна ставка из десне колоне је вишак.
              </p>
            ) : null}
          </div>
        );
      }

      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[15px]">
            <thead>
              <tr className="text-sm">
                <th className="border border-border px-3 py-2 text-left font-medium" />
                {right.map((option, j) => (
                  <th key={j} className="border border-border px-3 py-2 font-medium">
                    {option}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {left.map((item, i) => (
                <tr key={i}>
                  <td className="border border-border px-3 py-2 leading-relaxed">{item}</td>
                  {right.map((_, j) => {
                    const chosen = selected[i] === j;
                    const isCorrect = reveal?.correctPairs?.[i] === j;
                    return (
                      <td key={j} className="border border-border px-3 py-2 text-center">
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => {
                            const next = [...selected];
                            while (next.length < left.length) next.push(-1);
                            next[i] = j;
                            onChange(next.join(","));
                          }}
                          className="disabled:cursor-default"
                          aria-label={right[j]}
                        >
                          <Circle state={circleState(chosen, isCorrect, locked)} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {question.extraRight ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Једна ставка је вишак.
            </p>
          ) : null}
        </div>
      );
    }

    // ── Поређај ───────────────────────────────────────────────────────────
    case "order": {
      const items = question.items ?? [];
      return (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <select
                disabled={locked}
                value={
                  selected[i] === undefined || Number.isNaN(selected[i])
                    ? ""
                    : String(selected[i])
                }
                onChange={(e) => {
                  const next = [...selected];
                  while (next.length < items.length) next.push(-1);
                  next[i] = Number(e.target.value);
                  onChange(next.join(","));
                }}
                className={`w-16 rounded-md border bg-background px-2 py-1 text-center text-sm outline-none ${
                  locked && reveal?.correctOrder
                    ? reveal.correctOrder[i] === selected[i]
                      ? "border-emerald-500"
                      : "border-rose-500"
                    : "border-muted-foreground/60 focus:border-foreground"
                }`}
              >
                <option value="">—</option>
                {items.map((_, j) => (
                  <option key={j} value={j + 1}>
                    {j + 1}
                  </option>
                ))}
              </select>
              <span className="flex-1 whitespace-pre-line text-[15px] leading-relaxed">
                {item}
              </span>
            </div>
          ))}
        </div>
      );
    }

    // ── Тачно / нетачно ───────────────────────────────────────────────────
    case "tf": {
      const values = answer.split(",").map((v) => v.trim().toUpperCase());
      const trueLabel = question.trueLabel ?? "Тачно";
      const falseLabel = question.falseLabel ?? "Нетачно";
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[15px]">
            <thead>
              <tr className="text-sm">
                <th className="border border-border px-3 py-2 text-left font-medium">
                  Тврдња
                </th>
                <th className="w-28 border border-border px-2 py-2 font-medium">
                  {trueLabel}
                </th>
                <th className="w-28 border border-border px-2 py-2 font-medium">
                  {falseLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {(question.statements ?? []).map((statement, i) => {
                const expected = reveal?.correct?.[i];
                return (
                  <tr key={i}>
                    <td className="border border-border px-3 py-2 leading-relaxed">
                      {statement}
                    </td>
                    {(["T", "N"] as const).map((flag) => {
                      const chosen = values[i] === flag;
                      const isCorrect =
                        expected !== undefined && (flag === "T") === expected;
                      return (
                        <td key={flag} className="border border-border px-2 py-2 text-center">
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => {
                              const next = [...values];
                              while (next.length < (question.statements?.length ?? 0))
                                next.push("");
                              next[i] = flag;
                              onChange(next.join(","));
                            }}
                            className="disabled:cursor-default"
                            aria-label={flag === "T" ? trueLabel : falseLabel}
                          >
                            <Circle state={circleState(chosen, isCorrect, locked)} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    // ── Подвуци / обој кружиће испод речи ─────────────────────────────────
    case "pick": {
      const tokens = question.tokens ?? [];
      // Реченице и стихови иду један испод другог; речи и гласови теку у реду,
      // као у књизи. Само дужина најдужег жетона није довољан знак: десетерац
      // има двадесетак знакова, па би низ стихова текао као да су речи и ученик
      // не би видео где се стих завршава. Зато и просек.
      const avg = tokens.length
        ? tokens.reduce((sum, t) => sum + t.length, 0) / tokens.length
        : 0;
      const asLines = tokens.some((t) => t.length > 40) || avg > 15;

      return (
        <div>
          <p className="mb-3 text-sm text-muted-foreground">
            Обој кружић испод дела текста који означаваш.
          </p>
          <div className={asLines ? "space-y-2" : "flex flex-wrap items-end gap-x-3 gap-y-3"}>
            {tokens.map((token, i) => {
              const chosen = selected.includes(i);
              const isCorrect = reveal?.correctTokens?.includes(i) ?? false;
              const state = circleState(chosen, isCorrect, locked);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    const next = chosen
                      ? selected.filter((v) => v !== i)
                      : [...selected, i].sort((a, b) => a - b);
                    onChange(next.join(","));
                  }}
                  className={`flex ${
                    asLines ? "w-full flex-row items-start gap-3" : "flex-col items-center gap-1"
                  } text-left disabled:cursor-default`}
                >
                  {asLines ? <span className="mt-[3px]"><Circle state={state} /></span> : null}
                  <span
                    className={`text-[15px] leading-relaxed ${
                      chosen ? "underline decoration-2 underline-offset-4" : ""
                    }`}
                  >
                    {token}
                  </span>
                  {asLines ? null : <Circle state={state} size={13} />}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    // ── Слободан одговор ──────────────────────────────────────────────────
    case "open":
      return (
        <textarea
          disabled={locked}
          value={answer}
          onChange={(e) => onChange(e.target.value)}
          rows={question.lines ?? 5}
          placeholder="Овде напиши свој одговор."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] leading-relaxed outline-none focus:border-foreground disabled:opacity-70"
        />
      );

    default:
      return null;
  }
}

function Reveal({
  question,
  reveal,
  selfMark,
  onSelfMark,
}: {
  question: Question;
  reveal: Revealed;
  selfMark?: boolean | null;
  onSelfMark?: (correct: boolean) => void;
}) {
  return (
    <div className="mt-5 space-y-3 rounded-lg bg-muted/40 px-4 py-3 text-[15px] leading-relaxed">
      {question.type === "fill" && reveal.correctFields ? (
        <div>
          <p className="mb-1 text-sm font-medium text-muted-foreground">Тачан одговор</p>
          <ul className="list-inside list-disc">
            {reveal.correctFields.map((variants, i) => (
              <li key={i}>
                {question.fields?.[i]?.label ? `${question.fields[i]!.label}: ` : ""}
                {variants.join(" / ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {question.type === "open" ? (
        <div className="space-y-2">
          <div>
            <p className="mb-1 text-sm font-medium text-emerald-400">Прихватљив одговор</p>
            <p className="whitespace-pre-line">{reveal.acceptable}</p>
          </div>
          {reveal.unacceptable ? (
            <div>
              <p className="mb-1 text-sm font-medium text-rose-400">Неприхватљив одговор</p>
              <p className="whitespace-pre-line">{reveal.unacceptable}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-sm font-medium text-muted-foreground">Објашњење</p>
        <p className="whitespace-pre-line">{reveal.explanation}</p>
      </div>

      {/*
        Задатке слободног одговора сервер не бодује — не постоји начин да машина
        процени да ли је образложење прихватљиво. Уместо да остану без поена,
        ученик их сам оцењује поредећи свој одговор са моделом изнад.
      */}
      {!question.scored && onSelfMark ? (
        <div className="border-t border-border/60 pt-3">
          <p className="mb-2 text-sm text-muted-foreground">
            Упореди свој одговор са моделом и сам процени:
          </p>
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => onSelfMark(true)}
              className="flex items-center gap-2 text-sm"
            >
              <Circle state={selfMark === true ? "correct" : "empty"} />
              Одговорио сам тачно
            </button>
            <button
              type="button"
              onClick={() => onSelfMark(false)}
              className="flex items-center gap-2 text-sm"
            >
              <Circle state={selfMark === false ? "wrong" : "empty"} />
              Нисам
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
