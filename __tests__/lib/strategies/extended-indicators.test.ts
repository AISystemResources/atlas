/**
 * Sprint 080C — extended indicator unit tests.
 *
 * Covers: MACD (line/signal/histogram), Bollinger Bands, Stochastic (K/D),
 * VWAP (session reset), and volume_sma.
 *
 * Reference values computed by hand or against known formulas.
 * Existing indicators (RSI, EMA, SMA, ATR, KC) are unaffected — regression
 * covered by the existing exit-conditions and clamp tests.
 */

import {
  computeAllIndicators,
  type Bar,
} from "@/lib/strategies/indicators";

// ── helpers ──────────────────────────────────────────────────────────────────

function closes(arr: number[]): Bar[] {
  return arr.map((c, i) => ({
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000,
    timestamp: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
  }));
}

function getArr(id: string, bars: Bar[], specs: Parameters<typeof computeAllIndicators>[0]) {
  return computeAllIndicators(specs, bars)[id];
}

// ── MACD line ────────────────────────────────────────────────────────────────

describe("macd line", () => {
  // 30 bars of linearly increasing close to get well past slow EMA warmup
  const bars = closes(Array.from({ length: 30 }, (_, i) => 100 + i));
  const spec = [{ id: "m", type: "macd" as const, params: { fast_period: 3, slow_period: 5, signal_period: 2 } }];

  it("null during warmup (before slow EMA is ready)", () => {
    const arr = getArr("m", bars, spec);
    // slow EMA(5) needs 5 bars → first value at index 4
    expect(arr[3]).toBeNull();
    expect(arr[4]).not.toBeNull();
  });

  it("MACD line = fast EMA − slow EMA (positive when fast > slow on uptrend)", () => {
    const arr = getArr("m", bars, spec);
    // On a consistent uptrend, fast EMA > slow EMA → positive MACD
    const lastVal = arr[arr.length - 1];
    expect(lastVal).not.toBeNull();
    expect(lastVal!).toBeGreaterThan(0);
  });
});

// ── MACD signal ──────────────────────────────────────────────────────────────

describe("macd_signal", () => {
  const bars = closes(Array.from({ length: 40 }, (_, i) => 100 + i));
  const spec = [{ id: "ms", type: "macd_signal" as const, params: { fast_period: 3, slow_period: 5, signal_period: 4 } }];

  it("null until slow EMA + signal EMA warmup complete", () => {
    const arr = getArr("ms", bars, spec);
    // First MACD line value at index 4 (slow EMA period-1).
    // Signal EMA seeds after 4 consecutive MACD values: indices 4,5,6,7 → first at index 7.
    expect(arr[6]).toBeNull(); // only 3 MACD values so far
    expect(arr[7]).not.toBeNull(); // 4th MACD value → signal EMA seeded
  });

  it("signal line is defined in the latter portion", () => {
    const arr = getArr("ms", bars, spec);
    expect(arr[arr.length - 1]).not.toBeNull();
  });
});

// ── MACD histogram ───────────────────────────────────────────────────────────

describe("macd_histogram", () => {
  const bars = closes(Array.from({ length: 40 }, (_, i) => 100 + i));
  const lineSpec = [{ id: "ml", type: "macd" as const, params: { fast_period: 3, slow_period: 5, signal_period: 4 } }];
  const sigSpec  = [{ id: "ms", type: "macd_signal" as const, params: { fast_period: 3, slow_period: 5, signal_period: 4 } }];
  const histSpec = [{ id: "mh", type: "macd_histogram" as const, params: { fast_period: 3, slow_period: 5, signal_period: 4 } }];

  it("histogram = MACD line − signal where both are non-null", () => {
    const line = computeAllIndicators(lineSpec, bars)["ml"];
    const sig  = computeAllIndicators(sigSpec, bars)["ms"];
    const hist = computeAllIndicators(histSpec, bars)["mh"];

    for (let i = 0; i < bars.length; i++) {
      if (line[i] !== null && sig[i] !== null) {
        expect(hist[i]).toBeCloseTo(line[i]! - sig[i]!, 8);
      } else {
        expect(hist[i]).toBeNull();
      }
    }
  });
});

// ── Bollinger Bands ──────────────────────────────────────────────────────────

