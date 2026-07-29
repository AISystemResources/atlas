/**
 * Unit tests for the convergence primitives.
 *
 * The apparatus underpins the capstone research finding
 * (do different LLMs converge on the same distillation from identical
 * backtest evidence?), so the metric itself has to be trustworthy.
 * The tests below cover both the mechanical cases (empty / single /
 * disjoint) and the actual observed shape from Prod
 * (backtest a360ac86 — 3 models, identical `stop_buffer_points → 2.25`).
 */

import {
  computePairwiseAgreement,
  computeConvergenceSummary,
  type Insight,
} from "@/lib/mcp-atlas/insight-convergence";

function makeInsight(overrides: Partial<Insight>): Insight {
  return {
    id: overrides.id ?? "insight-x",
    model: overrides.model ?? "claude",
    recommendation: overrides.recommendation ?? "promote",
    rationale: overrides.rationale ?? null,
    proposed_changes: overrides.proposed_changes ?? [],
    winning_trade_ids: overrides.winning_trade_ids ?? [],
    losing_trade_ids: overrides.losing_trade_ids ?? [],
    created_at: overrides.created_at ?? "2026-07-01T00:00:00Z",
  };
}

describe("computePairwiseAgreement", () => {
  it("perfect convergence: identical proposals + citations", () => {
    const a = makeInsight({
      model: "claude",
      proposed_changes: [
        { name: "stop_buffer_points", current_value: 3, proposed_value: 2.25 },
      ],
      winning_trade_ids: ["t1", "t2"],
      losing_trade_ids: ["t3"],
    });
    const b = makeInsight({
      model: "llama",
      proposed_changes: [
        { name: "stop_buffer_points", current_value: 3, proposed_value: 2.25 },
      ],
      winning_trade_ids: ["t1", "t2"],
      losing_trade_ids: ["t3"],
    });
    const p = computePairwiseAgreement(a, b);
    expect(p.recommendation_agreement).toBe(true);
    expect(p.parameter_overlap_jaccard).toBe(1);
    expect(p.shared_parameters).toEqual(["stop_buffer_points"]);
    expect(p.per_param).toHaveLength(1);
    expect(p.per_param[0].same_direction).toBe(true);
    expect(p.per_param[0].value_distance).toBe(0);
    expect(p.trade_citation_jaccard).toBe(1);
  });

  it("recommendation disagreement", () => {
    const a = makeInsight({ recommendation: "promote" });
    const b = makeInsight({ recommendation: "no_promote", model: "gpt" });
    expect(computePairwiseAgreement(a, b).recommendation_agreement).toBe(false);
  });

  it("disjoint parameters: overlap = 0, no per-param entries", () => {
    const a = makeInsight({
      proposed_changes: [{ name: "stop", current_value: 3, proposed_value: 2 }],
    });
    const b = makeInsight({
      model: "gpt",
      proposed_changes: [
        { name: "take_profit", current_value: 10, proposed_value: 12 },
      ],
    });
    const p = computePairwiseAgreement(a, b);
    expect(p.parameter_overlap_jaccard).toBe(0);
    expect(p.per_param).toEqual([]);
  });

  it("shared parameter, opposite direction", () => {
    const a = makeInsight({
      proposed_changes: [{ name: "stop", current_value: 3, proposed_value: 2 }], // tighten
    });
    const b = makeInsight({
      model: "gpt",
      proposed_changes: [{ name: "stop", current_value: 3, proposed_value: 4 }], // loosen
    });
    const p = computePairwiseAgreement(a, b);
    expect(p.per_param[0].same_direction).toBe(false);
    // value_distance = |2-4|/|3| = 0.666...
    expect(p.per_param[0].value_distance).toBeCloseTo(0.667, 2);
  });

  it("no-change proposal counts as no-direction (not 'same direction')", () => {
    const a = makeInsight({
      proposed_changes: [{ name: "stop", current_value: 3, proposed_value: 3 }],
    });
    const b = makeInsight({
      model: "gpt",
      proposed_changes: [{ name: "stop", current_value: 3, proposed_value: 3 }],
    });
    expect(computePairwiseAgreement(a, b).per_param[0].same_direction).toBe(false);
  });

  it("trade-citation Jaccard: partial overlap over the union", () => {
    const a = makeInsight({
      winning_trade_ids: ["t1", "t2"],
      losing_trade_ids: ["t3"],
    });
    const b = makeInsight({
      model: "gpt",
      winning_trade_ids: ["t2"],
      losing_trade_ids: ["t4", "t5"],
    });
    // union = {t1,t2,t3,t4,t5}, intersection = {t2} → 1/5 = 0.2
    expect(computePairwiseAgreement(a, b).trade_citation_jaccard).toBeCloseTo(0.2, 5);
  });

  it("both citation sets empty: convention returns 1 (trivially aligned)", () => {
    const a = makeInsight({ winning_trade_ids: [], losing_trade_ids: [] });
    const b = makeInsight({ model: "gpt", winning_trade_ids: [], losing_trade_ids: [] });
    expect(computePairwiseAgreement(a, b).trade_citation_jaccard).toBe(1);
  });

  it("null trade-id arrays are treated as empty", () => {
    const a = makeInsight({ winning_trade_ids: null, losing_trade_ids: null });
    const b = makeInsight({ model: "gpt", winning_trade_ids: ["t1"], losing_trade_ids: null });
    // union {t1}, intersection {} → 0
    expect(computePairwiseAgreement(a, b).trade_citation_jaccard).toBe(0);
  });
});

