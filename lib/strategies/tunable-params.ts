/**
 * Tunable parameter helpers — Sprint 060B.
 *
 * As of Sprint 060, tunables live inside `TicketLogicBody.tunable_parameters`
 * (each strategy declares its own). This file used to host a hardcoded
 * registry keyed by strategy name; that registry was the wrong shape for
 * multi-tenant infrastructure where any user can create any strategy.
 *
 * The path-traversal helpers (readByPath, setByPath, applyParameterChanges)
 * remain here because they're generic to the body shape.
 */

import type { TicketLogicBody, TunableParameter } from "./types";

export type { TunableParameter } from "./types";

/**
 * Sprint 053.1: global ratchet floor. A tunable that doesn't declare its own
 * max_step_pct still gets a 25% per-promote cap so the safety story is
 * unconditional.
 */
export const DEFAULT_MAX_STEP_PCT = 0.25;

/** Return the tunables declared by a body, or [] if the body has none. */
export function getTunables(body: TicketLogicBody): TunableParameter[] {
  return body.tunable_parameters ?? [];
}

/**
 * Sprint 053.1: effective max_step_pct for a tunable — its own declaration
 * or the global floor.
 */
export function effectiveMaxStepPct(tunable: TunableParameter): number {
  return tunable.max_step_pct ?? DEFAULT_MAX_STEP_PCT;
}

export interface ClampResult {
  /** The value to actually persist. */
  applied_value: number;
  /** True iff applied_value !== proposed_value (for any reason). */
  was_clamped: boolean;
  /** What the LLM originally asked for. Always recorded for audit. */
  original_proposed_value: number;
  /** Free-text reason — "step", "min", "max", or "" if no clamp. */
  clamp_reason: "" | "step" | "min" | "max";
}

/**
 * Sprint 053.1: bound a single proposed parameter change.
 *
 * Order of operations:
 *   1. Ratchet: clip the move to ±(|current| * max_step_pct).
 *   2. Bounds: clip to [tunable.min, tunable.max] if declared.
 *
 * Edge case — current_value is 0 or non-finite: skip the ratchet step
 * (pct math has no anchor) and apply bounds only. Strategies whose tunables
 * pass through 0 should declare explicit min/max.
 */
export function clampProposedChange(
  tunable: TunableParameter,
  current_value: number,
  proposed_value: number,
): ClampResult {
  const step = effectiveMaxStepPct(tunable);
  let val = proposed_value;
  let reason: ClampResult["clamp_reason"] = "";

  if (Number.isFinite(current_value) && current_value !== 0) {
    const maxDelta = Math.abs(current_value) * step;
    const delta = val - current_value;
    if (Math.abs(delta) > maxDelta) {
      val = current_value + Math.sign(delta) * maxDelta;
      reason = "step";
    }
  }

  if (tunable.max !== undefined && val > tunable.max) {
    val = tunable.max;
    reason = "max";
  }
  if (tunable.min !== undefined && val < tunable.min) {
    val = tunable.min;
    reason = "min";
  }

  // Sprint 079H: defend against the floating-point boundary case where
  // val ends up bit-identical to the proposed value (e.g. a bounds-clamp
  // happens to land back on the original, or the step boundary is exactly
  // equal). The clamp_reason should mirror was_clamped — both true or
  // both false — never report a reason on a no-op clamp.
  const actuallyClamped = val !== proposed_value;
  return {
    applied_value: val,
    was_clamped: actuallyClamped,
    original_proposed_value: proposed_value,
    clamp_reason: actuallyClamped ? reason : "",
  };
}

/**
 * Read the current value of a tunable from a TicketLogicBody.
 * Returns undefined if any segment of the path is missing.
 */
export function readByPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Mutates `obj` in place: walks the path and sets the leaf to `value`.
 * Throws if any segment of the path is missing.
 */
export function setByPath(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  if (path.length === 0) throw new Error("setByPath: empty path");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]];
    if (next === null || next === undefined || typeof next !== "object") {
      throw new Error(
        `setByPath: path ${path.join(".")} not navigable at segment '${path[i]}'`,
      );
    }
    cur = next as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

/**
 * Deep-clones `body` and applies the proposed parameter changes. Returns the
 * new body. Throws if any change references an unknown tunable name OR if the
 * path can't be navigated in the current body.
 *
 * The tunable lookup is done against the body's own declared
 * `tunable_parameters`, NOT a global registry. This means each strategy is
 * self-describing — adding a new strategy never requires a code change here.
 */
export function applyParameterChanges<T extends TicketLogicBody>(
  body: T,
  changes: Array<{ name: string; proposed_value: number }>,
): T {
  const tunables = getTunables(body);
  const cloned = JSON.parse(JSON.stringify(body)) as T;
  for (const change of changes) {
    const tunable = tunables.find((t) => t.name === change.name);
    if (!tunable) {
      throw new Error(
        `applyParameterChanges: unknown tunable '${change.name}' (body declares: ${tunables.map((t) => t.name).join(", ") || "none"})`,
      );
    }
    setByPath(
      cloned as unknown as Record<string, unknown>,
      tunable.path,
      change.proposed_value,
    );
  }
  return cloned;
}
