/**
 * Sprint 080D — compound condition (AND/OR/NOT) unit tests.
 *
 * Covers:
 *   - Backward compatibility: plain Condition arrays still work
 *   - OR node: fires if any child is true
 *   - AND node: requires all children
 *   - NOT node: inverts a child
 *   - Nested: AND within OR, NOT within AND
 *   - regime_filter as a compound node
 *   - buildExitConditionChecker with ConditionNode[] (any in array fires)
 *   - Zod schema: accepts compound nodes, rejects empty children arrays
 */

import type { Bar } from "@/lib/strategies/indicators";
import type { ConditionNode, TicketLogicBody } from "@/lib/strategies/types";
import { buildExitConditionChecker, evaluate } from "@/lib/strategies/evaluate";
import { computeAllIndicators } from "@/lib/strategies/indicators";
import { parseTicketLogicBody } from "@/lib/strategies/schema";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeBars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    open: c,
    high: c + 2,
    low: c - 2,
    close: c,
    timestamp: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
  }));
}

/** Minimal valid TicketLogicBody for evaluate() tests */
function baseBody(overrides: Partial<TicketLogicBody> = {}): TicketLogicBody {
  return {
    universe: { asset_class: "equity" },
    timeframe: "1d",
    direction: "long",
    indicators: [
      { id: "rsi14", type: "rsi", params: { period: 14 } },
    ],
    entry: {
      conditions: [
        // always true: close > 0
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 0 } },
      ],
      sizing: { method: "fixed_notional", value: 500 },
    },
    exit: {
      take_profit: { type: "binary", op: "+", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 20 } },
      sl_method: { type: "pct_of_entry", value: 0.05 },
    },
    ...overrides,
  };
}

// ── Backward compatibility ────────────────────────────────────────────────────

describe("backward compatibility — plain Condition in arrays", () => {
  it("evaluate fires when all plain conditions hold (implicit AND)", () => {
    // 30 bars of rising price to warm up RSI; pick a bar well past warmup
    const bars = makeBars(Array.from({ length: 30 }, (_, i) => 50 + i));
    const logic = baseBody({
      entry: {
        conditions: [
          { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 0 } },
          { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 60 } },
        ],
        sizing: { method: "fixed_notional", value: 500 },
      },
    });
    const signals = evaluate(logic, bars);
    // bars where close > 60: index 10 onward (close=61...). Must have at least one.
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(bars[s.bar_index].close).toBeGreaterThan(60);
    }
  });
});

// ── OR node ──────────────────────────────────────────────────────────────────

describe("OR compound node", () => {
  it("fires when the first child is true and second is false", () => {
    const bars = makeBars([100]);
    const indicators = computeAllIndicators([], bars);

    const orNode: ConditionNode = {
      type: "or",
      children: [
        // true: close > 90
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 90 } },
        // false: close > 200
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 200 } },
      ],
    };

    const checker = buildExitConditionChecker([orNode], bars, indicators);
    expect(checker(0)).toBe(true);
  });

  it("fires when the second child is true and first is false", () => {
    const bars = makeBars([100]);
    const indicators = computeAllIndicators([], bars);

    const orNode: ConditionNode = {
      type: "or",
      children: [
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 200 } },
        { op: "lt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 110 } },
      ],
    };

    const checker = buildExitConditionChecker([orNode], bars, indicators);
    expect(checker(0)).toBe(true);
  });

  it("does not fire when all children are false", () => {
    const bars = makeBars([100]);
    const indicators = computeAllIndicators([], bars);

    const orNode: ConditionNode = {
      type: "or",
      children: [
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 200 } },
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 300 } },
      ],
    };

    const checker = buildExitConditionChecker([orNode], bars, indicators);
    expect(checker(0)).toBe(false);
  });
});

// ── AND node ──────────────────────────────────────────────────────────────────

describe("AND compound node", () => {
  it("fires only when all children are true", () => {
    const bars = makeBars([100]);
    const indicators = computeAllIndicators([], bars);

    const andNode: ConditionNode = {
      type: "and",
      children: [
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 90 } },
        { op: "lt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 110 } },
      ],
    };

    const checker = buildExitConditionChecker([andNode], bars, indicators);
    expect(checker(0)).toBe(true);
  });

  it("does not fire when one child is false", () => {
    const bars = makeBars([100]);
    const indicators = computeAllIndicators([], bars);

    const andNode: ConditionNode = {
      type: "and",
      children: [
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 90 } },
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 200 } },
      ],
    };

    const checker = buildExitConditionChecker([andNode], bars, indicators);
    expect(checker(0)).toBe(false);
  });
});

// ── NOT node ─────────────────────────────────────────────────────────────────

describe("NOT compound node", () => {
  it("inverts a true condition to false", () => {
    const bars = makeBars([100]);
    const indicators = computeAllIndicators([], bars);

    const notNode: ConditionNode = {
      type: "not",
      child: { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 90 } },
    };

    const checker = buildExitConditionChecker([notNode], bars, indicators);
    expect(checker(0)).toBe(false);
  });

  it("inverts a false condition to true", () => {
    const bars = makeBars([100]);
    const indicators = computeAllIndicators([], bars);

    const notNode: ConditionNode = {
      type: "not",
      child: { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 200 } },
    };

    const checker = buildExitConditionChecker([notNode], bars, indicators);
    expect(checker(0)).toBe(true);
  });
});

