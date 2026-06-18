/**
 * Tests for the tunable-params apply/read/set helpers — Sprint 053e.
 *
 * These are the load-bearing deterministic pieces of the promotion flow:
 * if applyParameterChanges produces wrong bodies, the new ticket_logics rows
 * are wrong and the entire AI feedback loop is broken.
 */

import {
  STRATEGY_TUNABLES,
  applyParameterChanges,
  getTunablesForStrategy,
  readByPath,
  setByPath,
} from "@/lib/strategies/tunable-params";
import { SANDY_S1_LONG_V1 } from "@/lib/strategies/seeds";

describe("STRATEGY_TUNABLES — Sandy S1 path correctness", () => {
  const tunables = STRATEGY_TUNABLES["sandy-s1-long"];

  it.each([
    ["rsi_regime_threshold", 50],
    ["entry_buffer_multiplier", 1.0005],
    ["stop_loss_multiplier", 0.995],
    ["target_atr_multiple", 0.5],
    ["notional_per_trade", 200],
  ])("path for '%s' resolves to %s in SANDY_S1_LONG_V1", (name, expected) => {
    const t = tunables.find((x) => x.name === name);
    expect(t).toBeDefined();
    const actual = readByPath(SANDY_S1_LONG_V1, t!.path);
    expect(actual).toBe(expected);
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
      SANDY_S1_LONG_V1 as unknown as Record<string, unknown>,
      [{ name: "target_atr_multiple", proposed_value: 0.8 }],
      "sandy-s1-long",
    );
    const tunable = getTunablesForStrategy("sandy-s1-long").find(
      (t) => t.name === "target_atr_multiple",
    )!;
    expect(readByPath(result, tunable.path)).toBe(0.8);
  });

  it("does not mutate the input body", () => {
    const before = JSON.stringify(SANDY_S1_LONG_V1);
    applyParameterChanges(
      SANDY_S1_LONG_V1 as unknown as Record<string, unknown>,
      [{ name: "rsi_regime_threshold", proposed_value: 60 }],
      "sandy-s1-long",
    );
    expect(JSON.stringify(SANDY_S1_LONG_V1)).toBe(before);
  });

  it("applies multiple changes simultaneously", () => {
    const result = applyParameterChanges(
      SANDY_S1_LONG_V1 as unknown as Record<string, unknown>,
      [
        { name: "rsi_regime_threshold", proposed_value: 55 },
        { name: "notional_per_trade", proposed_value: 500 },
      ],
      "sandy-s1-long",
    );
    const tunables = getTunablesForStrategy("sandy-s1-long");
    expect(
      readByPath(result, tunables.find((t) => t.name === "rsi_regime_threshold")!.path),
    ).toBe(55);
    expect(
      readByPath(result, tunables.find((t) => t.name === "notional_per_trade")!.path),
    ).toBe(500);
  });

  it("throws for an unknown tunable name", () => {
    expect(() =>
      applyParameterChanges(
        SANDY_S1_LONG_V1 as unknown as Record<string, unknown>,
        [{ name: "made_up_param", proposed_value: 99 }],
        "sandy-s1-long",
      ),
    ).toThrow(/unknown tunable/);
  });

  it("throws for an unknown strategy", () => {
    expect(() =>
      applyParameterChanges(
        SANDY_S1_LONG_V1 as unknown as Record<string, unknown>,
        [{ name: "target_atr_multiple", proposed_value: 0.8 }],
        "no-such-strategy",
      ),
    ).toThrow(/unknown tunable/);
  });
});
