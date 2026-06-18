/**
 * Sprint 059 — evaluator test for sandy-s1-long v2 (canonical Sandy S1).
 *
 * Asserts the v2 mechanics produce the right entry/SL/TP shape on a fixture
 * that satisfies all three signal-bar conditions:
 *   - bullish (close > open)
 *   - close > lower KC 1.3
 *   - close < EMA(13) (mean-reversion guard)
 *
 * And verifies the rejection cases that distinguish v2 from v1:
 *   - close >= EMA(13) → no signal (v1 would have fired, v2 doesn't)
 */

import { evaluate } from "@/lib/strategies/evaluate";
import { SANDY_S1_LONG_V2 } from "@/lib/strategies/seeds";

function bar(close: number, high: number, low: number, open: number) {
  return { open, high, low, close };
}

/**
 * Build a ^DJI-scale fixture (close ≈ 50,000) where the LAST bar (signal
 * bar) satisfies all four v2 entry conditions:
 *   - bullish (close > open)
 *   - close > lower KC 1.3 line
 *   - close < EMA(13) median
 *   - entry_price (= sb.high + 3) < EMA(13)
 *
 * The +3 absolute buffer is Sandy's Dow convention; for it to fit under the
 * median, signal_bar.high needs to be ~5+ points below median. Fixture
 * anchors median at ~50,000 then dips signal bar close to ~49,990 with
 * high ≈ 49,994.
 */
function makeS1V2TriggerBars() {
  const bars: ReturnType<typeof bar>[] = [];
  // 25 bars near 50,000 to settle EMA(13) ≈ 50,000 and ATR ≈ 10
  for (let i = 0; i < 25; i++) {
    bars.push(bar(50_000, 50_005, 49_995, 49_998));
  }
  // Bearish dip to pull recent closes down (so signal bar can be below median)
  bars.push(bar(49_988, 49_990, 49_980, 50_000));
  bars.push(bar(49_988, 49_990, 49_984, 49_988));
  // Signal bar: bullish, close 49,988 (below EMA ≈ 49,996), high 49,990
  // so entry = sb.high + 3 = 49,993 < EMA → condition 4 passes
  bars.push(bar(49_988, 49_990, 49_984, 49_986));
  return bars;
}

describe("sandy-s1-long v2 evaluator", () => {
  it("fires on a fixture that satisfies all four signal-bar conditions", () => {
    const bars = makeS1V2TriggerBars();
    const entries = evaluate(SANDY_S1_LONG_V2, bars);
    const last = entries.find((e) => e.bar_index === bars.length - 1);
    expect(last).toBeDefined();

    // Entry = signal_bar.high + 3
    expect(last!.entry_price).toBeCloseTo(49_990 + 3, 4);
    // Stop loss = signal_bar.low - 3
    expect(last!.stop_loss).toBeCloseTo(49_984 - 3, 4);
    // Take profit = EMA(13), which is above entry (mean-reversion target)
    expect(last!.take_profit).toBeGreaterThan(last!.entry_price);
  });

  it("does NOT fire when signal bar close is ABOVE the EMA(13) median", () => {
    const bars = makeS1V2TriggerBars();
    // Flip signal bar close above EMA (~50,000)
    bars[bars.length - 1] = bar(50_010, 50_015, 50_000, 50_005);
    const entries = evaluate(SANDY_S1_LONG_V2, bars);
    expect(entries.find((e) => e.bar_index === bars.length - 1)).toBeUndefined();
  });

  it("does NOT fire when signal bar is bearish (close < open)", () => {
    const bars = makeS1V2TriggerBars();
    bars[bars.length - 1] = bar(49_985, 49_995, 49_980, 49_993);
    const entries = evaluate(SANDY_S1_LONG_V2, bars);
    expect(entries.find((e) => e.bar_index === bars.length - 1)).toBeUndefined();
  });

  it("does NOT fire when entry_price (sb.high + 3) >= EMA(13) (insufficient TP room)", () => {
    const bars = makeS1V2TriggerBars();
    // Signal bar close below EMA but high close enough that +3 pushes above EMA.
    // EMA is ~49,998. Set high = 49,997 → entry = 50,000 ≥ EMA → reject.
    bars[bars.length - 1] = bar(49_995, 49_997, 49_990, 49_991);
    const entries = evaluate(SANDY_S1_LONG_V2, bars);
    expect(entries.find((e) => e.bar_index === bars.length - 1)).toBeUndefined();
  });
});

describe("sandy-s1-long v2 — risk/reward shape vs v1", () => {
  it("produces stop distance = signal-bar range + 6 points (not multiplicative)", () => {
    const bars = makeS1V2TriggerBars();
    const entries = evaluate(SANDY_S1_LONG_V2, bars);
    const last = entries.find((e) => e.bar_index === bars.length - 1);
    expect(last).toBeDefined();

    const sbHigh = 49_990;
    const sbLow  = 49_984;
    const expectedStopDistance = sbHigh - sbLow + 6;
    expect(last!.entry_price - last!.stop_loss).toBeCloseTo(expectedStopDistance, 4);
  });
});
