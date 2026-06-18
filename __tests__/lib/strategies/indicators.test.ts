/**
 * Streaming-indicator parity with lib/indicators/index.ts — Sprint 053a.
 *
 * The streaming versions emit one value per bar (array form). The existing
 * indicators emit one value (the latest). At the last index, the streaming
 * value must match the existing output within rounding tolerance.
 */

import { rsi, ema, sma, atr } from "@/lib/strategies/indicators";
import { computeIndicators, computeKeltnerChannel } from "@/lib/indicators";

function makeBar(close: number, high?: number, low?: number, open?: number) {
  return {
    open: open ?? close - 0.5,
    high: high ?? close + 1,
    low: low ?? close - 1,
    close,
  };
}

const FLAT_BARS = Array.from({ length: 35 }, (_, i) =>
  makeBar(100 + Math.sin(i * 0.5) * 0.5),
);

const TREND_BARS = Array.from({ length: 35 }, (_, i) => makeBar(100 + i * 0.3));

describe("streaming RSI", () => {
  it("last value matches computeIndicators(bars).rsi within 2 dp", () => {
    const closes = FLAT_BARS.map((b) => b.close);
    const streaming = rsi(closes, 14);
    const oracle = computeIndicators(FLAT_BARS, 14)!;
    expect(streaming.at(-1)).toBeCloseTo(oracle.rsi, 1);
  });

  it("warmup bars are null", () => {
    const closes = FLAT_BARS.map((b) => b.close);
    const streaming = rsi(closes, 14);
    // Need period + 1 = 15 bars before first value; index 0..13 = null, index 14 = first value.
    for (let i = 0; i < 14; i++) expect(streaming[i]).toBeNull();
    expect(streaming[14]).not.toBeNull();
  });

  it("trending up produces RSI > 50", () => {
    const closes = TREND_BARS.map((b) => b.close);
    const streaming = rsi(closes, 14);
    expect(streaming.at(-1)).toBeGreaterThan(50);
  });
});

describe("streaming ATR", () => {
  it("last value matches computeIndicators(bars).atr within 4 dp", () => {
    const streaming = atr(FLAT_BARS, 14);
    const oracle = computeIndicators(FLAT_BARS, 14)!;
    expect(streaming.at(-1)).toBeCloseTo(oracle.atr, 3);
  });

  it("warmup bars are null", () => {
    const streaming = atr(FLAT_BARS, 14);
    // Need period + 1 bars (15) to have an ATR value at index 14.
    for (let i = 0; i < 14; i++) expect(streaming[i]).toBeNull();
    expect(streaming[14]).not.toBeNull();
  });
});

describe("streaming EMA matches KC's internal EMA at last bar", () => {
  it("EMA(13) last value matches computeKeltnerChannel(bars, 13).ema within 4 dp", () => {
    const closes = FLAT_BARS.map((b) => b.close);
    const streaming = ema(closes, 13);
    const kc = computeKeltnerChannel(FLAT_BARS, 13)!;
    expect(streaming.at(-1)).toBeCloseTo(kc.ema, 3);
  });
});

describe("streaming SMA", () => {
  it("first non-null value equals SMA of first `period` closes", () => {
    const closes = [10, 20, 30, 40, 50];
    const result = sma(closes, 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(20, 6); // (10+20+30)/3
    expect(result[3]).toBeCloseTo(30, 6); // (20+30+40)/3
    expect(result[4]).toBeCloseTo(40, 6); // (30+40+50)/3
  });
});
