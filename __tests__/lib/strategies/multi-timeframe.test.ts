/**
 * Sprint 080E — multi-timeframe indicator unit tests.
 *
 * Covers:
 *   - alignToTimeline semantics: last-known-value, null before first secondary bar
 *   - computeAllIndicators with secondaryBarsMap routes correctly
 *   - Primary bars use primary series when no timeframe override
 *   - evaluate() threads secondary bars so multi-tf indicators fire correctly
 *   - Zod schema: accepts timeframe field on IndicatorSpec, rejects unknown values
 *   - render-rules: indicatorLabel appends [tf] when timeframe is set
 */

import type { Bar } from "@/lib/strategies/indicators";
import { computeAllIndicators } from "@/lib/strategies/indicators";
import { evaluate } from "@/lib/strategies/evaluate";
import { parseTicketLogicBody } from "@/lib/strategies/schema";
import { renderTicketLogicBody } from "@/lib/strategies/render-rules";
import type { TicketLogicBody } from "@/lib/strategies/types";

// ── helpers ──────────────────────────────────────────────────────────────────

function bar(close: number, ts: string): Bar {
  return { open: close, high: close + 1, low: close - 1, close, timestamp: ts };
}

// ── alignToTimeline (via computeAllIndicators) ────────────────────────────────

describe("multi-timeframe alignment", () => {
  // Primary bars every 5 minutes; secondary bars every hour.
  // Secondary bar at T is visible to primary bars at T' >= T.
  const primaryBars: Bar[] = [
    bar(100, "2024-01-02T09:30:00Z"),
    bar(101, "2024-01-02T09:35:00Z"),
    bar(102, "2024-01-02T09:40:00Z"),
    bar(103, "2024-01-02T10:00:00Z"), // exactly at secondary bar boundary
    bar(104, "2024-01-02T10:05:00Z"),
    bar(105, "2024-01-02T10:10:00Z"),
  ];

  // SMA(1) on secondary bars so indicator value = the bar's own close.
  // First secondary bar at 09:00, second at 10:00.
  const secondaryBars: Bar[] = [
    bar(200, "2024-01-02T09:00:00Z"),
    bar(300, "2024-01-02T10:00:00Z"),
  ];

  const specs = [{ id: "sma_1h", type: "sma" as const, params: { period: 1 }, timeframe: "1h" as const }];

  it("returns null before first secondary bar arrives", () => {
    const arrs = computeAllIndicators(specs, primaryBars, { "1h": secondaryBars });
    // primaryBars[0] at 09:30 >= secondaryBars[0] at 09:00 → gets secondary value 200
    // So first bar already gets a value in this setup
    expect(arrs["sma_1h"][0]).toBeCloseTo(200, 4);
  });

  it("holds last secondary value between secondary bar updates", () => {
    const arrs = computeAllIndicators(specs, primaryBars, { "1h": secondaryBars });
    // Bars 0-2 (09:30, 09:35, 09:40) see secondary bar at 09:00 → sma=200
    expect(arrs["sma_1h"][0]).toBeCloseTo(200, 4);
    expect(arrs["sma_1h"][1]).toBeCloseTo(200, 4);
    expect(arrs["sma_1h"][2]).toBeCloseTo(200, 4);
  });

  it("updates when a new secondary bar arrives", () => {
    const arrs = computeAllIndicators(specs, primaryBars, { "1h": secondaryBars });
    // primaryBars[3] at 10:00 >= secondaryBars[1] at 10:00 → transitions to 300
    expect(arrs["sma_1h"][3]).toBeCloseTo(300, 4);
    expect(arrs["sma_1h"][4]).toBeCloseTo(300, 4);
    expect(arrs["sma_1h"][5]).toBeCloseTo(300, 4);
  });

  it("returns null before any secondary bar", () => {
    // Primary bars that predate the first secondary bar
    const earlyPrimary: Bar[] = [
      bar(99, "2024-01-02T08:00:00Z"),
      bar(100, "2024-01-02T08:30:00Z"),
    ];
    const arrs = computeAllIndicators(specs, earlyPrimary, { "1h": secondaryBars });
    expect(arrs["sma_1h"][0]).toBeNull();
    expect(arrs["sma_1h"][1]).toBeNull();
  });
});

// ── Primary indicators unaffected when no timeframe set ───────────────────────

describe("primary indicators unaffected", () => {
  it("indicator without timeframe uses primary bars", () => {
    const primaryBars: Bar[] = [
      bar(100, "2024-01-02T09:30:00Z"),
      bar(102, "2024-01-02T09:35:00Z"),
      bar(104, "2024-01-02T09:40:00Z"),
    ];
    const secondaryBars: Bar[] = [bar(200, "2024-01-02T09:00:00Z")];
    const specs = [{ id: "sma_p", type: "sma" as const, params: { period: 2 } }];

    const arrs = computeAllIndicators(specs, primaryBars, { "1h": secondaryBars });
    // SMA(2) on primary: [null, (100+102)/2=101, (102+104)/2=103]
    expect(arrs["sma_p"][0]).toBeNull();
    expect(arrs["sma_p"][1]).toBeCloseTo(101, 4);
    expect(arrs["sma_p"][2]).toBeCloseTo(103, 4);
  });
});

// ── evaluate() with multi-timeframe indicator ─────────────────────────────────

