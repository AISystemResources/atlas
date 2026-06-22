/**
 * Sprint 079C.3 — quantitative forensics computed for the Llama prompt.
 *
 * Locks down the R:R math and the exit-reason breakdown that the prompt
 * is built around. If forensics drifts wrong, the whole "force the LLM
 * to reason from R:R" argument collapses.
 */

import { computeForensics } from "@/lib/strategies/review-backtest";

type Trade = {
  id: string;
  entry_ts: string;
  exit_ts: string | null;
  exit_reason: string | null;
  pnl_dollars: number | null;
  pnl_pct: number | null;
  review_summary?: { skill_or_luck: string; rationale: string };
};

function mkTrade(pnl: number | null, exit_reason: string | null = "tp_hit"): Trade {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    entry_ts: "2026-01-01T10:00:00Z",
    exit_ts: "2026-01-01T11:00:00Z",
    exit_reason,
    pnl_dollars: pnl,
    pnl_pct: null,
  };
}

describe("Sprint 079C.3 — computeForensics", () => {
  it("handles all wins", () => {
    const f = computeForensics([mkTrade(10), mkTrade(20), mkTrade(30)]);
    expect(f.wins).toBe(3);
    expect(f.losses).toBe(0);
    expect(f.win_rate_pct).toBe(100);
    expect(f.avg_win_dollars).toBe(20);
    expect(f.avg_loss_dollars).toBeNull();
    expect(f.rr_ratio).toBeNull(); // no avg_loss to divide by
    expect(f.profit_factor).toBeNull(); // no sumAbsLosses
  });

  it("handles the inverted-RR pattern that motivated this sprint", () => {
    // 55% win rate with avg_win=$0.10 and avg_loss=$0.23 — the smoke
    // test's actual failure mode that the prompt now forces Llama to see.
    const trades: Trade[] = [];
    for (let i = 0; i < 11; i++) trades.push(mkTrade(0.1)); // 11 wins
    for (let i = 0; i < 9; i++) trades.push(mkTrade(-0.23, "sl_hit")); // 9 losses
    const f = computeForensics(trades);
    expect(f.wins).toBe(11);
    expect(f.losses).toBe(9);
    expect(f.win_rate_pct).toBeCloseTo(55, 1);
    expect(f.avg_win_dollars).toBeCloseTo(0.1, 4);
    expect(f.avg_loss_dollars).toBeCloseTo(0.23, 4);
    expect(f.rr_ratio).toBeCloseTo(0.1 / 0.23, 3);
    expect(f.rr_ratio!).toBeLessThan(1); // the headline diagnostic
    // profit_factor = sum_wins / sum_abs_losses = 1.10 / 2.07 ≈ 0.531
    expect(f.profit_factor).toBeCloseTo(1.1 / 2.07, 2);
  });

  it("tracks largest win / loss", () => {
    const f = computeForensics([
      mkTrade(5),
      mkTrade(100),
      mkTrade(-50),
      mkTrade(-200),
    ]);
    expect(f.largest_win).toBe(100);
    expect(f.largest_loss).toBe(-200);
  });

  it("breaks down exit reasons", () => {
    const f = computeForensics([
      mkTrade(10, "tp_hit"),
      mkTrade(10, "tp_hit"),
      mkTrade(-5, "sl_hit"),
      mkTrade(-3, "eod"),
      mkTrade(0, "time_stop"),
    ]);
    expect(f.exit_reason_breakdown).toEqual({
      tp_hit: 2,
      sl_hit: 1,
      eod: 1,
      time_stop: 1,
    });
  });

  it("counts pnl=0 as a scratch", () => {
    const f = computeForensics([mkTrade(10), mkTrade(0), mkTrade(-5)]);
    expect(f.wins).toBe(1);
    expect(f.losses).toBe(1);
    expect(f.scratches).toBe(1);
    expect(f.win_rate_pct).toBe(50); // scratches not counted in win rate
  });

  it("handles empty trades safely", () => {
    const f = computeForensics([]);
    expect(f.total).toBe(0);
    expect(f.win_rate_pct).toBeNull();
    expect(f.rr_ratio).toBeNull();
    expect(f.profit_factor).toBeNull();
  });

  it("skips trades with null pnl_dollars", () => {
    const f = computeForensics([mkTrade(10), mkTrade(null), mkTrade(-5)]);
    expect(f.total).toBe(3); // total counts ALL trades
    expect(f.wins).toBe(1);
    expect(f.losses).toBe(1);
    expect(f.scratches).toBe(0);
  });
});
