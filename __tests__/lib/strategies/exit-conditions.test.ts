/**
 * Sprint 080A — exit.conditions[] unit tests.
 *
 * Covers:
 *   1. No exit_conditions → pass-through (existing behaviour unchanged)
 *   2. Single condition fires on a specific bar → position closed there
 *   3. Multiple conditions — whichever fires first wins
 *   4. Condition never fires → falls through to TP / SL / time-stop
 *   5. SL hit on same bar as exit_condition → SL wins (conservative bias)
 *   6. Zod schema: accepts body with exit_conditions, rejects body with none of stop_loss / sl_method / exit_conditions
 */

import { simulateExit } from "@/lib/backtest-ticket/simulate-exit";
import { buildExitConditionChecker } from "@/lib/strategies/evaluate";
import { parseTicketLogicBody } from "@/lib/strategies/schema";
import type { Bar } from "@/lib/strategies/indicators";
import type { Condition } from "@/lib/strategies/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBar(
  close: number,
  opts: { open?: number; high?: number; low?: number; timestamp?: string } = {},
): Bar {
  return {
    open: opts.open ?? close,
    high: opts.high ?? close + 1,
    low: opts.low ?? close - 1,
    close,
    timestamp: opts.timestamp ?? "2024-01-02T10:00:00Z",
  };
}

/** Fake indicator array: value[i] = i (so we can say "fires when indicator > threshold"). */
function fakeIndicators(length: number): Record<string, (number | null)[]> {
  return {
    fake: Array.from({ length }, (_, i) => i as number | null),
  };
}

// Condition: fake indicator at bar_offset 0 > threshold
function rsiAboveCondition(threshold: number): Condition {
  return {
    op: "gt",
    left: { type: "indicator", id: "fake", bar_offset: 0 },
    right: { type: "constant", value: threshold },
  };
}

function rsiBelowCondition(threshold: number): Condition {
  return {
    op: "lt",
    left: { type: "indicator", id: "fake", bar_offset: 0 },
    right: { type: "constant", value: threshold },
  };
}

// ── Tests: buildExitConditionChecker ─────────────────────────────────────────

describe("buildExitConditionChecker", () => {
  const bars = [makeBar(100), makeBar(101), makeBar(102), makeBar(103)];
  const indicators = fakeIndicators(bars.length); // values: 0, 1, 2, 3

  it("returns false on every bar when conditions is empty", () => {
    const checker = buildExitConditionChecker([], bars, indicators);
    expect(checker(0)).toBe(false);
    expect(checker(3)).toBe(false);
  });

  it("fires when single condition is true at bar index", () => {
    // fake[2] = 2 > 1.5 → true at bar 2
    const checker = buildExitConditionChecker([rsiAboveCondition(1.5)], bars, indicators);
    expect(checker(0)).toBe(false); // fake[0]=0 > 1.5 → false
    expect(checker(1)).toBe(false); // fake[1]=1 > 1.5 → false
    expect(checker(2)).toBe(true);  // fake[2]=2 > 1.5 → true
    expect(checker(3)).toBe(true);
  });

  it("returns true if ANY condition fires (OR logic across conditions)", () => {
    // condition A: fake > 10 (never fires)
    // condition B: fake > 1.5 (fires at bar 2)
    const checker = buildExitConditionChecker(
      [rsiAboveCondition(10), rsiAboveCondition(1.5)],
      bars,
      indicators,
    );
    expect(checker(1)).toBe(false);
    expect(checker(2)).toBe(true);
  });

  it("returns false (not throws) on warmup / out-of-bounds bar index", () => {
    const checker = buildExitConditionChecker([rsiAboveCondition(0)], bars, indicators);
    expect(() => checker(-1)).not.toThrow();
    expect(checker(-1)).toBe(false);
  });
});

// ── Tests: simulateExit integration with exitConditionChecker ────────────────

