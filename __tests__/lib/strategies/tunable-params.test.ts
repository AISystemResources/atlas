/**
 * Tests for the tunable-params apply/read/set helpers — Sprint 053e + 059.
 *
 * These are the load-bearing deterministic pieces of the promotion flow:
 * if applyParameterChanges produces wrong bodies, the new ticket_logics rows
 * are wrong and the entire AI feedback loop is broken.
 *
 * After Sprint 059 the registry was migrated to v2 paths. The v1 body still
 * lives in seeds.ts for the evaluator parity test, but it's no longer the
 * active strategy and the tunable registry doesn't track v1 paths.
 */

import {
  STRATEGY_TUNABLES,
  applyParameterChanges,
  getTunablesForStrategy,
  readByPath,
  setByPath,
} from "@/lib/strategies/tunable-params";
import { SANDY_S1_LONG_V2 } from "@/lib/strategies/seeds";

describe("STRATEGY_TUNABLES — Sandy S1 v2 path correctness", () => {
  const tunables = STRATEGY_TUNABLES["sandy-s1-long"];

  it.each([
    ["entry_buffer_points", 3],
    ["stop_buffer_points", 3],
    ["notional_per_trade", 200],
  ])("path for '%s' resolves to %s in SANDY_S1_LONG_V2", (name, expected) => {
    const t = tunables.find((x) => x.name === name);
    expect(t).toBeDefined();
    const actual = readByPath(SANDY_S1_LONG_V2, t!.path);
    expect(actual).toBe(expected);
  });

  it("registry does NOT include v1-era tunables", () => {
    const names = tunables.map((t) => t.name);
    expect(names).not.toContain("rsi_regime_threshold");
    expect(names).not.toContain("entry_buffer_multiplier");
    expect(names).not.toContain("stop_loss_multiplier");
    expect(names).not.toContain("target_atr_multiple");
  });
});

describe("setByPath", () => {
  it("mutates a deeply-nested value", () => {
    const obj = { a: { b: { c: 1 } } };
    setByPath(obj, ["a", "b", "c"], 42);
    expect(obj.a.b.c).toBe(42);
  });

  it("throws when path is not navigable", () => {
    const obj = { a: { b: 1 } };
    expect(() => setByPath(obj, ["a", "x", "c"], 42)).toThrow(/not navigable/);
  });

  it("throws on empty path", () => {
    expect(() => setByPath({}, [], 1)).toThrow();
  });
});

describe("applyParameterChanges", () => {
  it("returns a new body with one tunable updated", () => {
    const result = applyParameterChanges(
      SANDY_S1_LONG_V2 as unknown as Record<string, unknown>,
      [{ name: "entry_buffer_points", proposed_value: 5 }],
      "sandy-s1-long",
    );
    const tunable = getTunablesForStrategy("sandy-s1-long").find(
      (t) => t.name === "entry_buffer_points",
    )!;
    expect(readByPath(result, tunable.path)).toBe(5);
  });

  it("does not mutate the input body", () => {
    const before = JSON.stringify(SANDY_S1_LONG_V2);
    applyParameterChanges(
      SANDY_S1_LONG_V2 as unknown as Record<string, unknown>,
      [{ name: "stop_buffer_points", proposed_value: 6 }],
      "sandy-s1-long",
    );
    expect(JSON.stringify(SANDY_S1_LONG_V2)).toBe(before);
  });

  it("applies multiple changes simultaneously", () => {
    const result = applyParameterChanges(
      SANDY_S1_LONG_V2 as unknown as Record<string, unknown>,
      [
        { name: "entry_buffer_points", proposed_value: 4 },
        { name: "notional_per_trade", proposed_value: 500 },
      ],
      "sandy-s1-long",
    );
    const tunables = getTunablesForStrategy("sandy-s1-long");
    expect(
      readByPath(result, tunables.find((t) => t.name === "entry_buffer_points")!.path),
    ).toBe(4);
    expect(
      readByPath(result, tunables.find((t) => t.name === "notional_per_trade")!.path),
    ).toBe(500);
  });

  it("throws for an unknown tunable name", () => {
    expect(() =>
      applyParameterChanges(
        SANDY_S1_LONG_V2 as unknown as Record<string, unknown>,
        [{ name: "made_up_param", proposed_value: 99 }],
        "sandy-s1-long",
      ),
    ).toThrow(/unknown tunable/);
  });

  it("throws for an unknown strategy", () => {
    expect(() =>
      applyParameterChanges(
        SANDY_S1_LONG_V2 as unknown as Record<string, unknown>,
        [{ name: "entry_buffer_points", proposed_value: 5 }],
        "no-such-strategy",
      ),
    ).toThrow(/unknown tunable/);
  });
});
