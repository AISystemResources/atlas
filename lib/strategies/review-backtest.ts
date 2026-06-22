/**
 * Aggregate backtest reviewer — Sprint 053e.
 *
 * Given all trades in a backtest (plus any per-trade reviews), an LLM
 * identifies winning/losing patterns and proposes a recommendation:
 * promote (with parameter_changes drafted), keep, or deprecate.
 *
 * The LLM proposes changes by tunable NAME from the registry — not by raw
 * JSON path. The server maps name → path → applies via applyParameterChanges
 * to construct the new TicketLogicBody for promotion.
 */

import { z } from "zod";
import { getLlm } from "@/lib/agents/llm";
import { getServiceClient } from "@/lib/supabase-server";
import {
  clampProposedChange,
  effectiveMaxStepPct,
  getTunables,
  readByPath,
  type TunableParameter,
} from "./tunable-params";
import type { TicketLogicBody } from "./types";

export const BACKTEST_INSIGHT_PROMPT_VERSION = "backtest-insight-v4-quantitative";

// Sprint 053.0: forced attribution — every pattern + proposed change
// must cite trade indices the LLM was shown (1-based, in the order the
// prompt listed them). The server maps indices → real trade ids before
// persistence. Hallucinated indices are filtered out.
const ProposedChangeSchema = z.object({
  name: z.string().min(1),
  current_value: z.number(),
  proposed_value: z.number(),
  reason: z.string().min(1),
  supporting_trade_indices: z.array(z.number().int().positive()).default([]),
});

const BacktestInsightSchema = z.object({
  winning_pattern: z.string().min(1),
  winning_trade_indices: z.array(z.number().int().positive()).default([]),
  losing_pattern: z.string().min(1),
  losing_trade_indices: z.array(z.number().int().positive()).default([]),
  recommendation: z.enum(["promote", "keep", "deprecate"]),
  rationale: z.string().min(1),
  proposed_changes: z.array(ProposedChangeSchema).default([]),
});

export type BacktestInsight = z.infer<typeof BacktestInsightSchema>;

export interface ReviewBacktestInput {
  backtest_id: string;
  strategy: {
    name: string;
    version: number;
    description: string;
    body: TicketLogicBody;
  };
  ticker: string;
  timeframe: string;
  performance: {
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    win_rate: number | null;
    total_pnl_dollars: number | null;
    avg_pnl_dollars: number | null;
    max_drawdown_dollars: number | null;
  };
  trades: Array<{
    /** Sprint 053.0: real trade id so server can map LLM-cited indices back. */
    id: string;
    entry_ts: string;
    exit_ts: string | null;
    exit_reason: string | null;
    pnl_dollars: number | null;
    pnl_pct: number | null;
    review_summary?: {
      skill_or_luck: string;
      rationale: string;
    };
  }>;
}

/**
 * Sprint 053.1: per-change ratchet metadata. The LLM proposes a value; the
 * server may clamp it (per-tunable max_step_pct or min/max bounds). Both the
 * original ask and the applied value are stamped onto the JSONB so the
 * academic audit can show "LLM said X, ratchet allowed Y".
 */
export interface ProposedChangeAttribution {
  /** What the LLM originally asked for. */
  original_proposed_value: number;
  /** What was actually applied after clamping. */
  applied_value: number;
  /** True iff applied_value !== original_proposed_value. */
  was_clamped: boolean;
  /** "" if no clamp; otherwise "step" (ratchet), "min", or "max". */
  clamp_reason: "" | "step" | "min" | "max";
  /** max_step_pct in effect for this tunable at the time of the promote. */
  max_step_pct: number;
}

export interface ReviewBacktestResult {
  insight: BacktestInsight;
  model: string;
  prompt_version: string;
  /** Sprint 053.0: LLM-cited indices mapped to actual trade ids. */
  winning_trade_ids: string[];
  losing_trade_ids: string[];
  /** Per-change trade-id attributions, keyed by proposed_change.name. */
  supporting_trade_ids_by_change: Record<string, string[]>;
  /** Sprint 053.1: per-change clamp metadata, keyed by proposed_change.name. */
  clamp_by_change: Record<string, ProposedChangeAttribution>;
}

