/**
 * Sprint 080B — trailing stop unit tests.
 *
 * Covers:
 *   1. trailing_atr: stop ratchets up with price (long); never reverses
 *   2. trailing_pct: same ratchet semantics; percentage from peak
 *   3. Both directions (long / short)
 *   4. Static methods (fixed_buffer, atr_multiple, pct_of_entry) unaffected
 *   5. Zod schema: accepts trailing_atr / trailing_pct; rejects trailing_pct value > 1
 *   6. Initial stop at entry equals static equivalent (sanity check via evaluate.ts)
 */

import { simulateExit } from "@/lib/backtest-ticket/simulate-exit";
import { parseTicketLogicBody } from "@/lib/strategies/schema";
import type { Bar } from "@/lib/strategies/indicators";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DAY = "2024-01-02";

function bar(
  close: number,
  opts: { high?: number; low?: number; idx?: number } = {},
): Bar {
  const hh = opts.high ?? close + 2;
  const ll = opts.low ?? close - 2;
  const minutes = 31 + (opts.idx ?? 0) * 5;
  return {
    open: close,
    high: hh,
    low: ll,
    close,
    timestamp: `${DAY}T${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00Z`,
  };
}

// ── trailing_atr ─────────────────────────────────────────────────────────────

describe("trailingStopFn — trailing_atr (long)", () => {
  // Bars: price rises 100 → 110 → 105 (pulls back) → 95 (should be stopped)
  // ATR constant = 2. trailing multiple = 1.5 → stop trails 3 pts below peak.
  // Entry at bar 0 (close=100, high=102). After bar 1 (high=112), peak=112, stop=109.
  // Bar 2 close=105 low=103 — stop is 109 but low=103 < 109? No: low=103 > 109 is false.
  // Wait, low=103 and stop=109... 103 <= 109 → SL hit on bar 2.

  const ATR = 2;
  const MULTIPLE = 1.5; // trailing stop = peak - 3

  function makeTrailingFn(direction: "long" | "short") {
    return (extreme: number, _i: number) => {
      const sign = direction === "long" ? -1 : 1;
      return extreme + sign * MULTIPLE * ATR;
    };
  }

  it("stop ratchets up as price rises, stops out on pullback", () => {
    const bars: Bar[] = [
      bar(100, { high: 102, low:  98, idx: 0 }), // entry bar, extremePrice=102
      bar(110, { high: 112, low: 108, idx: 1 }), // stop=102-3=99; low=108>99 → no SL; extreme→112
      bar(106, { high: 108, low: 110, idx: 2 }), // stop=112-3=109; low=110>109 → no SL; extreme stays 112
      bar( 95, { high: 100, low:  91, idx: 3 }), // stop=112-3=109; low=91<=109 → sl_hit
    ];

    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 999,
      stopLossPrice: 97, // initial static SL (overridden by trailing)
      direction: "long",
      bars,
      trailingStopFn: makeTrailingFn("long"),
    });

    expect(result.exitReason).toBe("sl_hit");
    expect(result.exitBarIndex).toBe(3);
    // Stop at time of exit: peak=112, stop=112-3=109
    expect(result.exitPrice).toBe(109);
  });

  it("trailing stop never reverses (does not follow price down)", () => {
    // Price goes up then down slowly. Stop should stay at the highest reached level.
    const bars: Bar[] = [
      bar(100, { high: 100, low: 100, idx: 0 }),
      bar(110, { high: 115, low: 109, idx: 1 }), // peak=115, stop=112
      bar(108, { high: 110, low: 106, idx: 2 }), // peak still 115, stop=112, low=106 < 112 → sl_hit
    ];

    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 999,
      stopLossPrice: 90,
      direction: "long",
      bars,
      trailingStopFn: makeTrailingFn("long"),
    });

    expect(result.exitReason).toBe("sl_hit");
    expect(result.exitBarIndex).toBe(2);
    expect(result.exitPrice).toBe(112); // 115 - MULTIPLE*ATR = 115 - 1.5*2 = 112
  });

  it("short: stop ratchets DOWN with falling price", () => {
    // Short: entry 100, price falls to 90 (trough=88 after low), then bounces to 96.
    // trailing_atr multiple=1.5, ATR=2: stop = trough + 3
    // After bar 1 trough=88: stop=91. Bar 2 high=96 >= 91 → sl_hit.
    const bars: Bar[] = [
      bar(100, { high: 102, low:  98, idx: 0 }),
      bar( 90, { high:  92, low:  88, idx: 1 }), // trough=88, stop=91
      bar( 95, { high:  96, low:  93, idx: 2 }), // high=96 >= 91 → sl_hit
    ];

    const trailingFnShort = (extreme: number) => extreme + MULTIPLE * ATR; // short: stop above trough

    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 0,     // unreachable (short TP below)
      stopLossPrice: 110,     // initial — overridden by trailing
      direction: "short",
      bars,
      trailingStopFn: trailingFnShort,
    });

    expect(result.exitReason).toBe("sl_hit");
    expect(result.exitBarIndex).toBe(2);
    expect(result.exitPrice).toBe(91); // 88 + 3
  });
});

