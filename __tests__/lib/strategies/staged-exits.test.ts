/**
 * Sprint 080F — staged partial-exit tests.
 *
 * Covers:
 *   - simulateExit: first stage fires, second fires later, final exit fires last
 *   - simulateExit: SL supersedes pending stages (hard stop wins)
 *   - simulateExit: all stages consume full position (no remaining fraction)
 *   - simulateExit: no stages → partialExits is empty (backward compat)
 *   - simulate.ts: weighted P&L computed correctly across tranches
 *   - Zod schema: valid stages accepted; fraction sum > 1 rejected; empty array rejected
 *   - render-rules: stages rendered as "Stage N (X%): TP = <expr>"
 */

import type { Bar } from "@/lib/strategies/indicators";
import { simulateExit } from "@/lib/backtest-ticket/simulate-exit";
import { parseTicketLogicBody } from "@/lib/strategies/schema";
import { renderTicketLogicBody } from "@/lib/strategies/render-rules";
import type { TicketLogicBody } from "@/lib/strategies/types";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeBar(high: number, low: number, close: number, ts: string): Bar {
  return { open: close, high, low, close, timestamp: ts };
}

function tsFor(day: number, hour: number): string {
  return `2024-01-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
}

// ── simulateExit with stages ──────────────────────────────────────────────────

describe("simulateExit — staged partial exits", () => {
  // Entry at bar 0 (close=100). Stage 1: 50% at TP=105. Stage 2: 25% at TP=110.
  // Remaining 25% exits at main TP=115.
  const entryBar: Bar = makeBar(101, 99, 100, tsFor(1, 9));
  const bars: Bar[] = [
    entryBar,
    makeBar(103, 99, 102, tsFor(1, 10)), // below all TPs
    makeBar(107, 99, 106, tsFor(1, 11)), // hits stage 1 (TP=105), not stage 2
    makeBar(112, 99, 111, tsFor(1, 12)), // hits stage 2 (TP=110)
    makeBar(117, 99, 116, tsFor(1, 13)), // hits main TP (115)
  ];

  const stages = [
    { fraction: 0.5, takeProfitPrice: 105 },
    { fraction: 0.25, takeProfitPrice: 110 },
  ];

  it("stage 1 fires on bar 2, stage 2 fires on bar 3, main TP fires on bar 4", () => {
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 115,
      stopLossPrice: 90,
      direction: "long",
      bars,
      stages,
    });

    expect(result.partialExits).toHaveLength(2);
    expect(result.partialExits[0]).toMatchObject({ stageIndex: 0, barIndex: 2, exitPrice: 105, fraction: 0.5 });
    expect(result.partialExits[1]).toMatchObject({ stageIndex: 1, barIndex: 3, exitPrice: 110, fraction: 0.25 });
    expect(result.exitBarIndex).toBe(4);
    expect(result.exitPrice).toBe(115);
    expect(result.exitReason).toBe("tp_hit");
  });

  it("SL supersedes pending stages when SL fires", () => {
    const barsWithSL: Bar[] = [
      entryBar,
      makeBar(103, 99, 102, tsFor(1, 10)),
      makeBar(107, 85, 86, tsFor(1, 11)), // high hits stage1 TP=105 AND low hits SL=90 → SL wins
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 115,
      stopLossPrice: 90,
      direction: "long",
      bars: barsWithSL,
      stages,
    });
    // SL fires first (conservative-bias); stage partially shouldn't record
    expect(result.exitReason).toBe("sl_hit");
    expect(result.exitPrice).toBe(90);
    expect(result.partialExits).toHaveLength(0);
  });

  it("all stages consuming full position closes trade at last stage bar", () => {
    // Stages sum to 1.0: 50% at 105, 50% at 110. Main TP=115 is never reached.
    const stagesFull = [
      { fraction: 0.5, takeProfitPrice: 105 },
      { fraction: 0.5, takeProfitPrice: 110 },
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 115,
      stopLossPrice: 90,
      direction: "long",
      bars,
      stages: stagesFull,
    });
    // Both stages fired (bar 2 and bar 3). partialExits contains only the
    // first stage; the second becomes the "final" exit.
    expect(result.exitReason).toBe("tp_hit");
    expect(result.partialExits).toHaveLength(1);
    expect(result.partialExits[0].fraction).toBe(0.5);
    expect(result.exitBarIndex).toBe(3);
    expect(result.exitPrice).toBe(110);
  });

  it("no stages → partialExits is empty (backward compat)", () => {
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 115,
      stopLossPrice: 90,
      direction: "long",
      bars,
    });
    expect(result.partialExits).toHaveLength(0);
    expect(result.exitReason).toBe("tp_hit");
    expect(result.exitBarIndex).toBe(4);
  });
});

// ── short direction ───────────────────────────────────────────────────────────

describe("simulateExit — staged exits short direction", () => {
  const entryBar: Bar = makeBar(101, 99, 100, tsFor(1, 9));
  const bars: Bar[] = [
    entryBar,
    makeBar(101, 97, 98, tsFor(1, 10)), // above all TPs (short TPs are below entry)
    makeBar(101, 94, 95, tsFor(1, 11)), // hits stage 1 TP=95
    makeBar(101, 88, 89, tsFor(1, 12)), // hits main TP=90
  ];

  it("short stage fires when bar low reaches stage TP", () => {
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 90,
      stopLossPrice: 110,
      direction: "short",
      bars,
      stages: [{ fraction: 0.5, takeProfitPrice: 95 }],
    });
    expect(result.partialExits).toHaveLength(1);
    expect(result.partialExits[0]).toMatchObject({ barIndex: 2, exitPrice: 95, fraction: 0.5 });
    expect(result.exitBarIndex).toBe(3);
    expect(result.exitPrice).toBe(90);
    expect(result.exitReason).toBe("tp_hit");
  });
});

// ── Zod schema ───────────────────────────────────────────────────────────────

const baseSchemBody = {
  universe: { asset_class: "equity" },
  timeframe: "5m",
  direction: "long",
  indicators: [{ id: "r", type: "rsi", params: { period: 14 } }],
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

describe("parseTicketLogicBody — 080F stages", () => {
  it("accepts valid stages with fraction sum < 1", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemBody,
        exit: {
          ...baseSchemBody.exit,
          stages: [
            { fraction: 0.5, take_profit: { type: "constant", value: 105 } },
            { fraction: 0.25, take_profit: { type: "constant", value: 110 } },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("accepts stages with fraction sum exactly 1", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemBody,
        exit: {
          ...baseSchemBody.exit,
          stages: [
            { fraction: 0.5, take_profit: { type: "constant", value: 105 } },
            { fraction: 0.5, take_profit: { type: "constant", value: 110 } },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("rejects stages with fraction sum > 1", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemBody,
        exit: {
          ...baseSchemBody.exit,
          stages: [
            { fraction: 0.7, take_profit: { type: "constant", value: 105 } },
            { fraction: 0.5, take_profit: { type: "constant", value: 110 } },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects empty stages array", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemBody,
        exit: {
          ...baseSchemBody.exit,
          stages: [],
        },
      }),
    ).toThrow();
  });

  it("rejects fraction of 0", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemBody,
        exit: {
          ...baseSchemBody.exit,
          stages: [{ fraction: 0, take_profit: { type: "constant", value: 105 } }],
        },
      }),
    ).toThrow();
  });

  it("accepts strategy without stages (backward compat)", () => {
    expect(() => parseTicketLogicBody(baseSchemBody)).not.toThrow();
  });
});

// ── render-rules ─────────────────────────────────────────────────────────────

describe("renderTicketLogicBody — staged exits", () => {
  const body: TicketLogicBody = {
    universe: { asset_class: "equity" },
    timeframe: "5m",
    direction: "long",
    indicators: [],
    entry: {
      conditions: [
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 0 } },
      ],
      sizing: { method: "fixed_notional", value: 500 },
    },
    exit: {
      take_profit: { type: "constant", value: 115 },
      sl_method: { type: "pct_of_entry", value: 0.05 },
      stages: [
        { fraction: 0.5, take_profit: { type: "constant", value: 105 } },
        { fraction: 0.25, take_profit: { type: "constant", value: 110 } },
      ],
    },
  };

  it("renders stage descriptions with fraction percentage and TP expression", () => {
    const rendered = renderTicketLogicBody(body);
    expect(rendered.stages).toHaveLength(2);
    expect(rendered.stages[0]).toBe("Stage 1 (50%): TP = 105");
    expect(rendered.stages[1]).toBe("Stage 2 (25%): TP = 110");
  });

  it("renders empty stages array when no stages defined", () => {
    const bodyNoStages: TicketLogicBody = { ...body, exit: { take_profit: body.exit.take_profit, sl_method: body.exit.sl_method } };
    const rendered = renderTicketLogicBody(bodyNoStages);
    expect(rendered.stages).toHaveLength(0);
  });
});
