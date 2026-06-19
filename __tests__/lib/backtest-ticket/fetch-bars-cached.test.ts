/**
 * Sprint 072 — pure helpers from fetch-bars-cached.
 *
 * We don't unit-test the full fetchHistoricalBarsCached() function here —
 * it has Supabase + Yahoo I/O baked in. The helpers it relies on (date
 * enumeration, NY bucketing) are the interesting algorithmic pieces and
 * are verified here. Integration smoke test happens in production by
 * watching the cache table fill up.
 */

import { enumerateDays, nyDateKey } from "@/lib/backtest-ticket/fetch-bars-cached-helpers";

describe("enumerateDays", () => {
  it("returns each day in [start, end] inclusive", () => {
    const start = new Date("2026-06-15T00:00:00Z");
    const end = new Date("2026-06-18T00:00:00Z");
    expect(enumerateDays(start, end)).toEqual([
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
    ]);
  });

  it("returns a single day when start == end", () => {
    const d = new Date("2026-06-18T12:00:00Z");
    expect(enumerateDays(d, d)).toEqual(["2026-06-18"]);
  });

  it("handles month boundaries", () => {
    const start = new Date("2026-05-30T00:00:00Z");
    const end = new Date("2026-06-02T00:00:00Z");
    expect(enumerateDays(start, end)).toEqual([
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    ]);
  });
});

describe("nyDateKey", () => {
  it("buckets a 14:00 UTC timestamp into the same NY calendar day", () => {
    // 2026-06-18 14:00 UTC = 10:00 ET (EDT) → still 2026-06-18 in NY
    expect(nyDateKey("2026-06-18T14:00:00Z")).toBe("2026-06-18");
  });

  it("buckets a 03:00 UTC timestamp into the PREVIOUS NY day", () => {
    // 2026-06-19 03:00 UTC = 2026-06-18 23:00 ET → 2026-06-18 in NY
    expect(nyDateKey("2026-06-19T03:00:00Z")).toBe("2026-06-18");
  });

  it("buckets midnight ET correctly across the date line", () => {
    // 2026-06-19 04:00 UTC = 2026-06-19 00:00 ET → 2026-06-19 in NY
    expect(nyDateKey("2026-06-19T04:00:00Z")).toBe("2026-06-19");
  });
});
