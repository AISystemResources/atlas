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
  getTunables,
  readByPath,
  type TunableParameter,
} from "./tunable-params";
import type { TicketLogicBody } from "./types";

export const BACKTEST_INSIGHT_PROMPT_VERSION = "backtest-insight-v2-attribution";

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

export interface ReviewBacktestResult {
  insight: BacktestInsight;
  model: string;
  prompt_version: string;
  /** Sprint 053.0: LLM-cited indices mapped to actual trade ids. */
  winning_trade_ids: string[];
  losing_trade_ids: string[];
  /** Per-change trade-id attributions, keyed by proposed_change.name. */
  supporting_trade_ids_by_change: Record<string, string[]>;
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
      return `  - ${t.name}: ${cur}${bounds} — ${t.description}`;
    })
    .join("\n");
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

  return `You are an experienced systematic trader reviewing a complete backtest.
Be skeptical, concrete, and concise. Your job is to recommend whether this strategy should be PROMOTED to a new version with parameter changes, KEPT as-is, or DEPRECATED.

STRATEGY: ${input.strategy.name} v${input.strategy.version} on ${input.ticker} (${input.timeframe})
DESCRIPTION: ${input.strategy.description}

PERFORMANCE:
  Total trades: ${perf.total_trades}
  Wins / Losses: ${perf.winning_trades} / ${perf.losing_trades}
  Win rate: ${perf.win_rate != null ? (perf.win_rate * 100).toFixed(1) + "%" : "—"}
  Total PnL: $${perf.total_pnl_dollars?.toFixed(2) ?? "—"}
  Avg / trade: $${perf.avg_pnl_dollars?.toFixed(2) ?? "—"}
  Max drawdown: $${perf.max_drawdown_dollars?.toFixed(2) ?? "—"}

TRADES (${visibleCount} shown, numbered 1–${visibleCount} for citation):
${summarizeTrades(input.trades)}

TUNABLE PARAMETERS YOU MAY PROPOSE CHANGES TO:
${describeTunables(tunables, input.strategy.body)}

ANSWER ALL FOUR. You MUST cite specific trade numbers (1-${visibleCount}) for every claim:
1. What's the strongest pattern in WINNING trades? List the trade numbers that exemplify it.
2. What's the strongest pattern in LOSING trades? List the trade numbers that exemplify it.
3. Recommend: promote / keep / deprecate. If you cannot articulate a *specific* parameter change that would improve the strategy, prefer KEEP — do not promote with empty changes.
4. If PROMOTE, propose 1-3 parameter changes by name. Use ONLY names from the tunable list above. For each change, list the trade numbers whose behaviour would change for the better.

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
  };
}

export async function saveBacktestInsight(
  backtestId: string,
  result: ReviewBacktestResult,
): Promise<{ id: string }> {
  const sb = getServiceClient();
  await sb.from("ticket_backtest_insights").delete().eq("backtest_id", backtestId);

  // Sprint 053.0: stamp the mapped trade ids onto each proposed_change so
  // readers don't need a second join.
  const proposedChangesWithAttribution = result.insight.proposed_changes.map((c) => ({
    name: c.name,
    current_value: c.current_value,
    proposed_value: c.proposed_value,
    reason: c.reason,
    supporting_trade_ids: result.supporting_trade_ids_by_change[c.name] ?? [],
  }));

  const { data, error } = await sb
    .from("ticket_backtest_insights")
    .insert({
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
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`save backtest insight: ${error?.message ?? "no row"}`);
  }
  return { id: data.id as string };
}
