/**
 * Sprint 053.2 — A/B harness pure-helper tests.
 *
 * The DB-bound runAbForwardTest is covered by the smoke test; here we
 * exercise the pure pieces that determine the forward window and the
 * stats delta — the math that the academic audit will be reading.
 */

import {
  addDays,
  computeForwardWindow,
  statsDelta,
  DEFAULT_FORWARD_DAYS,
  MIN_BARS_TO_RUN,
} from "@/lib/strategies/ab-harness";
import type { SimulatedStats } from "@/lib/backtest-ticket/simulate";

const baseStats: SimulatedStats = {
  total_bars: 100,
  total_trades: 0,
  winning_trades: 0,
  losing_trades: 0,
  win_rate: null,
  total_pnl_dollars: 0,
  avg_pnl_dollars: null,
  max_drawdown_dollars: 0,
  total_friction_dollars: 0,
  total_pnl_points: 0,
  avg_pnl_points: null,
};

describe("Sprint 053.2 — A/B harness pure helpers", () => {
  describe("addDays", () => {
    it("adds positive days across month boundary", () => {
      expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
    });
    it("subtracts via negative offset", () => {
      expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    });
    it("handles year boundary", () => {
      expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    });
  });

  describe("computeForwardWindow", () => {
    it("returns a 14-day window starting day after original end", () => {
      const r = computeForwardWindow("2026-06-01", "2026-07-15", DEFAULT_FORWARD_DAYS);
      expect(r.window.start_date).toBe("2026-06-02");
      expect(r.window.end_date).toBe("2026-06-15");
      expect(r.window.days_requested).toBe(DEFAULT_FORWARD_DAYS);
      expect(r.hasWindow).toBe(true);
    });

    it("caps end at yesterday when forwardDays would overshoot today", () => {
      // Original ended yesterday → 1-day window of "yesterday" only? No —
      // start = today, but we cap to yesterday → end < start.
      const r = computeForwardWindow("2026-06-21", "2026-06-22", 14);
      expect(r.window.start_date).toBe("2026-06-22"); // day after original end
      expect(r.window.end_date).toBe("2026-06-21"); // yesterday
      expect(r.hasWindow).toBe(false);
    });

    it("when backtest ends well in the past, gives full window", () => {
      const r = computeForwardWindow("2026-01-01", "2026-06-22", 14);
      expect(r.window.start_date).toBe("2026-01-02");
      expect(r.window.end_date).toBe("2026-01-15");
      expect(r.hasWindow).toBe(true);
    });

    it("hasWindow=false when backtest ran through today", () => {
      const r = computeForwardWindow("2026-06-22", "2026-06-22", 14);
      expect(r.hasWindow).toBe(false);
    });
  });

  describe("statsDelta", () => {
    it("subtracts treatment minus control for each metric", () => {
      const control: SimulatedStats = {
        ...baseStats,
        total_trades: 10,
        winning_trades: 4,
        losing_trades: 6,
        win_rate: 0.4,
        total_pnl_dollars: -50,
        avg_pnl_dollars: -5,
        max_drawdown_dollars: 80,
      };
      const treatment: SimulatedStats = {
        ...baseStats,
        total_trades: 10,
        winning_trades: 7,
        losing_trades: 3,
        win_rate: 0.7,
        total_pnl_dollars: 120,
        avg_pnl_dollars: 12,
        max_drawdown_dollars: 30,
      };
      const d = statsDelta(control, treatment);
      expect(d.total_trades).toBe(0);
      expect(d.winning_trades).toBe(3);
      expect(d.losing_trades).toBe(-3);
      expect(d.win_rate).toBeCloseTo(0.3, 4);
      expect(d.total_pnl_dollars).toBe(170);
      expect(d.avg_pnl_dollars).toBe(17);
      expect(d.max_drawdown_dollars).toBe(-50);
    });

    it("returns null win_rate / avg when either side is null", () => {
      const empty: SimulatedStats = { ...baseStats };
      const d = statsDelta(empty, empty);
      expect(d.win_rate).toBeNull();
      expect(d.avg_pnl_dollars).toBeNull();
      expect(d.total_trades).toBe(0);
    });

    it("rounds dollar deltas to cents", () => {
      const control: SimulatedStats = { ...baseStats, total_pnl_dollars: 10.123 };
      const treatment: SimulatedStats = { ...baseStats, total_pnl_dollars: 20.456 };
      const d = statsDelta(control, treatment);
      // 20.456 - 10.123 = 10.333 → 10.33
      expect(d.total_pnl_dollars).toBe(10.33);
    });
  });

  it("constants are sensible", () => {
    expect(DEFAULT_FORWARD_DAYS).toBe(14);
    expect(MIN_BARS_TO_RUN).toBe(30);
  });
});
