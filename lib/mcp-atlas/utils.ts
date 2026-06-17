/**
 * Shared utilities for Atlas MCP tools.
 */

/**
 * Compute UTC bounds for a trading day in America/New_York timezone.
 *
 * Handles DST automatically — sniffs the actual NY offset on the given date
 * (UTC-5 in EST, UTC-4 in EDT) so a trade executed at 23:30 ET on day N is
 * correctly bucketed into day N regardless of the season.
 *
 * @param dateStr ISO date YYYY-MM-DD representing a NY trading day
 * @returns ISO timestamps for [dayStart, dayEnd) — inclusive start, exclusive end
 */
export function getNyTradingDayBounds(dateStr: string): {
  dayStart: string;
  dayEnd: string;
} {
  // Probe NY offset for this date by looking at noon UTC and reading NY hour.
  // Noon UTC = 7am NY in EST (UTC-5), 8am NY in EDT (UTC-4).
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(probe);
  const nyHourAtNoonUtc = parseInt(parts.find((p) => p.type === "hour")?.value ?? "12", 10);
  const offsetHours = 12 - nyHourAtNoonUtc;
  const offsetStr = `-${String(offsetHours).padStart(2, "0")}:00`;

  const dayStart = new Date(`${dateStr}T00:00:00${offsetStr}`).toISOString();
  const dayEndDate = new Date(`${dateStr}T00:00:00${offsetStr}`);
  dayEndDate.setUTCDate(dayEndDate.getUTCDate() + 1);
  const dayEnd = dayEndDate.toISOString();

  return { dayStart, dayEnd };
}

/**
 * Get today's trading date in America/New_York timezone as ISO YYYY-MM-DD.
 */
export function getNyTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
