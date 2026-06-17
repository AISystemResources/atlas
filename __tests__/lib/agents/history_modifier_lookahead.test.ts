/**
 * HARD GATE: Look-ahead guard test for the History Agent.
 *
 * The look-ahead guard is the #1 correctness invariant: the modifier must
 * NEVER be computed from trades executed AFTER as_of_date. Violations silently
 * inflate win_rate on backtest data and corrupt the A/B experiment.
 *
 * These tests mock @supabase/supabase-js so they run with zero I/O.
 */

const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockEqUserId = jest.fn();
const mockIs = jest.fn();
const mockLt = jest.fn();
const mockOrder = jest.fn();
const mockLimit = jest.fn();

// Build a chainable mock where each method returns the same object.
const chainable: Record<string, jest.Mock> = {};
chainable.select = mockSelect.mockReturnValue(chainable);
chainable.eq = mockEq.mockReturnValue(chainable);
chainable.is = mockIs.mockReturnValue(chainable);
chainable.lt = mockLt.mockReturnValue(chainable);
chainable.order = mockOrder.mockReturnValue(chainable);
chainable.limit = mockLimit.mockReturnValue(chainable);

const mockFrom = jest.fn().mockReturnValue(chainable);

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({ from: mockFrom })),
}));

import { computeHistoryModifier } from "@/lib/agents/nodes/history_modifier";

const AS_OF_DATE = "2026-01-15";

function makeTrade(realizedPnl: number, executedAt: string) {
  return { realized_pnl: realizedPnl, executed_at: executedAt };
}

// Top-level beforeEach applies to ALL describe blocks in this file
beforeEach(() => {
  jest.clearAllMocks();
  chainable.select = mockSelect.mockReturnValue(chainable);
  chainable.eq = mockEq.mockReturnValue(chainable);
  chainable.is = mockIs.mockReturnValue(chainable);
  chainable.lt = mockLt.mockReturnValue(chainable);
  chainable.order = mockOrder.mockReturnValue(chainable);
  chainable.limit = mockLimit.mockReturnValue(chainable);
  mockFrom.mockReturnValue(chainable);
});

