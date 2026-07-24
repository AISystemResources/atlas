/**
 * Tests for the tunable-params helpers — Sprint 053e + 059 + 060B.
 *
 * Tunables now live INSIDE each TicketLogicBody (body.tunable_parameters)
 * rather than in a hardcoded registry. These tests verify:
 *   - readByPath / setByPath traversal correctness
 *   - applyParameterChanges reads the body's own tunables (no global registry)
 *   - The seed's tunables resolve to the correct values in the body
 */

import {
  applyParameterChanges,
  getTunables,
  readByPath,
  setByPath,
} from "@/lib/strategies/tunable-params";
import { EDMUND_S1_LONG_V2 } from "@/lib/strategies/seeds";

describe("getTunables reads from body.tunable_parameters", () => {
  it("returns the embedded tunables on EDMUND_S1_LONG_V2", () => {
    const tunables = getTunables(EDMUND_S1_LONG_V2);
    const names = tunables.map((t) => t.name);
    expect(names).toEqual([
      "entry_buffer_points",
      "stop_buffer_points",
      "notional_per_trade",
    ]);
  });

  it("returns [] when the body has no tunable_parameters field", () => {
    const bare = { ...EDMUND_S1_LONG_V2, tunable_parameters: undefined };
    expect(getTunables(bare)).toEqual([]);
  });

  it.each([
    ["entry_buffer_points", 3],
    ["stop_buffer_points", 3],
    ["notional_per_trade", 200],
  ])("tunable '%s' resolves to %s via its declared path", (name, expected) => {
    const tunables = getTunables(EDMUND_S1_LONG_V2);
    const t = tunables.find((x) => x.name === name);
    expect(t).toBeDefined();
    expect(readByPath(EDMUND_S1_LONG_V2, t!.path)).toBe(expected);
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

describe("applyParameterChanges (body-driven)", () => {
  it("returns a new body with one tunable updated", () => {
    const result = applyParameterChanges(EDMUND_S1_LONG_V2, [
      { name: "entry_buffer_points", proposed_value: 5 },
    ]);
    const tunable = getTunables(EDMUND_S1_LONG_V2).find(
      (t) => t.name === "entry_buffer_points",
    )!;
    expect(readByPath(result, tunable.path)).toBe(5);
  });

  it("does not mutate the input body", () => {
    const before = JSON.stringify(EDMUND_S1_LONG_V2);
    applyParameterChanges(EDMUND_S1_LONG_V2, [
      { name: "stop_buffer_points", proposed_value: 6 },
    ]);
    expect(JSON.stringify(EDMUND_S1_LONG_V2)).toBe(before);
  });

  it("applies multiple changes simultaneously", () => {
    const result = applyParameterChanges(EDMUND_S1_LONG_V2, [
      { name: "entry_buffer_points", proposed_value: 4 },
      { name: "notional_per_trade", proposed_value: 500 },
    ]);
    const tunables = getTunables(EDMUND_S1_LONG_V2);
    expect(
      readByPath(result, tunables.find((t) => t.name === "entry_buffer_points")!.path),
    ).toBe(4);
    expect(
      readByPath(result, tunables.find((t) => t.name === "notional_per_trade")!.path),
    ).toBe(500);
  });

  it("throws for an unknown tunable name (not declared in body)", () => {
    expect(() =>
      applyParameterChanges(EDMUND_S1_LONG_V2, [
        { name: "made_up_param", proposed_value: 99 },
      ]),
    ).toThrow(/unknown tunable/);
  });

  it("works on a strategy whose body declares custom tunables (no global registry)", () => {
    const customStrategy = {
      ...EDMUND_S1_LONG_V2,
      tunable_parameters: [
        {
          name: "my_custom_thing",
          path: ["entry", "sizing", "value"],
          description: "Custom tunable",
        },
      ],
    };
    const result = applyParameterChanges(customStrategy, [
      { name: "my_custom_thing", proposed_value: 999 },
    ]);
    expect(readByPath(result, ["entry", "sizing", "value"])).toBe(999);
  });
});