describe("computeConvergenceSummary", () => {
  it("empty insights returns trivially", () => {
    const s = computeConvergenceSummary("bt-x", []);
    expect(s.n_models).toBe(0);
    expect(s.n_pairs).toBe(0);
    expect(s.mean_value_distance).toBeNull();
  });

  it("single insight: 0 pairs, no comparison possible", () => {
    const s = computeConvergenceSummary("bt-x", [makeInsight({ model: "claude" })]);
    expect(s.n_models).toBe(1);
    expect(s.n_pairs).toBe(0);
  });

  it("reproduces the Prod convergence: 3 models, all propose stop_buffer_points=2.25", () => {
    // This mirrors backtest a360ac86 — three models independently
    // converged on identical value + parameter + direction.
    const opus = makeInsight({
      model: "anthropic/claude-opus-4-7-1m",
      proposed_changes: [
        { name: "stop_buffer_points", current_value: 3, proposed_value: 2.25 },
      ],
      winning_trade_ids: ["t1", "t2"],
      losing_trade_ids: ["t3", "t4"],
    });
    const sonnet = makeInsight({
      model: "anthropic/claude-sonnet-4-6",
      proposed_changes: [
        { name: "stop_buffer_points", current_value: 3, proposed_value: 2.25 },
      ],
      winning_trade_ids: ["t1"],
      losing_trade_ids: ["t3"],
    });
    const llama = makeInsight({
      model: "llama-3.3-70b-versatile",
      proposed_changes: [
        { name: "stop_buffer_points", current_value: 3, proposed_value: 2.25 },
      ],
      winning_trade_ids: ["t2"],
      losing_trade_ids: ["t4"],
    });

    const s = computeConvergenceSummary("bt-real", [opus, sonnet, llama]);
    expect(s.n_models).toBe(3);
    expect(s.n_pairs).toBe(3); // C(3,2)
    expect(s.mean_recommendation_agreement).toBe(1);
    expect(s.mean_parameter_overlap).toBe(1);
    expect(s.mean_value_distance).toBe(0); // exact convergence on value
  });

  it("dedupes models: multiple insights from same model → keeps latest", () => {
    const early = makeInsight({
      id: "e",
      model: "claude",
      created_at: "2026-07-01T00:00:00Z",
      proposed_changes: [{ name: "stop", current_value: 3, proposed_value: 2 }],
    });
    const late = makeInsight({
      id: "l",
      model: "claude",
      created_at: "2026-07-05T00:00:00Z",
      proposed_changes: [{ name: "stop", current_value: 3, proposed_value: 2.5 }],
    });
    const gpt = makeInsight({
      model: "gpt",
      proposed_changes: [{ name: "stop", current_value: 3, proposed_value: 2.5 }],
    });
    const s = computeConvergenceSummary("bt", [early, late, gpt]);
    expect(s.n_models).toBe(2);
    expect(s.n_pairs).toBe(1);
    // Pair should compare `late` (2.5) vs gpt (2.5) → identical
    expect(s.pairs[0].per_param[0].value_distance).toBe(0);
  });
});
