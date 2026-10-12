import type { ReactNode } from "react";

/**
 * Трака при дну екрана: једно питање по екрану, а навигација увек на истом
 * месту, где је палац. Висина сваког дугмета је бар 44px, а натписи су кратки
 * и не преламају се ни на 320px.
 */
export function BottomBar({
  progress,
  onPrev,
  onNext,
  children,
}: {
  progress: { current: number; total: number; note?: string };
  onPrev?: () => void;
  onNext?: () => void;
  children: ReactNode;
}) {
  const percent = Math.round((progress.current / Math.max(progress.total, 1)) * 100);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-2xl px-3 pt-2 pb-2">
        <div className="mb-2 flex items-center justify-between text-sm text-muted">
          <span>
            {progress.current} / {progress.total}
          </span>
          {progress.note ? <span>{progress.note}</span> : null}
        </div>
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost w-11 px-0 text-xl" onClick={onPrev} disabled={!onPrev} aria-label="Претходни задатак">
            ←
          </button>
          <div className="flex min-w-0 flex-1 gap-2">{children}</div>
          <button type="button" className="btn btn-ghost w-11 px-0 text-xl" onClick={onNext} disabled={!onNext} aria-label="Следећи задатак">
            →
          </button>
        </div>
      </div>
    </nav>
  );
}
