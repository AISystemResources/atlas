/**
 * Random parameter proposer — Sprint 042 ablation control arm.
 *
 * The LLM-based reviewer (review-backtest.ts) reads outcomes and proposes
 * informed parameter changes. This module is its experimental control: it
 * picks tunables at random and perturbs each by a uniform random fraction
 * of its per-promote ratchet bound. Same output shape, same downstream
 * clamping, no reasoning.
 *
 * The scientific question this control answers: "Does LLM reasoning over
 * trade outcomes produce better promotions than random walk within the
 * same ratchet bounds?"
 *
 * Determinism: callers may pass a seeded RNG. Default uses Math.random.
 */

import { readByPath, getTunables, clampProposedChange, effectiveMaxStepPct } from "./tunable-params";
import type { TicketLogicBody, TunableParameter } from "./types";
import type { ProposedChangeAttribution } from "./review-backtest";

export interface RandomProposerOptions {
  /** How many parameters to perturb (default 2; clamped to [1, tunables.length]). */
  k?: number;
  /** Optional [0, 1) RNG for reproducibility. */
  rng?: () => number;
}

export interface RandomProposalResult {
  proposed_changes: Array<{
    name: string;
    current_value: number;
    proposed_value: number;
    reason: string;
    supporting_trade_indices: number[];
  }>;
  clamp_by_change: Record<string, ProposedChangeAttribution>;
}

function defaultRng(): () => number {
  return Math.random;
}

/**
 * Pick k distinct tunables (or all of them if k >= length).
 */
function sampleTunables(
  tunables: TunableParameter[],
  k: number,
  rng: () => number,
): TunableParameter[] {
  if (k >= tunables.length) return [...tunables];
  const pool = [...tunables];
  const picked: TunableParameter[] = [];
  while (picked.length < k && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

/**
 * For one tunable, pick a uniform random target in [current * (1 - step), current * (1 + step)].
 * If current is 0 or non-finite, fall back to ±1 within bounds.
 */
function perturb(
  tunable: TunableParameter,
  current_value: number,
  rng: () => number,
): number {
  const step = effectiveMaxStepPct(tunable);
  if (Number.isFinite(current_value) && current_value !== 0) {
    const delta = (rng() * 2 - 1) * Math.abs(current_value) * step;
    return current_value + delta;
  }
  // Fallback for zero/non-finite anchors. Bounds will catch anything wild.
  return current_value + (rng() * 2 - 1);
}

/**
 * Propose k random parameter changes for a strategy body.
 *
 * Output mirrors `reviewBacktest.proposed_changes` shape so the downstream
 * pipeline (applyParameterChanges, runAbForwardTest) is identical to the
 * LLM arm — the ablation switch is pure substitution.
 */
export function proposeRandomChanges(
  body: TicketLogicBody,
  options: RandomProposerOptions = {},
): RandomProposalResult {
  const rng = options.rng ?? defaultRng();
  const k = Math.max(1, options.k ?? 2);
  const tunables = getTunables(body);

  if (tunables.length === 0) {
    return { proposed_changes: [], clamp_by_change: {} };
  }

  const picked = sampleTunables(tunables, Math.min(k, tunables.length), rng);
  const proposed_changes: RandomProposalResult["proposed_changes"] = [];
  const clamp_by_change: Record<string, ProposedChangeAttribution> = {};

  for (const tunable of picked) {
    const current = readByPath(body, tunable.path);
    if (typeof current !== "number") continue;

    const target = perturb(tunable, current, rng);
    const clamped = clampProposedChange(tunable, current, target);

    proposed_changes.push({
      name: tunable.name,
      current_value: current,
      proposed_value: clamped.applied_value,
      reason: "random control arm (uniform within ratchet bounds)",
      supporting_trade_indices: [],
    });
    clamp_by_change[tunable.name] = {
      original_proposed_value: clamped.original_proposed_value,
      applied_value: clamped.applied_value,
      was_clamped: clamped.was_clamped,
      clamp_reason: clamped.clamp_reason,
      max_step_pct: effectiveMaxStepPct(tunable),
    };
  }

  return { proposed_changes, clamp_by_change };
}
