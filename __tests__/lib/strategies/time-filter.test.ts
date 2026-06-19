/**
 * Sprint 069 — session_window + valid_weekdays filter tests.
 */

import { isBarInSession, describeWeekdays, describeSessionWindow } from "@/lib/strategies/time-filter";
import type { TicketLogicBody } from "@/lib/strategies/types";

function baseBody(extra: Partial<TicketLogicBody> = {}): TicketLogicBody {
  return {
    universe: { asset_class: "any" },
    timeframe: "5m",
    direction: "long",
    indicators: [{ id: "ema", type: "ema", params: { period: 13 } }],
    entry: {
      conditions: [
        {
          op: "gt",
          left: { type: "ohlc", field: "close", bar_offset: 0 },
          right: { type: "ohlc", field: "open", bar_offset: 0 },
        },
      ],
      sizing: { method: "fixed_notional", value: 100 },
    },
    exit: {
      take_profit: { type: "constant", value: 1 },
      stop_loss: { type: "constant", value: 0 },
    },
    ...extra,
  };
}

describe("isBarInSession", () => {
  it("returns true when neither filter is set", () => {
    const body = baseBody();
    expect(isBarInSession({ timestamp: "2026-06-18T14:00:00Z" }, body)).toBe(true);
  });

  it("returns true when bar has no timestamp (defensive)", () => {
    const body = baseBody({
      session_window: { start: "09:31", end: "11:00", timezone: "America/New_York" },
    });
    expect(isBarInSession({}, body)).toBe(true);
  });

  describe("session_window", () => {
    const body = baseBody({
      session_window: { start: "09:31", end: "11:00", timezone: "America/New_York" },
    });

    it("allows a bar inside the window", () => {
      // 2026-06-18 10:00 ET = 14:00 UTC (EDT, UTC-4)
      expect(isBarInSession({ timestamp: "2026-06-18T14:00:00Z" }, body)).toBe(true);
    });

    it("blocks a bar before the window", () => {
      // 09:30 ET = 13:30 UTC
      expect(isBarInSession({ timestamp: "2026-06-18T13:30:00Z" }, body)).toBe(false);
    });

    it("blocks a bar at the end (exclusive)", () => {
      // 11:00 ET = 15:00 UTC
      expect(isBarInSession({ timestamp: "2026-06-18T15:00:00Z" }, body)).toBe(false);
    });

    it("allows the very start (inclusive)", () => {
      // 09:31 ET = 13:31 UTC
      expect(isBarInSession({ timestamp: "2026-06-18T13:31:00Z" }, body)).toBe(true);
    });

    it("blocks an after-hours bar", () => {
      // 18:00 ET = 22:00 UTC
      expect(isBarInSession({ timestamp: "2026-06-18T22:00:00Z" }, body)).toBe(false);
    });
  });

  describe("valid_weekdays", () => {
    const weekdaysBody = baseBody({
      session_window: { start: "00:00", end: "23:59", timezone: "America/New_York" },
      valid_weekdays: [1, 2, 3, 4, 5], // Mon–Fri
    });

    it("allows a Thursday", () => {
      // 2026-06-18 is a Thursday
      expect(isBarInSession({ timestamp: "2026-06-18T14:00:00Z" }, weekdaysBody)).toBe(true);
    });

    it("blocks a Sunday", () => {
      // 2026-06-21 is a Sunday
      expect(isBarInSession({ timestamp: "2026-06-21T14:00:00Z" }, weekdaysBody)).toBe(false);
    });
  });

  describe("invalid configurations", () => {
    it("treats an unknown timezone as no-op (returns true)", () => {
      const body = baseBody({
        session_window: { start: "09:00", end: "11:00", timezone: "Nowhere/Mars" },
      });
      expect(isBarInSession({ timestamp: "2026-06-18T14:00:00Z" }, body)).toBe(true);
    });

    it("treats a backwards window as no-op", () => {
      const body = baseBody({
        session_window: { start: "11:00", end: "09:00", timezone: "America/New_York" },
      });
      expect(isBarInSession({ timestamp: "2026-06-18T14:00:00Z" }, body)).toBe(true);
    });
  });
});

describe("describeWeekdays", () => {
  it("formats Mon–Fri as a range", () => {
    expect(describeWeekdays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
  });

  it("formats every day", () => {
    expect(describeWeekdays([1, 2, 3, 4, 5, 6, 7])).toBe("every day");
  });

  it("formats arbitrary lists", () => {
    expect(describeWeekdays([2, 4])).toBe("Tue, Thu");
  });
});

describe("describeSessionWindow", () => {
  it("formats start–end timezone", () => {
    expect(
      describeSessionWindow({ start: "09:31", end: "11:00", timezone: "America/New_York" }),
    ).toBe("09:31–11:00 America/New_York");
  });
});
