/**
 * Sprint 053.1 — ratchet (clampProposedChange) unit tests.
 *
 * Pure helper, no LLM. Locks down:
 *   1. step cap (per-promote max_step_pct)
 *   2. global default when tunable doesn't declare its own
 *   3. min/max bounds applied after step
 *   4. no-clamp passthrough preserves was_clamped=false
 *   5. zero / non-finite current_value falls back to bounds-only
 */

import {
  DEFAULT_MAX_STEP_PCT,
  clampProposedChange,
  effectiveMaxStepPct,
} from "@/lib/strategies/tunable-params";
import type { TunableParameter } from "@/lib/strategies/types";

const base: TunableParameter = {
  name: "notional",
  path: ["entry", "sizing", "value"],
  description: "dollars per trade",
};

describe("Sprint 053.1 — clampProposedChange", () => {
  it("global default is 25%", () => {
    expect(DEFAULT_MAX_STEP_PCT).toBe(0.25);
    expect(effectiveMaxStepPct(base)).toBe(0.25);
  });

  it("passes through when proposal is within cap", () => {
    const r = clampProposedChange(base, 200, 220);
    expect(r.applied_value).toBe(220);
    expect(r.was_clamped).toBe(false);
    expect(r.clamp_reason).toBe("");
    expect(r.original_proposed_value).toBe(220);
  });

  it("clamps oversized upward move to current + cap (default 25%)", () => {
    const r = clampProposedChange(base, 200, 500); // +150% asked
    expect(r.applied_value).toBe(250); // 200 + 25%
    expect(r.was_clamped).toBe(true);
    expect(r.clamp_reason).toBe("step");
    expect(r.original_proposed_value).toBe(500);
  });

  it("clamps oversized downward move symmetrically", () => {
    const r = clampProposedChange(base, 200, 50); // -75% asked
    expect(r.applied_value).toBe(150); // 200 - 25%
    expect(r.was_clamped).toBe(true);
    expect(r.clamp_reason).toBe("step");
  });

  it("respects per-tunable max_step_pct override", () => {
    const aggressive: TunableParameter = { ...base, max_step_pct: 0.5 };
    const r = clampProposedChange(aggressive, 200, 500);
    expect(r.applied_value).toBe(300); // 200 + 50%
    expect(r.was_clamped).toBe(true);
  });

  it("applies max bound after ratchet (max wins)", () => {
    const bounded: TunableParameter = { ...base, max: 220 };
    const r = clampProposedChange(bounded, 200, 500); // step → 250, max → 220
    expect(r.applied_value).toBe(220);
    expect(r.was_clamped).toBe(true);
    expect(r.clamp_reason).toBe("max");
  });

  it("applies min bound when ratcheted value still below floor", () => {
    const bounded: TunableParameter = { ...base, min: 180 };
    const r = clampProposedChange(bounded, 200, 50); // step → 150, min → 180
    expect(r.applied_value).toBe(180);
    expect(r.was_clamped).toBe(true);
    expect(r.clamp_reason).toBe("min");
  });

  it("when current is 0, skips ratchet (no pct anchor) and applies bounds only", () => {
    const bounded: TunableParameter = { ...base, min: -10, max: 10 };
    const r = clampProposedChange(bounded, 0, 50);
    expect(r.applied_value).toBe(10);
    expect(r.was_clamped).toBe(true);
    expect(r.clamp_reason).toBe("max");
  });

  it("handles negative current values via abs() anchor", () => {
    const r = clampProposedChange(base, -100, -300); // |delta|=200, cap=25
    expect(r.applied_value).toBe(-125);
    expect(r.was_clamped).toBe(true);
    expect(r.clamp_reason).toBe("step");
  });

  it("no-op clamp when proposal exactly equals current", () => {
    const r = clampProposedChange(base, 200, 200);
    expect(r.applied_value).toBe(200);
    expect(r.was_clamped).toBe(false);
  });
});
