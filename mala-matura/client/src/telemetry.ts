import { TOKEN_KEY } from "./api";

/**
 * Телеметрија за истраживање: шта је ученик радио на екрану — приказ задатка,
 * измена одговора, провера, одлазак из апликације и повратак.
 *
 * Догађаји се скупљају и шаљу у пакетима (на 15 секунди и кад апликација оде
 * у позадину), да се телефон не буди захтевом за сваки додир. Губитак неког
 * пакета не квари рад — телеметрија никад не блокира ученика.
 */

type Event = { attemptId: number; questionId?: number | null; type: string; at: string; value?: unknown };

const queue: Event[] = [];
let current: { attemptId: number; questionId: number | null } | null = null;

export function setTelemetryContext(attemptId: number | null, questionId: number | null = null) {
  current = attemptId === null ? null : { attemptId, questionId };
}

export function track(type: string, value?: unknown) {
  if (!current) return;
  queue.push({ attemptId: current.attemptId, questionId: current.questionId, type, at: new Date().toISOString(), value });
  if (queue.length >= 40) flush();
}

export function flush() {
  if (queue.length === 0) return;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    queue.length = 0;
    return;
  }
  const batch = queue.splice(0, queue.length);
  // `keepalive` пушта захтев да се заврши и кад се страница затвара.
  fetch("/api/telemetry", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ events: batch }),
  }).catch(() => undefined);
}

let started = false;
export function startTelemetry() {
  if (started) return;
  started = true;
  window.setInterval(flush, 15_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      track("hide");
      flush();
    } else {
      track("show");
    }
  });
}