function mapIndicesToIds(indices: number[], trades: ReviewBacktestInput["trades"]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const idx of indices) {
    // LLM indices are 1-based and visible-window only (first 50 trades).
    // Anything out of range is a hallucination — drop silently.
    if (idx < 1 || idx > Math.min(trades.length, 50)) continue;
    const id = trades[idx - 1].id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function describeTunables(
  tunables: TunableParameter[],
  body: TicketLogicBody,
): string {
  if (tunables.length === 0) {
    return "  (no tunable parameters registered for this strategy)";
  }
  return tunables
    .map((t) => {
      const cur = readByPath(body, t.path);
      const bounds =
        t.min !== undefined && t.max !== undefined
          ? ` [${t.min}, ${t.max}]`
          : "";
      // Sprint 053.1: tell the LLM the per-promote ratchet so it doesn't
      // burn proposals on values that will be silently clamped.
      const stepPct = (effectiveMaxStepPct(t) * 100).toFixed(0);
      const cap =
        typeof cur === "number"
          ? ` (max ±${stepPct}% per promote, i.e. ${(cur - Math.abs(cur) * effectiveMaxStepPct(t)).toFixed(2)}..${(cur + Math.abs(cur) * effectiveMaxStepPct(t)).toFixed(2)})`
          : ` (max ±${stepPct}% per promote)`;
      return `  - ${t.name}: ${cur}${bounds}${cap} — ${t.description}`;
    })
    .join("\n");
}

/**
 * Sprint 079C.3: quantitative forensics computed server-side and dropped
 * into the prompt as the headline numbers. The Llama 70B class has been
 * observed to pattern-match on exit-reason words rather than reason over
 * the R:R asymmetry — a 55% win rate with avg_win < avg_loss is the
 * actual diagnosis it kept missing. Pre-computing the numbers and forcing
 * the LLM to reason FROM them (not toward them) is the cheaper fix vs
 * model upgrade.
 */
export interface TradeForensics {
  total: number;
  wins: number;
  losses: number;
  scratches: number;
  win_rate_pct: number | null;
  avg_win_dollars: number | null;
  avg_loss_dollars: number | null;
  rr_ratio: number | null;
  profit_factor: number | null;
  largest_win: number | null;
  largest_loss: number | null;
  exit_reason_breakdown: Record<string, number>;
}

export function computeForensics(
  trades: ReviewBacktestInput["trades"],
): TradeForensics {
  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let sumWins = 0;
  let sumAbsLosses = 0;
  let largestWin: number | null = null;
  let largestLoss: number | null = null;
  const exitReasons: Record<string, number> = {};
  for (const t of trades) {
    const pnl = t.pnl_dollars;
    if (pnl == null) continue;
    if (pnl > 0) {
      wins++;
      sumWins += pnl;
      largestWin = largestWin == null ? pnl : Math.max(largestWin, pnl);
    } else if (pnl < 0) {
      losses++;
      sumAbsLosses += Math.abs(pnl);
      largestLoss = largestLoss == null ? pnl : Math.min(largestLoss, pnl);
    } else {
      scratches++;
    }
    const reason = t.exit_reason ?? "unknown";
    exitReasons[reason] = (exitReasons[reason] ?? 0) + 1;
  }
  const decided = wins + losses;
  const avgWin = wins > 0 ? sumWins / wins : null;
  const avgLoss = losses > 0 ? sumAbsLosses / losses : null;
  return {
    total: trades.length,
    wins,
    losses,
    scratches,
    win_rate_pct: decided > 0 ? (wins / decided) * 100 : null,
    avg_win_dollars: avgWin,
    avg_loss_dollars: avgLoss,
    rr_ratio: avgWin != null && avgLoss != null && avgLoss > 0 ? avgWin / avgLoss : null,
    profit_factor: sumAbsLosses > 0 ? sumWins / sumAbsLosses : null,
    largest_win: largestWin,
    largest_loss: largestLoss,
    exit_reason_breakdown: exitReasons,
  };
}

function fmtNum(n: number | null, decimals = 2): string {
  return n == null ? "—" : n.toFixed(decimals);
}

function describeForensics(f: TradeForensics): string {
  const exitLines = Object.entries(f.exit_reason_breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `  total=${f.total}  wins=${f.wins}  losses=${f.losses}${f.scratches > 0 ? `  scratches=${f.scratches}` : ""}
  win_rate=${fmtNum(f.win_rate_pct, 1)}%
  avg_win=$${fmtNum(f.avg_win_dollars)}  avg_loss=$${fmtNum(f.avg_loss_dollars)}
  R:R=${fmtNum(f.rr_ratio, 2)}  profit_factor=${fmtNum(f.profit_factor, 2)}
  largest_win=$${fmtNum(f.largest_win)}  largest_loss=$${fmtNum(f.largest_loss)}
  exit_reasons: ${exitLines || "—"}`;
}

function summarizeTrades(trades: ReviewBacktestInput["trades"]): string {
  // Cap at 50 trades in the prompt to keep within token budget on Groq.
  const cap = Math.min(trades.length, 50);
  const head = trades.slice(0, cap);
  const tail =
    trades.length > cap
      ? `\n  ... (${trades.length - cap} more trades elided) ...`
      : "";
  const lines = head.map((t, i) => {
    const pnl = t.pnl_dollars != null ? `$${t.pnl_dollars.toFixed(2)}` : "—";
    const reason = t.exit_reason ?? "—";
    const rev = t.review_summary
      ? ` [${t.review_summary.skill_or_luck}]`
      : "";
    return `  ${i + 1}. ${t.entry_ts?.slice(0, 16)} → ${reason} ${pnl}${rev}`;
  });
  return lines.join("\n") + tail;
}

function buildPrompt(input: ReviewBacktestInput): string {
  const tunables = getTunables(input.strategy.body);
  const perf = input.performance;
  const visibleCount = Math.min(input.trades.length, 50);
  const forensics = computeForensics(input.trades);

  return `You are an experienced systematic trader reviewing a complete backtest.
Be skeptical, concrete, and concise. Your job is to recommend whether this strategy should be PROMOTED to a new version with parameter changes, KEPT as-is, or DEPRECATED.

ANALYTICAL DISCIPLINE — read this before anything else:
A high win rate does NOT mean a profitable strategy. A 55% win rate with avg_win < avg_loss is a STRUCTURAL FAILURE — the take-profit is being clipped tighter than the stop-loss, so winners barely cover the losers' damage. The single most important diagnostic is R:R (avg_win / avg_loss). If R:R < 1, propose a SPECIFIC parameter change that widens TP, tightens SL, or both — do NOT recommend "keep" just because win rate is above 50%. Conversely, R:R > 2 with win rate below 40% is fine — the strategy is a high-payoff low-frequency type.

Reason FROM the forensics numbers below, not toward them.

STRATEGY: ${input.strategy.name} v${input.strategy.version} on ${input.ticker} (${input.timeframe})
DESCRIPTION: ${input.strategy.description}

QUANTITATIVE FORENSICS (computed server-side from all ${input.trades.length} trades — these are AUTHORITATIVE):
${describeForensics(forensics)}

AGGREGATE PERFORMANCE (also server-computed):
  total_pnl=$${perf.total_pnl_dollars?.toFixed(2) ?? "—"}  avg_per_trade=$${perf.avg_pnl_dollars?.toFixed(2) ?? "—"}  max_drawdown=$${perf.max_drawdown_dollars?.toFixed(2) ?? "—"}

TRADES (${visibleCount} shown, numbered 1–${visibleCount} for citation):
${summarizeTrades(input.trades)}

TUNABLE PARAMETERS YOU MAY PROPOSE CHANGES TO:
${describeTunables(tunables, input.strategy.body)}

ANSWER ALL FIVE. You MUST cite specific trade numbers (1-${visibleCount}) for every pattern claim:
1. RESTATE the headline diagnostic in one sentence — call out the R:R ratio and what it means for this strategy. (E.g. "R:R=${fmtNum(forensics.rr_ratio, 2)} with win rate ${fmtNum(forensics.win_rate_pct, 1)}% means winners are ${forensics.rr_ratio != null && forensics.rr_ratio < 1 ? "TOO SMALL to cover losses" : "doing meaningful work"}.")
2. What's the strongest pattern in WINNING trades? List the trade numbers that exemplify it.
3. What's the strongest pattern in LOSING trades? List the trade numbers that exemplify it.
4. Recommend: promote / keep / deprecate. RULES: (a) if R:R < 1 you should NOT recommend "keep" without a corrective proposal — that's structural. (b) If you cannot articulate a *specific* parameter change that would improve the strategy, prefer KEEP — do not promote with empty changes. (c) Deprecate only if no parameter knob can fix the underlying problem (e.g. fundamentally wrong direction or unstable indicator).
5. If PROMOTE, propose 1-3 parameter changes by name. Use ONLY names from the tunable list above. For each change, list the trade numbers whose behaviour would change for the better. RATCHET RULE: each proposed_value MUST fall within the per-promote cap shown next to the parameter (max ±N% from current). Proposals outside the cap are silently clamped server-side — don't waste a slot on a move you can't actually make in one promote.

Return ONLY a JSON object with this exact shape (no prose before or after):
{
  "winning_pattern": "<1-2 sentences>",
  "winning_trade_indices": [<trade numbers from 1 to ${visibleCount}>],
  "losing_pattern": "<1-2 sentences>",
  "losing_trade_indices": [<trade numbers from 1 to ${visibleCount}>],
  "recommendation": "promote" | "keep" | "deprecate",
  "rationale": "<1 paragraph>",
  "proposed_changes": [
    {
      "name": "<tunable name>",
      "current_value": <number>,
      "proposed_value": <number>,
      "reason": "<1 sentence>",
      "supporting_trade_indices": [<trade numbers this change is justified by>]
    }
  ]
}

Attribution discipline: every index you cite must be a real trade number from the list above (1–${visibleCount}). Empty arrays are honest if no specific trades motivate a claim — do not fabricate citations. If recommendation is not "promote", set proposed_changes to [].`;
}

function extractJson(raw: string): unknown {
  const stripped = raw
    .replace(/```json\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("no JSON object found in LLM response");
  }
  return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
}

export async function reviewBacktest(
  input: ReviewBacktestInput,
): Promise<ReviewBacktestResult> {
  const prompt = buildPrompt(input);
  const llm = await getLlm("deep");
  const response = await llm.invoke(prompt);
  const rawContent =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  const parsed = extractJson(rawContent);
  const insight = BacktestInsightSchema.parse(parsed);

  // Validate proposed_changes reference real tunables. If the LLM hallucinated
  // a name, drop the offending change rather than failing the whole review.
  const tunables = getTunables(input.strategy.body);
  insight.proposed_changes = insight.proposed_changes.filter((c) =>
    tunables.some((t) => t.name === c.name),
  );

  // Sprint 053.1: ratchet each proposed change against its tunable's
  // max_step_pct (per-promote cap) and bounds. Original ask + applied value
  // are both recorded for the academic audit. We mutate proposed_value in
  // place so applyParameterChanges downstream gets the clamped value.
  const clamp_by_change: Record<string, ProposedChangeAttribution> = {};
  for (const c of insight.proposed_changes) {
    const tunable = tunables.find((t) => t.name === c.name)!;
    const result = clampProposedChange(tunable, c.current_value, c.proposed_value);
    clamp_by_change[c.name] = {
      original_proposed_value: result.original_proposed_value,
      applied_value: result.applied_value,
      was_clamped: result.was_clamped,
      clamp_reason: result.clamp_reason,
      max_step_pct: effectiveMaxStepPct(tunable),
    };
    c.proposed_value = result.applied_value;
  }

  // Sprint 053.0: map LLM-cited indices → real trade ids. Out-of-range or
  // duplicate indices are dropped silently.
  const winning_trade_ids = mapIndicesToIds(insight.winning_trade_indices, input.trades);
  const losing_trade_ids = mapIndicesToIds(insight.losing_trade_indices, input.trades);
  const supporting_trade_ids_by_change: Record<string, string[]> = {};
  for (const c of insight.proposed_changes) {
    supporting_trade_ids_by_change[c.name] = mapIndicesToIds(
      c.supporting_trade_indices,
      input.trades,
    );
  }

  const responseMeta = response as unknown as {
    response_metadata?: { model?: string; model_name?: string };
  };
  const model =
    responseMeta.response_metadata?.model_name ??
    responseMeta.response_metadata?.model ??
    process.env.GROQ_DEEP_MODEL ??
    "llama-3.3-70b-versatile";

  return {
    insight,
    model,
    prompt_version: BACKTEST_INSIGHT_PROMPT_VERSION,
    winning_trade_ids,
    losing_trade_ids,
    supporting_trade_ids_by_change,
    clamp_by_change,
  };
}

export async function saveBacktestInsight(
  backtestId: string,
  result: ReviewBacktestResult,
): Promise<{ id: string }> {
  const sb = getServiceClient();

  // Sprint 079C.1: multiple insights per backtest can coexist, keyed by
  // (backtest_id, model, prompt_version). Same (model, prompt_version)
  // re-runs UPSERT so we don't get duplicate spam. Different models can
  // coexist on the same backtest — e.g. Llama auto-review + Claude-via-MCP
  // submission live side-by-side for direct comparison in the academic story.

  // Sprint 053.0 + 053.1: stamp trade-id attributions and ratchet metadata
  // onto each proposed_change so the JSONB is self-contained for audit.
  const proposedChangesWithAttribution = result.insight.proposed_changes.map((c) => {
    const clamp = result.clamp_by_change[c.name];
    return {
      name: c.name,
      current_value: c.current_value,
      proposed_value: c.proposed_value,
      reason: c.reason,
      supporting_trade_ids: result.supporting_trade_ids_by_change[c.name] ?? [],
      original_proposed_value: clamp?.original_proposed_value ?? c.proposed_value,
      was_clamped: clamp?.was_clamped ?? false,
      clamp_reason: clamp?.clamp_reason ?? "",
      max_step_pct: clamp?.max_step_pct ?? null,
    };
  });

  const { data, error } = await sb
    .from("ticket_backtest_insights")
    .upsert(
      {
        backtest_id: backtestId,
        model: result.model,
        prompt_version: result.prompt_version,
        winning_pattern: result.insight.winning_pattern,
        losing_pattern: result.insight.losing_pattern,
        recommendation: result.insight.recommendation,
        rationale: result.insight.rationale,
        proposed_changes:
          proposedChangesWithAttribution.length > 0 ? proposedChangesWithAttribution : null,
        winning_trade_ids: result.winning_trade_ids.length > 0 ? result.winning_trade_ids : null,
        losing_trade_ids: result.losing_trade_ids.length > 0 ? result.losing_trade_ids : null,
        // Reset promotion state on re-run — promoted version is per-row,
        // not per-backtest, so a re-distillation can be re-promoted.
        promoted_to_version_id: null,
        promoted_at: null,
        ab_comparison: null,
      },
      { onConflict: "backtest_id,model,prompt_version" },
    )
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`save backtest insight: ${error?.message ?? "no row"}`);
  }
  return { id: data.id as string };
}