describe("simulateExit — exit_conditions", () => {
  // 5-bar series, all on the same day
  const DAY = "2024-01-02";
  const bars: Bar[] = [
    makeBar(100, { timestamp: `${DAY}T09:31:00Z` }),
    makeBar(101, { timestamp: `${DAY}T09:36:00Z` }),
    makeBar(102, { timestamp: `${DAY}T09:41:00Z` }),
    makeBar(103, { timestamp: `${DAY}T09:46:00Z` }),
    makeBar(104, { timestamp: `${DAY}T09:51:00Z` }),
  ];

  const baseInput = {
    entryBarIndex: 0,
    entryPrice: 100,
    takeProfitPrice: 200,    // unreachable
    stopLossPrice: 50,       // unreachable
    direction: "long" as const,
    bars,
  };

  it("no checker → falls through to open_at_end", () => {
    const result = simulateExit(baseInput);
    expect(result.exitReason).toBe("open_at_end");
    expect(result.exitBarIndex).toBe(4);
  });

  it("checker fires at bar 2 → exit_condition at bar 2 with bar close", () => {
    // always-false until bar 2
    let calls = 0;
    const checker = (i: number) => { calls++; return i === 2; };
    const result = simulateExit({ ...baseInput, exitConditionChecker: checker });
    expect(result.exitReason).toBe("exit_condition");
    expect(result.exitBarIndex).toBe(2);
    expect(result.exitPrice).toBe(bars[2].close); // 102
    expect(calls).toBeGreaterThan(0);
  });

  it("checker fires at bar 3 → exits at bar 3, not later", () => {
    const result = simulateExit({
      ...baseInput,
      exitConditionChecker: (i) => i === 3,
    });
    expect(result.exitReason).toBe("exit_condition");
    expect(result.exitBarIndex).toBe(3);
  });

  it("SL hit wins over exit_condition on the same bar (conservative bias)", () => {
    // SL at 101.5 — bar 1 low is 100 (≤ 101.5), so SL fires on bar 1
    // exit condition also fires on bar 1
    const result = simulateExit({
      ...baseInput,
      stopLossPrice: 101.5, // bar[1].low = 100 ≤ 101.5
      exitConditionChecker: () => true, // fires every bar
    });
    expect(result.exitReason).toBe("sl_hit");
    expect(result.exitBarIndex).toBe(1);
  });

  it("TP hit wins over exit_condition (TP checked after exit_condition)", () => {
    // TP at 101.5 — bar[1].high = 102 ≥ 101.5 → TP fires
    // exit condition fires on bar 2 only
    const result = simulateExit({
      ...baseInput,
      takeProfitPrice: 101.5,
      exitConditionChecker: (i) => i === 2,
    });
    // TP fires bar 1 before exit_condition's bar 2
    expect(result.exitReason).toBe("tp_hit");
    expect(result.exitBarIndex).toBe(1);
  });

  it("condition never fires → falls through to open_at_end", () => {
    const result = simulateExit({
      ...baseInput,
      exitConditionChecker: () => false,
    });
    expect(result.exitReason).toBe("open_at_end");
  });

  it("short direction: SL above entry still wins over exit_condition", () => {
    // SL at 101 — bar[1].high = 102 ≥ 101 → SL fires
    const result = simulateExit({
      ...baseInput,
      direction: "short",
      takeProfitPrice: 0,     // unreachable (short TP below entry)
      stopLossPrice: 101,     // bar[1].high = 102 ≥ 101
      exitConditionChecker: () => true,
    });
    expect(result.exitReason).toBe("sl_hit");
  });
});

// ── Tests: Zod schema ─────────────────────────────────────────────────────────

const minimalBody = {
  universe: { asset_class: "equity" },
  timeframe: "5m",
  direction: "long",
  indicators: [{ id: "rsi_14", type: "rsi", params: { period: 14 } }],
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

describe("parseTicketLogicBody — exit_conditions schema", () => {
  it("rejects body with no stop_loss, sl_method, or exit_conditions", () => {
    expect(() => parseTicketLogicBody(minimalBody)).toThrow();
  });

  it("accepts body with only exit_conditions (no stop_loss / sl_method)", () => {
    const body = {
      ...minimalBody,
      exit: {
        ...minimalBody.exit,
        exit_conditions: [
          { op: "lt", left: { type: "indicator", id: "rsi_14", bar_offset: 0 }, right: { type: "constant", value: 50 } },
        ],
      },
    };
    expect(() => parseTicketLogicBody(body)).not.toThrow();
  });

  it("accepts body with sl_method and exit_conditions together", () => {
    const body = {
      ...minimalBody,
      indicators: [
        { id: "rsi_14", type: "rsi", params: { period: 14 } },
        { id: "atr_14", type: "atr", params: { period: 14 } },
      ],
      exit: {
        ...minimalBody.exit,
        sl_method: { type: "atr_multiple", value: 1.5, atr_indicator_id: "atr_14" },
        exit_conditions: [
          { op: "lt", left: { type: "indicator", id: "rsi_14", bar_offset: 0 }, right: { type: "constant", value: 50 } },
        ],
      },
    };
    expect(() => parseTicketLogicBody(body)).not.toThrow();
  });

  it("rejects exit_conditions as an empty array (min(1) constraint)", () => {
    const body = {
      ...minimalBody,
      exit: { ...minimalBody.exit, exit_conditions: [] },
    };
    expect(() => parseTicketLogicBody(body)).toThrow();
  });
});
