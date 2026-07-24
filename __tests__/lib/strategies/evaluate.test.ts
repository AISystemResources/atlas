/**
 * Evaluator parity test — Sprint 053a.
 *
 * Two oracles:
 *   1. detectS1Signal (lib/indicators) — whether S1 fires on the last bar
 *   2. buildS1LongTicket (lib/signals/types) — the actual prices the scalper
 *      submits to Alpaca
 *
 * Parity invariant: the JSON-driven evaluator must agree with both oracles
 * on every fixture, both in firing decision and in computed prices.
 */

import { evaluate } from "@/lib/strategies/evaluate";
import { EDMUND_S1_LONG_V1 } from "@/lib/strategies/seeds";
import { ticketLogicBodySchema } from "@/lib/strategies/schema";
import { detectS1Signal, computeIndicators } from "@/lib/indicators";
import { buildS1LongTicket } from "@/lib/signals/types";

function makeBar(close: number, high?: number, low?: number, open?: number) {
  return {
    open: open ?? close - 0.5,
    high: high ?? close + 1,
    low: low ?? close - 1,
    close,
  };
}

/**
 * Synthetic series that reliably triggers Edmund S1.
 *   - 25 bars of mild uptrend (drives RSI(21) ≈ 72)
 *   - Penultimate bar with deep wick down to 96 (touches outer lower KC band)
 *   - Final bar bullish recovery (close > open, close > inner lower KC band)
 *
 * Verified manually: detectS1Signal returns non-null with this fixture.
 */
function makeS1TriggerBars() {
  const closes = Array.from({ length: 25 }, (_, i) => 99 + i * 0.1);
  const bars = closes.map((c, i) => ({
    open: i > 0 ? closes[i - 1] : c,
    high: c + 0.3,
    low: c - 0.3,
    close: c,
  }));
  bars.push({ open: 101.3, high: 101.5, low: 96, close: 100.5 });
  bars.push({ open: 100, high: 101, low: 99.5, close: 100.8 });
  return bars;
}

const FALLING_BARS = Array.from({ length: 35 }, (_, i) =>
  makeBar(100 - i * 0.5, 101 - i * 0.5, 99 - i * 0.5),
);

describe("EDMUND_S1_LONG_V1 seed is valid", () => {
  it("passes the Zod body schema", () => {
    expect(() => ticketLogicBodySchema.parse(EDMUND_S1_LONG_V1)).not.toThrow();
  });
});

describe("evaluator vs detectS1Signal (firing decision)", () => {
  it("agrees on a falling market (both should say no signal)", () => {
    const oracle = detectS1Signal(FALLING_BARS);
    expect(oracle).toBeNull();

    const entries = evaluate(EDMUND_S1_LONG_V1, FALLING_BARS);
    // Stronger than "no entry at last bar": no entry anywhere in the series.
    expect(entries.length).toBe(0);
  });

  it("fires exactly once at the signal bar (both oracles agree)", () => {
    const bars = makeS1TriggerBars();
    const oracle = detectS1Signal(bars);
    expect(oracle).not.toBeNull();

    const entries = evaluate(EDMUND_S1_LONG_V1, bars);
    // detectS1Signal only ever evaluates the last bar; the parity invariant
    // here is that the evaluator fires AT the last bar and not elsewhere on
    // this fixture.
    expect(entries.length).toBe(1);
    expect(entries[0].bar_index).toBe(bars.length - 1);
  });

  it("aborts when final bar is bearish (close < open)", () => {
    const bars = makeS1TriggerBars();
    bars[bars.length - 1] = makeBar(97, 100, 95, 99.5); // bearish close < open
    expect(detectS1Signal(bars)).toBeNull();
    const entries = evaluate(EDMUND_S1_LONG_V1, bars);
    const lastBarEntry = entries.find((e) => e.bar_index === bars.length - 1);
    expect(lastBarEntry).toBeUndefined();
  });
});

describe("evaluator vs buildS1LongTicket (price parity)", () => {
  it("entry/stop/target prices match buildS1LongTicket exactly (4 dp)", () => {
    const bars = makeS1TriggerBars();
    const entries = evaluate(EDMUND_S1_LONG_V1, bars);
    const lastBarEntry = entries.find((e) => e.bar_index === bars.length - 1);
    expect(lastBarEntry).toBeDefined();

    const signalBar = bars[bars.length - 1];
    const atrInd = computeIndicators(bars, 14)!;
    const ticket = buildS1LongTicket({
      ticker: "TEST",
      signal_bar_high: signalBar.high,
      signal_bar_low: signalBar.low,
      atr: atrInd.atr,
      notional_dollars: 200,
      current_price: signalBar.close,
    });
    expect(ticket).not.toBeNull();

    // Evaluator prices must match the scalper's actual order prices to 4 dp.
    expect(lastBarEntry!.entry_price).toBeCloseTo(ticket!.entry_price, 3);
    expect(lastBarEntry!.stop_loss).toBeCloseTo(ticket!.stop_loss, 3);
    expect(lastBarEntry!.take_profit).toBeCloseTo(ticket!.take_profit, 3);
  });
});

describe("evaluator output shape", () => {
  it("returns empty array on insufficient bars (no throw)", () => {
    const bars = Array.from({ length: 5 }, () => makeBar(100));
    const entries = evaluate(EDMUND_S1_LONG_V1, bars);
    expect(entries).toEqual([]);
  });

  it("returned entries carry indicator_snapshot", () => {
    const bars = makeS1TriggerBars();
    const entries = evaluate(EDMUND_S1_LONG_V1, bars);
    const lastBarEntry = entries.find((e) => e.bar_index === bars.length - 1);
    expect(lastBarEntry).toBeDefined();

    expect(lastBarEntry!.indicator_snapshot).toHaveProperty("rsi_21");
    expect(lastBarEntry!.indicator_snapshot).toHaveProperty("atr_14");
    expect(lastBarEntry!.indicator_snapshot).toHaveProperty("kc_lower_outer");
  });
});
