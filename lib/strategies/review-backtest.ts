/**
 * Backtest insight types + persistence helpers.
 *
 * Atlas does NOT run server-side LLM calls (Sprint 095). The distillation
 * pipeline used to live here as `reviewBacktest` calling Groq — that path
 * was removed in 2026-06-30. Distillation insights now come exclusively
 * from MCP-connected models (Claude, ChatGPT) via the
 * `submit_distillation_insight` write tool.
 *
 * This module retains:
 *   - The persisted insight shape (schemas + types) so MCP submissions
 *     conform to a single contract
 *   - `computeForensics` — server-computed trade statistics surfaced to
 *     the MCP caller via `get_backtest_for_distillation`
 *   - `saveBacktestInsight` — the DB write path used by
 *     `submit_distillation_insight`
 *   - `mapIndicesToIds` — converts 1-based LLM-cited indices into real
 *     trade UUIDs server-side, dropping hallucinations
 */

import { z } from "zod";
import { getServiceClient } from "@/lib/supabase-server";

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

// Re-export for any caller that wants to validate inbound MCP payloads.
export { BacktestInsightSchema, ProposedChangeSchema };

export interface ReviewBacktestInput {
  backtest_id: string;
  strategy: {
    name: string;
    version: number;
    description: string;
    body: import("./types").TicketLogicBody;
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
 * Sprint 053.1: per-change ratchet metadata. The MCP caller proposes a value;
 * the server may clamp it (per-tunable max_step_pct or min/max bounds). Both
 * the original ask and the applied value are stamped onto the JSONB so the
 * academic audit can show "caller said X, ratchet allowed Y".
 */
export interface ProposedChangeAttribution {
  /** What the caller originally asked for. */
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
  /** Model identifier of the proposer (e.g. "anthropic/claude-sonnet-4-6"). */
  model: string;
  /** Prompt version string the caller used (e.g. "claude-mcp-v1"). */
  prompt_version: string;
  /** Sprint 053.0: caller-cited indices mapped to actual trade ids. */
  winning_trade_ids: string[];
  losing_trade_ids: string[];
  /** Per-change trade-id attributions, keyed by proposed_change.name. */
  supporting_trade_ids_by_change: Record<string, string[]>;
  /** Sprint 053.1: per-change clamp metadata, keyed by proposed_change.name. */
  clamp_by_change: Record<string, ProposedChangeAttribution>;
}

/**
 * Convert 1-based trade indices (as cited by an MCP caller) into real trade
 * UUIDs. Out-of-range or duplicate indices are dropped silently.
 */
export function mapIndicesToIds(
  indices: number[],
  trades: ReviewBacktestInput["trades"],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const idx of indices) {
    // MCP indices are 1-based and visible-window only (first 50 trades).
    // Anything out of range is a hallucination — drop silently.
    if (idx < 1 || idx > Math.min(trades.length, 50)) continue;
    const id = trades[idx - 1].id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Sprint 079C.3: quantitative forensics computed server-side and surfaced
 * to MCP callers via `get_backtest_for_distillation` so the analysis is
 * grounded in real numbers rather than the caller's pattern-matching on
 * exit-reason words.
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

/**
 * Persist an MCP-submitted distillation insight. Same shape regardless of
 * which model produced it; the (backtest_id, model, prompt_version) UPSERT
 * key lets multiple models coexist on the same backtest.
 */
export async function saveBacktestInsight(
  backtestId: string,
  result: ReviewBacktestResult,
): Promise<{ id: string }> {
  const sb = getServiceClient();

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
