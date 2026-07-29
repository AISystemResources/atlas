/**
 * Multi-model distillation convergence — analysis primitives.
 *
 * Research question this apparatus supports: **given identical backtest
 * evidence delivered via the same MCP surface, do different LLMs
 * converge on the same distillation?**
 *
 * Convergence isn't a single number — it's a multi-axis property. This
 * module exposes the axes as pure functions so a caller (MCP tool,
 * writeup script, or unit test) can pick which ones matter and compose
 * a summary. All functions are deterministic; no LLM calls, no
 * side effects.
 *
 * The axes:
 *   1. Recommendation agreement — do the models even agree on the
 *      direction (promote / no_promote)?
 *   2. Parameter overlap (Jaccard) — do they target the same tunables?
 *   3. Direction agreement — for shared parameters, do they push the
 *      same way (tighten vs loosen)?
 *   4. Value proximity — for shared parameters with agreeing direction,
 *      how close are the proposed values (as a fraction of the
 *      current value)?
 *   5. Evidence overlap (Jaccard) — do they cite overlapping trades as
 *      the winning / losing evidence?
 *
 * Convergence on 1+2+3+4 = same optimisation. Convergence on 5 = same
 * reasoning path to that optimisation. They can dissociate — two models
 * can propose the same change from different evidence, or cite the same
 * trades and propose different fixes. Both are interesting.
 */

export interface ProposedChange {
  name: string;
  current_value: number;
  proposed_value: number;
  reason?: string;
  supporting_trade_ids?: string[];
  original_proposed_value?: number;
  was_clamped?: boolean;
  clamp_reason?: string;
  max_step_pct?: number | null;
}

export interface Insight {
  id: string;
  model: string;
  recommendation: string; // "promote" | "no_promote" (schema-level values)
  rationale: string | null;
  proposed_changes: ProposedChange[] | null;
  winning_trade_ids: string[] | null;
  losing_trade_ids: string[] | null;
  created_at: string;
}

export interface PerParamAgreement {
  parameter: string;
  a_current: number;
  a_proposed: number;
  b_proposed: number;
  same_direction: boolean; // both push same way from current
  value_distance: number; // |a_proposed - b_proposed| / |current| (0 = identical, > 0 = drift)
}

export interface PairwiseAgreement {
  model_a: string;
  model_b: string;
  recommendation_agreement: boolean;
  /**
   * Jaccard overlap on the sets of proposed-change parameter names.
   *
   * IMPORTANT: this is null (not 1) when BOTH insights proposed no
   * changes. Rationale: the mathematical convention `jaccard(∅, ∅) = 1`
   * inflates "tightest pair" reports on all-keep backtests — two models
   * that both declined to act haven't actually converged on any lever;
   * they've converged on abstaining. Consumers of the metric should
   * skip nulls when averaging.
   *
   * When ONE insight is empty and the other is non-empty, this is 0
   * (real disagreement — one model wants a change, the other doesn't).
   *
   * When both are non-empty, this is the standard Jaccard value in [0, 1].
   */
  parameter_overlap_jaccard: number | null;
  /** True iff both insights proposed zero parameter changes. */
  both_declined_to_change: boolean;
  shared_parameters: string[];
  per_param: PerParamAgreement[];
  trade_citation_jaccard: number; // 0..1 over union(winning ∪ losing)
}

export interface ConvergenceSummary {
  backtest_id: string;
  n_models: number;
  models: string[];
  n_pairs: number;
  /** How many of the n_pairs had at least one insight proposing a change. */
  n_actionable_pairs: number;
  // Aggregates across all pairs:
  mean_recommendation_agreement: number; // 0..1 (fraction of pairs that agree)
  /**
   * Mean parameter overlap across actionable pairs only. Null when all
   * pairs are both-declined (nothing to average). This prevents the
   * both-empty artefact from inflating headline convergence numbers on
   * unanimous-keep backtests.
   */
  mean_parameter_overlap: number | null;
  mean_value_distance: number | null;    // null if no pairs share any parameter
  mean_trade_citation_overlap: number;   // 0..1
  pairs: PairwiseAgreement[];
}

// ── Pure functions ────────────────────────────────────────────────────────────

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1; // by convention: both empty = perfect overlap
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