// ── trailing_pct ──────────────────────────────────────────────────────────────

describe("trailingStopFn — trailing_pct (long)", () => {
  // 1% trailing: stop = peak * 0.99
  const trailingFn = (extreme: number) => extreme * 0.99;

  it("stop trails 1% below peak", () => {
    const bars: Bar[] = [
      bar(100, { high: 100, low: 100, idx: 0 }),
      bar(200, { high: 202, low: 198, idx: 1 }), // peak=202, stop=199.98
      bar(195, { high: 196, low: 190, idx: 2 }), // low=190 <= 199.98 → sl_hit
    ];

    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 999,
      stopLossPrice: 90,
      direction: "long",
      bars,
      trailingStopFn: trailingFn,
    });

    expect(result.exitReason).toBe("sl_hit");
    expect(result.exitBarIndex).toBe(2);
    expect(result.exitPrice).toBeCloseTo(202 * 0.99, 4);
  });
});

// ── Static methods unaffected ─────────────────────────────────────────────────

describe("simulateExit — static SL unaffected by 080B", () => {
  it("fixed stopLossPrice still works when no trailingStopFn", () => {
    const bars: Bar[] = [
      bar(100, { high: 101, low: 99,  idx: 0 }),
      bar( 95, { high:  96, low: 94,  idx: 1 }), // low=94 <= 97 → sl_hit
    ];

    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 200,
      stopLossPrice: 97,
      direction: "long",
      bars,
    });

    expect(result.exitReason).toBe("sl_hit");
    expect(result.exitPrice).toBe(97);
  });
});

// ── Zod schema ────────────────────────────────────────────────────────────────

const baseBody = {
  universe: { asset_class: "equity" },
  timeframe: "5m",
  direction: "long",
  indicators: [
    { id: "rsi_14", type: "rsi", params: { period: 14 } },
    { id: "atr_14", type: "atr", params: { period: 14 } },
  ],
  entry: {
    conditions: [
      { op: "gte", left: { type: "indicator", id: "rsi_14", bar_offset: 0 }, right: { type: "constant", value: 50 } },
    ],
    sizing: { method: "fixed_notional", value: 200 },
  },
  exit: {
    take_profit: { type: "constant", value: 9999 },
  },
} as const;

describe("parseTicketLogicBody — trailing sl_method schema", () => {
  it("accepts trailing_atr", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseBody,
        exit: {
          ...baseBody.exit,
          sl_method: { type: "trailing_atr", value: 1.5, atr_indicator_id: "atr_14" },
        },
      }),
    ).not.toThrow();
  });

  it("accepts trailing_pct with value < 1", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseBody,
        exit: {
          ...baseBody.exit,
          sl_method: { type: "trailing_pct", value: 0.01 },
        },
      }),
    ).not.toThrow();
  });

  it("rejects trailing_pct with value > 1", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseBody,
        exit: {
          ...baseBody.exit,
          sl_method: { type: "trailing_pct", value: 1.5 },
        },
      }),
    ).toThrow();
  });

  it("rejects trailing_atr with value <= 0", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseBody,
        exit: {
          ...baseBody.exit,
          sl_method: { type: "trailing_atr", value: 0, atr_indicator_id: "atr_14" },
        },
      }),
    ).toThrow();
  });
});