// ── Nested compound nodes ─────────────────────────────────────────────────────

describe("nested compound nodes", () => {
  it("AND within OR: fires when inner AND is true", () => {
    const bars = makeBars([100]);
    const indicators = computeAllIndicators([], bars);

    // (close > 200) OR (close > 90 AND close < 110)
    const node: ConditionNode = {
      type: "or",
      children: [
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 200 } },
        {
          type: "and",
          children: [
            { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 90 } },
            { op: "lt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 110 } },
          ],
        },
      ],
    };

    const checker = buildExitConditionChecker([node], bars, indicators);
    expect(checker(0)).toBe(true);
  });

  it("NOT within AND: AND fires when leaf is true and NOT(false) is true", () => {
    const bars = makeBars([100]);
    const indicators = computeAllIndicators([], bars);

    // close > 90 AND NOT(close > 200)
    const node: ConditionNode = {
      type: "and",
      children: [
        { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 90 } },
        { type: "not", child: { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 200 } } },
      ],
    };

    const checker = buildExitConditionChecker([node], bars, indicators);
    expect(checker(0)).toBe(true);
  });
});

// ── regime_filter as compound node ───────────────────────────────────────────

describe("regime_filter as compound ConditionNode", () => {
  it("blocks entry when compound regime_filter is false", () => {
    const bars = makeBars(Array.from({ length: 30 }, (_, i) => 50 + i));
    const logic = baseBody({
      regime_filter: {
        type: "and",
        children: [
          // always true
          { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 0 } },
          // always false
          { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 9999 } },
        ],
      },
    });
    expect(evaluate(logic, bars)).toHaveLength(0);
  });

  it("allows entry when compound regime_filter is true", () => {
    const bars = makeBars(Array.from({ length: 30 }, (_, i) => 50 + i));
    const logic = baseBody({
      regime_filter: {
        type: "or",
        children: [
          { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 9999 } },
          { op: "gt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 0 } },
        ],
      },
    });
    expect(evaluate(logic, bars).length).toBeGreaterThan(0);
  });
});

// ── Zod schema ───────────────────────────────────────────────────────────────

const baseSchemaBody = {
  universe: { asset_class: "equity" },
  timeframe: "5m",
  direction: "long",
  indicators: [{ id: "r", type: "rsi", params: { period: 14 } }],
  entry: {
    conditions: [
      { op: "gt", left: { type: "indicator", id: "r", bar_offset: 0 }, right: { type: "constant", value: 50 } },
    ],
    sizing: { method: "fixed_notional", value: 200 },
  },
  exit: {
    take_profit: { type: "constant", value: 9999 },
    sl_method: { type: "pct_of_entry", value: 0.01 },
  },
} as const;

describe("parseTicketLogicBody — 080D compound condition schema", () => {
  it("accepts plain leaf Condition (backward compat)", () => {
    expect(() => parseTicketLogicBody(baseSchemaBody)).not.toThrow();
  });

  it("accepts OR compound node in entry.conditions", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemaBody,
        entry: {
          ...baseSchemaBody.entry,
          conditions: [
            {
              type: "or",
              children: [
                { op: "gt", left: { type: "indicator", id: "r", bar_offset: 0 }, right: { type: "constant", value: 50 } },
                { op: "lt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 100 } },
              ],
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("accepts AND compound node in regime_filter", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemaBody,
        regime_filter: {
          type: "and",
          children: [
            { op: "gt", left: { type: "indicator", id: "r", bar_offset: 0 }, right: { type: "constant", value: 50 } },
            { op: "lt", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 100 } },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("accepts NOT compound node", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemaBody,
        entry: {
          ...baseSchemaBody.entry,
          conditions: [
            {
              type: "not",
              child: { op: "gt", left: { type: "indicator", id: "r", bar_offset: 0 }, right: { type: "constant", value: 70 } },
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("accepts nested compound (AND within OR)", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemaBody,
        entry: {
          ...baseSchemaBody.entry,
          conditions: [
            {
              type: "or",
              children: [
                { op: "gt", left: { type: "constant", value: 1 }, right: { type: "constant", value: 0 } },
                {
                  type: "and",
                  children: [
                    { op: "gt", left: { type: "indicator", id: "r", bar_offset: 0 }, right: { type: "constant", value: 50 } },
                    { op: "lt", left: { type: "indicator", id: "r", bar_offset: 0 }, right: { type: "constant", value: 70 } },
                  ],
                },
              ],
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("rejects AND node with empty children array", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemaBody,
        entry: {
          ...baseSchemaBody.entry,
          conditions: [
            { type: "and", children: [] },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects OR node with empty children array", () => {
    expect(() =>
      parseTicketLogicBody({
        ...baseSchemaBody,
        entry: {
          ...baseSchemaBody.entry,
          conditions: [
            { type: "or", children: [] },
          ],
        },
      }),
    ).toThrow();
  });
});