/**
 * Parameter-set overlap with the both-declined distinction. Returns null
 * when both sets are empty (see PairwiseAgreement.parameter_overlap_jaccard
 * for the reasoning). Trade citations still use plain Jaccard because
 * unanimous "no evidence cited" is a legitimate no-signal case.
 */
function parameterOverlap(a: Set<string>, b: Set<string>): number | null {
  if (a.size === 0 && b.size === 0) return null;
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

function paramMap(changes: ProposedChange[] | null): Map<string, ProposedChange> {
  const out = new Map<string, ProposedChange>();
  for (const c of changes ?? []) out.set(c.name, c);
  return out;
}

function sign(x: number): -1 | 0 | 1 {
  if (x > 0) return 1;
  if (x < 0) return -1;
  return 0;
}

export function computePairwiseAgreement(a: Insight, b: Insight): PairwiseAgreement {
  const paramsA = paramMap(a.proposed_changes);
  const paramsB = paramMap(b.proposed_changes);
  const setA = new Set(paramsA.keys());
  const setB = new Set(paramsB.keys());
  const shared = [...setA].filter((k) => setB.has(k));

  const perParam: PerParamAgreement[] = shared.map((name) => {
    const ca = paramsA.get(name)!;
    const cb = paramsB.get(name)!;
    const deltaA = ca.proposed_value - ca.current_value;
    const deltaB = cb.proposed_value - cb.current_value;
    const same_direction = sign(deltaA) !== 0 && sign(deltaA) === sign(deltaB);
    // Normalise by |current_value|; if current is 0, fall back to absolute delta.
    const denom = Math.abs(ca.current_value) || 1;
    const value_distance = Math.abs(ca.proposed_value - cb.proposed_value) / denom;
    return {
      parameter: name,
      a_current: ca.current_value,
      a_proposed: ca.proposed_value,
      b_proposed: cb.proposed_value,
      same_direction,
      value_distance,
    };
  });

  const tradesA = new Set<string>([
    ...(a.winning_trade_ids ?? []),
    ...(a.losing_trade_ids ?? []),
  ]);
  const tradesB = new Set<string>([
    ...(b.winning_trade_ids ?? []),
    ...(b.losing_trade_ids ?? []),
  ]);

  return {
    model_a: a.model,
    model_b: b.model,
    recommendation_agreement: a.recommendation === b.recommendation,
    parameter_overlap_jaccard: parameterOverlap(setA, setB),
    both_declined_to_change: setA.size === 0 && setB.size === 0,
    shared_parameters: shared,
    per_param: perParam,
    trade_citation_jaccard: jaccard(tradesA, tradesB),
  };
}

export function computeConvergenceSummary(
  backtestId: string,
  insights: Insight[],
): ConvergenceSummary {
  const uniqueModels = [...new Set(insights.map((i) => i.model))].sort();
  // One insight per model — take the most recent if a model posted more than one.
  const byModel = new Map<string, Insight>();
  for (const ins of insights.slice().sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    byModel.set(ins.model, ins);
  }
  const picked = uniqueModels.map((m) => byModel.get(m)!).filter(Boolean);

  const pairs: PairwiseAgreement[] = [];
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      pairs.push(computePairwiseAgreement(picked[i], picked[j]));
    }
  }

  const mean = (xs: number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

  const distances = pairs.flatMap((p) => p.per_param.map((x) => x.value_distance));
  const actionablePairs = pairs.filter((p) => !p.both_declined_to_change);
  const overlapValues = actionablePairs
    .map((p) => p.parameter_overlap_jaccard)
    .filter((v): v is number => v !== null);

  return {
    backtest_id: backtestId,
    n_models: picked.length,
    models: uniqueModels,
    n_pairs: pairs.length,
    n_actionable_pairs: actionablePairs.length,
    mean_recommendation_agreement: mean(pairs.map((p) => (p.recommendation_agreement ? 1 : 0))),
    mean_parameter_overlap: overlapValues.length === 0 ? null : mean(overlapValues),
    mean_value_distance: distances.length === 0 ? null : mean(distances),
    mean_trade_citation_overlap: mean(pairs.map((p) => p.trade_citation_jaccard)),
    pairs,
  };
}
