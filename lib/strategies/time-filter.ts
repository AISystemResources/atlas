/**
 * Time-of-day + day-of-week filter for Ticket Logic — Sprint 069.
 *
 * The evaluator calls isBarInSession(bar, body) before any condition check.
 * When the strategy declares session_window or valid_weekdays, the filter
 * enforces them per-bar; when both are omitted, the filter is a no-op.
 *
 * Timezone semantics: bar.timestamp is parsed as ISO. The hh:mm and ISO
 * weekday are projected into the body.session_window.timezone via
 * Intl.DateTimeFormat. This way a strategy authored as "09:31–11:00 ET"
 * doesn't drift when bars arrive in UTC or when DST flips.
 *
 * Defensive fallbacks:
 *   - No timestamp on the bar → return true (don't filter bars that lack
 *     time info; warmup data and synthetic test fixtures often do).
 *   - Invalid timezone → return true (skip filter rather than throw —
 *     keep the evaluator pure).
 */

import type { SessionWindow, TicketLogicBody } from "./types";

interface BarLike {
  timestamp?: string;
}

export function isBarInSession(bar: BarLike, body: TicketLogicBody): boolean {
  if (!body.session_window && !body.valid_weekdays) return true;
  if (!bar.timestamp) return true;

  const d = new Date(bar.timestamp);
  if (Number.isNaN(d.getTime())) return true;

  const tz = body.session_window?.timezone ?? "UTC";

  // Weekday check — uses the body.session_window.timezone if present, else
  // local. The intent is "is it Monday where the strategy thinks it is".
  if (body.valid_weekdays && body.valid_weekdays.length > 0) {
    const weekday = isoWeekdayInTimezone(d, tz);
    if (weekday === null || !body.valid_weekdays.includes(weekday)) return false;
  }

  if (body.session_window) {
    const minute = minuteOfDayInTimezone(d, body.session_window.timezone);
    if (minute === null) return true; // formatter failed; don't filter
    const start = parseHHMM(body.session_window.start);
    const end = parseHHMM(body.session_window.end);
    if (start === null || end === null) return true;

    // start is inclusive, end is exclusive. Wraparound windows (e.g.
    // 22:00–02:00) are not supported in v1 — almost no Atlas strategy
    // needs them, and they invite ambiguity in the backtest.
    if (start <= end) {
      if (minute < start || minute >= end) return false;
    } else {
      // declared backwards; treat as no-op rather than firing always-false
      return true;
    }
  }

  return true;
}

function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minuteOfDayInTimezone(d: Date, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    // Intl returns "24" for midnight in some hour12=false implementations.
    return (h === 24 ? 0 : h) * 60 + m;
  } catch {
    return null;
  }
}

function isoWeekdayInTimezone(d: Date, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    }).formatToParts(d);
    const wd = parts.find((p) => p.type === "weekday")?.value;
    const map: Record<string, number> = {
      Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
    };
    return wd ? (map[wd] ?? null) : null;
  } catch {
    return null;
  }
}

// Exported for the renderer + tests
export function describeSessionWindow(sw: SessionWindow): string {
  return `${sw.start}–${sw.end} ${sw.timezone}`;
}

export function describeWeekdays(days: number[]): string {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) {
    return "Mon–Fri";
  }
  if (sorted.length === 7) return "every day";
  return sorted.map((d) => names[d - 1] ?? `?${d}`).join(", ");
}