describe("bb_upper / bb_lower / bb_middle", () => {
  // Constant close = 100 → std dev = 0 → upper = lower = middle = 100
  const flatBars = closes(Array.from({ length: 20 }, () => 100));

  it("flat series: upper = lower = middle", () => {
    const specs: Parameters<typeof computeAllIndicators>[0] = [
      { id: "bu", type: "bb_upper",  params: { period: 5, std_dev: 2 } },
      { id: "bl", type: "bb_lower",  params: { period: 5, std_dev: 2 } },
      { id: "bm", type: "bb_middle", params: { period: 5 } },
    ];
    const arrs = computeAllIndicators(specs, flatBars);
    const last = flatBars.length - 1;
    expect(arrs["bu"][last]).toBeCloseTo(100, 6);
    expect(arrs["bl"][last]).toBeCloseTo(100, 6);
    expect(arrs["bm"][last]).toBeCloseTo(100, 6);
  });

  it("null before warmup (before period bars)", () => {
    const spec = [{ id: "bu", type: "bb_upper" as const, params: { period: 5, std_dev: 2 } }];
    const arr = getArr("bu", flatBars, spec);
    expect(arr[3]).toBeNull();
    expect(arr[4]).not.toBeNull();
  });

  it("upper > middle > lower for non-constant series", () => {
    const bars = closes([100, 102, 98, 105, 95, 110, 90, 108, 92, 106]);
    const specs: Parameters<typeof computeAllIndicators>[0] = [
      { id: "bu", type: "bb_upper",  params: { period: 5, std_dev: 2 } },
      { id: "bl", type: "bb_lower",  params: { period: 5, std_dev: 2 } },
      { id: "bm", type: "bb_middle", params: { period: 5 } },
    ];
    const arrs = computeAllIndicators(specs, bars);
    const last = bars.length - 1;
    expect(arrs["bu"][last]!).toBeGreaterThan(arrs["bm"][last]!);
    expect(arrs["bm"][last]!).toBeGreaterThan(arrs["bl"][last]!);
  });
});

// ── Stochastic ───────────────────────────────────────────────────────────────

describe("stoch_k", () => {
  it("null before warmup", () => {
    const bars = closes([100, 102, 98, 105]);
    const spec = [{ id: "sk", type: "stoch_k" as const, params: { period: 5 } }];
    const arr = getArr("sk", bars, spec);
    expect(arr.every((v) => v === null)).toBe(true);
  });

  it("0 when close is at period low, 100 when close is at period high", () => {
    // period=1: each bar's high/low is the full lookback window.
    // Bar 0: close=90 = low → 0%. Bar 2: close=110 = high → 100%.
    const barsMid: Bar[] = [
      { high: 110, low: 90, close: 90, timestamp: "2024-01-01T10:00:00Z" },
      { high: 110, low: 90, close: 100, timestamp: "2024-01-01T10:05:00Z" },
      { high: 110, low: 90, close: 110, timestamp: "2024-01-01T10:10:00Z" },
    ];
    const spec = [{ id: "sk", type: "stoch_k" as const, params: { period: 1 } }];
    const arr = computeAllIndicators(spec, barsMid)["sk"];
    expect(arr[0]).toBeCloseTo(0, 6);
    expect(arr[2]).toBeCloseTo(100, 6);
  });

  it("returns 50 when high === low (zero-range bar)", () => {
    const barFlat: Bar[] = Array.from({ length: 3 }, () => ({
      high: 100, low: 100, close: 100,
      timestamp: "2024-01-01T10:00:00Z",
    }));
    const spec = [{ id: "sk", type: "stoch_k" as const, params: { period: 3 } }];
    const arr = computeAllIndicators(spec, barFlat)["sk"];
    expect(arr[2]).toBe(50);
  });
});

describe("stoch_d", () => {
  it("null until k_period + d_period - 1 bars", () => {
    const bars = closes(Array.from({ length: 10 }, (_, i) => 100 + i));
    // k_period=3, d_period=3 → first non-null %K at index 2; first %D = SMA(3) of %K → index 4
    const spec = [{ id: "sd", type: "stoch_d" as const, params: { k_period: 3, d_period: 3 } }];
    const arr = getArr("sd", bars, spec);
    expect(arr[3]).toBeNull();
    expect(arr[4]).not.toBeNull();
  });
});

// ── VWAP ─────────────────────────────────────────────────────────────────────

