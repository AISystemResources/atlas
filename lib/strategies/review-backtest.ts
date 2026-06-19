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

export const BACKTEST_INSIGHT_PROMPT_VERSION = "backtest-insight-v1";

const BacktestInsightSchema = z.object({
  winning_pattern: z.string().min(1),
  losing_pattern: z.string().min(1),
  recommendation: z.enum(["promote", "keep", "deprecate"]),
  rationale: z.string().min(1),
  proposed_changes: z
    .array(
      z.object({
        name: z.string().min(1),
        current_value: z.number(),
        proposed_value: z.number(),
        reason: z.string().min(1),
      }),
    )
    .default([]),
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

TRADES (most recent ${Math.min(input.trades.length, 50)} shown):
${summarizeTrades(input.trades)}

TUNABLE PARAMETERS YOU MAY PROPOSE CHANGES TO:
${describeTunables(tunables, input.strategy.body)}

ANSWER ALL FOUR:
1. What's the strongest pattern in WINNING trades?
2. What's the strongest pattern in LOSING trades?
3. Recommend: promote / keep / deprecate. If you cannot articulate a *specific* parameter change that would improve the strategy, prefer KEEP — do not promote with empty changes.
4. If PROMOTE, propose 1-3 parameter changes by name. Use ONLY names from the tunable list above.

Return ONLY a JSON object with this exact shape (no prose before or after):
{
  "winning_pattern": "<1-2 sentences>",
  "losing_pattern": "<1-2 sentences>",
  "recommendation": "promote" | "keep" | "deprecate",
  "rationale": "<1 paragraph>",
  "proposed_changes": [
    { "name": "<tunable name>", "current_value": <number>, "proposed_value": <number>, "reason": "<1 sentence>" }
  ]
}

If recommendation is not "promote", set proposed_changes to [].`;
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

  const responseMeta = response as unknown as {
    response_metadata?: { model?: string; model_name?: string };
  };
  const model =
    responseMeta.response_metadata?.model_name ??
    responseMeta.response_metadata?.model ??
    process.env.GROQ_DEEP_MODEL ??
    "llama-3.3-70b-versatile";

  return { insight, model, prompt_version: BACKTEST_INSIGHT_PROMPT_VERSION };
}

export async function saveBacktestInsight(
  backtestId: string,
  result: ReviewBacktestResult,
): Promise<{ id: string }> {
  const sb = getServiceClient();
  await sb.from("ticket_backtest_insights").delete().eq("backtest_id", backtestId);
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
        result.insight.proposed_changes.length > 0
          ? result.insight.proposed_changes
          : null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`save backtest insight: ${error?.message ?? "no row"}`);
  }
  return { id: data.id as string };
}