describe("history_modifier — look-ahead guard", () => {

  it("passes as_of_date as the strict-less-than cutoff to Supabase", async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null });

    await computeHistoryModifier({
      userId: "user_1",
      asOfDate: AS_OF_DATE,
      baseConfidence: 0.7,
    });

    // The .lt() call must use the as_of_date value
    const ltCall = mockLt.mock.calls.find((c) => c[0] === "executed_at");
    expect(ltCall).toBeDefined();
    expect(ltCall![1]).toBe(AS_OF_DATE);
  });

  it("returns modifier=0 when no matching trades exist (cold-start)", async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null });

    const result = await computeHistoryModifier({
      userId: "user_1",
      asOfDate: AS_OF_DATE,
      baseConfidence: 0.7,
    });

    expect(result.n_trades).toBe(0);
    expect(result.modifier).toBe(0);
    expect(result.confidence_modified).toBeCloseTo(0.7);
  });

  it("returns modifier=0 when fewer than 5 trades exist (cold-start threshold)", async () => {
    const trades = [
      makeTrade(50, "2026-01-10"),
      makeTrade(30, "2026-01-11"),
      makeTrade(-20, "2026-01-12"),
      makeTrade(10, "2026-01-13"),
    ]; // 4 trades < 5 minimum
    mockLimit.mockResolvedValueOnce({ data: trades, error: null });

    const result = await computeHistoryModifier({
      userId: "user_1",
      asOfDate: AS_OF_DATE,
      baseConfidence: 0.6,
    });

    expect(result.n_trades).toBe(4);
    expect(result.modifier).toBe(0);
    expect(result.confidence_modified).toBeCloseTo(0.6);
  });

  it("computes positive modifier for win-heavy history", async () => {
    // 8 wins, 2 losses — win_rate=0.8, modifier = clamp(2*(0.8-0.5)*min(1,10/20), -0.15, 0.15)
    //                                              = clamp(2*0.3*0.5, ...) = clamp(0.3, ...) = 0.15
    const trades = [
      makeTrade(100, "2026-01-01"),
      makeTrade(50, "2026-01-02"),
      makeTrade(80, "2026-01-03"),
      makeTrade(30, "2026-01-04"),
      makeTrade(60, "2026-01-05"),
      makeTrade(20, "2026-01-06"),
      makeTrade(40, "2026-01-07"),
      makeTrade(10, "2026-01-08"),
      makeTrade(-30, "2026-01-09"),
      makeTrade(-20, "2026-01-10"),
    ];
    mockLimit.mockResolvedValueOnce({ data: trades, error: null });

    const result = await computeHistoryModifier({
      userId: "user_1",
      asOfDate: AS_OF_DATE,
      baseConfidence: 0.6,
    });

    expect(result.n_trades).toBe(10);
    expect(result.win_rate).toBeCloseTo(0.8);
    expect(result.modifier).toBeCloseTo(0.15);
    expect(result.confidence_modified).toBeCloseTo(0.75);
  });

  it("computes negative modifier for loss-heavy history", async () => {
    // 2 wins, 8 losses — win_rate=0.2, modifier = clamp(2*(0.2-0.5)*0.5, ...) = clamp(-0.3, ...) = -0.15
    const trades = [
      makeTrade(-100, "2026-01-01"),
      makeTrade(-50, "2026-01-02"),
      makeTrade(-80, "2026-01-03"),
      makeTrade(-30, "2026-01-04"),
      makeTrade(-60, "2026-01-05"),
      makeTrade(-20, "2026-01-06"),
      makeTrade(-40, "2026-01-07"),
      makeTrade(-10, "2026-01-08"),
      makeTrade(30, "2026-01-09"),
      makeTrade(20, "2026-01-10"),
    ];
    mockLimit.mockResolvedValueOnce({ data: trades, error: null });

    const result = await computeHistoryModifier({
      userId: "user_1",
      asOfDate: AS_OF_DATE,
      baseConfidence: 0.7,
    });

    expect(result.n_trades).toBe(10);
    expect(result.win_rate).toBeCloseTo(0.2);
    expect(result.modifier).toBeCloseTo(-0.15);
    expect(result.confidence_modified).toBeCloseTo(0.55);
  });

  it("clamps confidence_modified to [0, 1] range", async () => {
    // Base confidence 0.05 with -0.15 modifier would go below 0
    const trades = Array.from({ length: 10 }, (_, i) =>
      makeTrade(i < 2 ? 10 : -20, `2026-01-${String(i + 1).padStart(2, "0")}`),
    );
    mockLimit.mockResolvedValueOnce({ data: trades, error: null });

    const result = await computeHistoryModifier({
      userId: "user_1",
      asOfDate: AS_OF_DATE,
      baseConfidence: 0.05,
    });

    expect(result.confidence_modified).toBeGreaterThanOrEqual(0);
    expect(result.confidence_modified).toBeLessThanOrEqual(1);
  });

  it("scales modifier by min(1, n/20) — 20 trades gets full weight", async () => {
    // 20 trades: 16 wins, 4 losses — win_rate=0.8, n/20=1.0
    // modifier = clamp(2*(0.8-0.5)*1.0, ...) = clamp(0.6, ...) = 0.15
    const trades = Array.from({ length: 20 }, (_, i) =>
      makeTrade(i < 16 ? 50 : -20, `2026-01-${String(i + 1).padStart(2, "0")}`),
    );
    mockLimit.mockResolvedValueOnce({ data: trades, error: null });

    const result = await computeHistoryModifier({
      userId: "user_1",
      asOfDate: AS_OF_DATE,
      baseConfidence: 0.6,
    });

    expect(result.n_trades).toBe(20);
    expect(result.modifier).toBeCloseTo(0.15);
  });

  it("returns cold-start result when Supabase errors", async () => {
    mockLimit.mockResolvedValueOnce({
      data: null,
      error: { message: "connection error" },
    });

    const result = await computeHistoryModifier({
      userId: "user_1",
      asOfDate: AS_OF_DATE,
      baseConfidence: 0.7,
    });

    expect(result.modifier).toBe(0);
    expect(result.n_trades).toBe(0);
    expect(result.confidence_modified).toBeCloseTo(0.7);
  });

  it("passes user_id filter to Supabase query", async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null });

    await computeHistoryModifier({
      userId: "user_abc",
      asOfDate: AS_OF_DATE,
      baseConfidence: 0.5,
    });

    const eqCalls = mockEq.mock.calls;
    const userIdCall = eqCalls.find(
      (c) => c[0] === "user_id" && c[1] === "user_abc",
    );
    expect(userIdCall).toBeDefined();
  });
});

describe("history_modifier — disabled mode", () => {
  it("returns modifier=0 and passes through base confidence unchanged when disabled", async () => {
    const result = await computeHistoryModifier({
      userId: "user_1",
      asOfDate: AS_OF_DATE,
      baseConfidence: 0.73,
      enabled: false,
    });

    expect(result.modifier).toBe(0);
    expect(result.confidence_modified).toBeCloseTo(0.73);
    expect(result.enabled).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