describe("vwap", () => {
  it("null when volume is missing", () => {
    const bars: Bar[] = [
      { high: 101, low: 99, close: 100, timestamp: "2024-01-02T09:31:00Z" },
      { high: 102, low: 100, close: 101, timestamp: "2024-01-02T09:36:00Z" },
    ];
    const spec = [{ id: "v", type: "vwap" as const, params: {} }];
    const arr = computeAllIndicators(spec, bars)["v"];
    expect(arr[0]).toBeNull();
    expect(arr[1]).toBeNull();
  });

  it("single bar: VWAP = typical price", () => {
    const bars: Bar[] = [
      { high: 102, low: 98, close: 100, volume: 500, timestamp: "2024-01-02T09:31:00Z" },
    ];
    const spec = [{ id: "v", type: "vwap" as const, params: {} }];
    const arr = computeAllIndicators(spec, bars)["v"];
    // typical = (102+98+100)/3 = 100
    expect(arr[0]).toBeCloseTo(100, 6);
  });

  it("resets on new calendar day", () => {
    const bars: Bar[] = [
      { high: 110, low: 90, close: 100, volume: 100, timestamp: "2024-01-02T09:31:00Z" },
      { high: 112, low: 92, close: 102, volume: 100, timestamp: "2024-01-02T09:36:00Z" },
      // new day
      { high: 200, low: 180, close: 190, volume: 100, timestamp: "2024-01-03T09:31:00Z" },
    ];
    const spec = [{ id: "v", type: "vwap" as const, params: {} }];
    const arr = computeAllIndicators(spec, bars)["v"];
    // Day 1 bar 0: typical=(110+90+100)/3=100
    expect(arr[0]).toBeCloseTo(100, 4);
    // Day 2 bar 0: typical=(200+180+190)/3 ≈ 190
    expect(arr[2]).toBeCloseTo((200 + 180 + 190) / 3, 4);
    // arr[2] ≈ 190 confirms reset (day-1 average ~100 would have dragged it lower)
  });
});

// ── volume_sma ───────────────────────────────────────────────────────────────

describe("volume_sma", () => {
  it("null before warmup, then rolling average of volume", () => {
    const bars: Bar[] = [
      { high: 101, low: 99, close: 100, volume: 1000, timestamp: "2024-01-01T10:00:00Z" },
      { high: 102, low: 100, close: 101, volume: 2000, timestamp: "2024-01-01T10:05:00Z" },
      { high: 103, low: 101, close: 102, volume: 3000, timestamp: "2024-01-01T10:10:00Z" },
    ];
    const spec = [{ id: "vs", type: "volume_sma" as const, params: { period: 2 } }];
    const arr = computeAllIndicators(spec, bars)["vs"];
    expect(arr[0]).toBeNull();
    expect(arr[1]).toBeCloseTo(1500, 4); // (1000+2000)/2
    expect(arr[2]).toBeCloseTo(2500, 4); // (2000+3000)/2
  });
});

// ── Schema: new types accepted by parseTicketLogicBody ───────────────────────

import { parseTicketLogicBody } from "@/lib/strategies/schema";

const baseBody = {
  universe: { asset_class: "equity" },
  timeframe: "5m",
  direction: "long",
  entry: {
    conditions: [
      { op: "gt", left: { type: "indicator", id: "m", bar_offset: 0 }, right: { type: "constant", value: 0 } },
    ],
    sizing: { method: "fixed_notional", value: 200 },
  },
  exit: {
    take_profit: { type: "constant", value: 9999 },
    sl_method: { type: "pct_of_entry", value: 0.01 },
  },
} as const;

describe("parseTicketLogicBody — 080C indicator types", () => {
  it("accepts macd indicator", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseBody,
        indicators: [{ id: "m", type: "macd", params: { fast_period: 12, slow_period: 26, signal_period: 9 } }],
      }),
    ).not.toThrow();
  });

  it("accepts bb_upper indicator", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseBody,
        indicators: [{ id: "m", type: "bb_upper", params: { period: 20, std_dev: 2 } }],
      }),
    ).not.toThrow();
  });

  it("accepts stoch_k indicator", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseBody,
        indicators: [{ id: "m", type: "stoch_k", params: { period: 14 } }],
      }),
    ).not.toThrow();
  });

  it("accepts vwap indicator", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseBody,
        indicators: [{ id: "m", type: "vwap", params: {} }],
      }),
    ).not.toThrow();
  });

  it("rejects unknown indicator type", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseBody,
        indicators: [{ id: "m", type: "unknown_indicator", params: {} }],
      }),
    ).toThrow();
  });
});
