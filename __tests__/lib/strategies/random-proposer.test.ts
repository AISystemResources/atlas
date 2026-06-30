/**
 * Sprint 042 — random proposer (control arm) unit tests.
 *
 * Locks down:
 *   1. empty tunables → empty proposal, no crash
 *   2. proposed value stays within ratchet bounds
 *   3. respects k (number of changes)
 *   4. seeded rng → reproducible output
 *   5. output shape mirrors reviewBacktest.proposed_changes
 */

import { proposeRandomChanges } from "@/lib/strategies/random-proposer";
import type { TicketLogicBody } from "@/lib/strategies/types";

function bodyWith(tunables: TicketLogicBody["tunable_parameters"]): TicketLogicBody {
  return {
    universe: { asset_class: "index" },
    timeframe: "5m",
    direction: "long",
    indicators: [],
    entry: { conditions: [], sizing: { method: "fixed_notional", value: 200 } },
    exit: { stop_loss: { type: "constant", value: 0 } },
    tunable_parameters: tunables,
  } as unknown as TicketLogicBody;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Sprint 042 — proposeRandomChanges", () => {
  it("returns empty when body has no tunables", () => {
    const body = bodyWith(undefined);
    const result = proposeRandomChanges(body, { k: 2, rng: seeded(1) });
    expect(result.proposed_changes).toEqual([]);
    expect(result.clamp_by_change).toEqual({});
  });

  it("proposed value stays within current ±max_step_pct (default 25%)", () => {
    const body = bodyWith([
      {
        name: "notional",
        path: ["entry", "sizing", "value"],
        description: "dollars per trade",
      },
    ]);
    for (let seed = 1; seed < 50; seed++) {
      const result = proposeRandomChanges(body, { k: 1, rng: seeded(seed) });
      expect(result.proposed_changes).toHaveLength(1);
      const c = result.proposed_changes[0];
      const min = c.current_value * 0.75;
      const max = c.current_value * 1.25;
      expect(c.proposed_value).toBeGreaterThanOrEqual(min);
      expect(c.proposed_value).toBeLessThanOrEqual(max);
    }
  });

  it("respects tunable.min / tunable.max bounds", () => {
    const body = bodyWith([
      {
        name: "notional",
        path: ["entry", "sizing", "value"],
        description: "dollars per trade",
        min: 195,
        max: 205,
      },
    ]);
    for (let seed = 1; seed < 50; seed++) {
      const result = proposeRandomChanges(body, { k: 1, rng: seeded(seed) });
      const c = result.proposed_changes[0];
      expect(c.proposed_value).toBeGreaterThanOrEqual(195);
      expect(c.proposed_value).toBeLessThanOrEqual(205);
    }
  });

  it("k caps the number of proposals", () => {
    const body = bodyWith([
      { name: "a", path: ["entry", "sizing", "value"], description: "" },
    ]);
    const result = proposeRandomChanges(body, { k: 5, rng: seeded(1) });
    expect(result.proposed_changes).toHaveLength(1); // only 1 tunable available
  });

  it("seeded rng produces reproducible output", () => {
    const body = bodyWith([
      { name: "notional", path: ["entry", "sizing", "value"], description: "" },
    ]);
    const a = proposeRandomChanges(body, { k: 1, rng: seeded(42) });
    const b = proposeRandomChanges(body, { k: 1, rng: seeded(42) });
    expect(a.proposed_changes[0].proposed_value).toBe(b.proposed_changes[0].proposed_value);
  });

  it("output shape matches reviewBacktest proposed_changes contract", () => {
    const body = bodyWith([
      { name: "notional", path: ["entry", "sizing", "value"], description: "" },
    ]);
    const result = proposeRandomChanges(body, { k: 1, rng: seeded(1) });
    const c = result.proposed_changes[0];
    expect(c).toHaveProperty("name");
    expect(c).toHaveProperty("current_value");
    expect(c).toHaveProperty("proposed_value");
    expect(c).toHaveProperty("reason");
    expect(c).toHaveProperty("supporting_trade_indices");
    expect(Array.isArray(c.supporting_trade_indices)).toBe(true);

    const attr = result.clamp_by_change[c.name];
    expect(attr).toHaveProperty("original_proposed_value");
    expect(attr).toHaveProperty("applied_value");
    expect(attr).toHaveProperty("was_clamped");
    expect(attr).toHaveProperty("clamp_reason");
    expect(attr).toHaveProperty("max_step_pct");
  });
});