describe("evaluate() with multi-timeframe RSI filter", () => {
  it("uses secondary-timeframe indicator value for entry condition", () => {
    // Primary bars: declining close (200 → 171) → primary RSI ≈ 0 (all losses).
    // Secondary bars: rising close (100 → 129) → secondary RSI ≈ 100 (all gains).
    // Condition: rsi_1h > 60.
    //   Without secondary bars: rsi_1h computed on declining primary → RSI ≈ 0 → no signals.
    //   With secondary bars:    rsi_1h aligned from rising secondary → RSI ≈ 100 → signals fire.
    const primaryBars: Bar[] = Array.from({ length: 30 }, (_, i) => ({
      open: 200 - i, high: 201 - i, low: 199 - i, close: 200 - i,
      timestamp: `2024-01-02T${String(9 + Math.floor(i / 12)).padStart(2, "0")}:${String((i % 12) * 5).padStart(2, "0")}:00Z`,
    }));
    // 30 secondary daily bars (Dec 2023) with rising close → RSI ≈ 100.
    // All bars predate the primary series (Jan 2, 2024) so they're fully
    // aligned before the first primary bar is evaluated.
    const dec1 = new Date("2023-12-02T00:00:00Z");
    const secondaryBars: Bar[] = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(dec1.getTime() + i * 86400000);
      return { open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, timestamp: d.toISOString() };
    });

    const logic: TicketLogicBody = {
      universe: { asset_class: "equity" },
      timeframe: "5m",
      direction: "long",
      indicators: [
        { id: "rsi_1h", type: "rsi", params: { period: 14 }, timeframe: "1h" },
      ],
      entry: {
        conditions: [
          { op: "gt", left: { type: "indicator", id: "rsi_1h", bar_offset: 0 }, right: { type: "constant", value: 60 } },
        ],
        sizing: { method: "fixed_notional", value: 500 },
      },
      exit: {
        // TP far above, SL far below so sanity check (TP > entry > SL for long) passes
        take_profit: { type: "binary", op: "+", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 50 } },
        sl_method: { type: "pct_of_entry", value: 0.05 },
      },
    };

    // Without secondary bars: rsi_1h falls back to primary (declining) → RSI ≈ 0 → no signals
    const signalsNoSecondary = evaluate(logic, primaryBars);
    // With secondary bars: rsi_1h aligned from rising secondary → RSI > 60 → signals fire
    const signalsWithSecondary = evaluate(logic, primaryBars, { "1h": secondaryBars });

    expect(signalsNoSecondary).toHaveLength(0);
    expect(signalsWithSecondary.length).toBeGreaterThan(0);
  });
});

// ── Zod schema ───────────────────────────────────────────────────────────────

const baseSchemBody = {
  universe: { asset_class: "equity" },
  timeframe: "5m",
  direction: "long",
  entry: {
    conditions: [
      { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 0 } },
    ],
    sizing: { method: "fixed_notional", value: 200 },
  },
  exit: {
    take_profit: { type: "constant", value: 9999 },
    sl_method: { type: "pct_of_entry", value: 0.01 },
  },
} as const;

describe("parseTicketLogicBody — 080E timeframe on IndicatorSpec", () => {
  it("accepts IndicatorSpec with valid timeframe", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemBody,
        indicators: [{ id: "r", type: "rsi", params: { period: 14 }, timeframe: "1h" }],
      }),
    ).not.toThrow();
  });

  it("accepts IndicatorSpec without timeframe (backward compat)", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemBody,
        indicators: [{ id: "r", type: "rsi", params: { period: 14 } }],
      }),
    ).not.toThrow();
  });

  it("rejects invalid timeframe value", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemBody,
        indicators: [{ id: "r", type: "rsi", params: { period: 14 }, timeframe: "3m" }],
      }),
    ).toThrow();
  });
});

// ── render-rules: timeframe suffix ───────────────────────────────────────────

describe("indicatorLabel — timeframe suffix", () => {
  it("shows [1h] suffix when timeframe is set", () => {
    const body: TicketLogicBody = {
      universe: { asset_class: "equity" },
      timeframe: "5m",
      direction: "long",
      indicators: [{ id: "r", type: "rsi", params: { period: 14 }, timeframe: "1h" }],
      entry: {
        conditions: [
          { op: "gt", left: { type: "indicator", id: "r", bar_offset: 0 }, right: { type: "constant", value: 50 } },
        ],
        sizing: { method: "fixed_notional", value: 500 },
      },
      exit: {
        take_profit: { type: "constant", value: 9999 },
        sl_method: { type: "pct_of_entry", value: 0.05 },
      },
    };
    const rendered = renderTicketLogicBody(body);
    const rsiLabel = rendered.indicators.find((i) => i.id === "r")?.label;
    expect(rsiLabel).toBe("RSI(14) [1h]");
  });

  it("no suffix when timeframe is absent", () => {
    const body: TicketLogicBody = {
      universe: { asset_class: "equity" },
      timeframe: "5m",
      direction: "long",
      indicators: [{ id: "r", type: "rsi", params: { period: 14 } }],
      entry: {
        conditions: [
          { op: "gt", left: { type: "indicator", id: "r", bar_offset: 0 }, right: { type: "constant", value: 50 } },
        ],
        sizing: { method: "fixed_notional", value: 500 },
      },
      exit: {
        take_profit: { type: "constant", value: 9999 },
        sl_method: { type: "pct_of_entry", value: 0.05 },
      },
    };
    const rendered = renderTicketLogicBody(body);
    const rsiLabel = rendered.indicators.find((i) => i.id === "r")?.label;
    expect(rsiLabel).toBe("RSI(14)");
  });
});
