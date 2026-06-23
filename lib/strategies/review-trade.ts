/**
 * Per-trade AI reviewer — Sprint 053d.
 *
 * Given one simulated backtest trade with its full context (strategy,
 * indicators, bars, exit reason, P&L), an LLM returns structured judgment:
 * skill vs luck, what worked, what didn't, and an optional parameter
 * adjustment.
 *
 * Default model: Groq llama-3.3-70b ("deep" mode) — one-shot per trade,
 * ~2s latency. The prompt asks for JSON; the response is parsed and
 * Zod-validated before persisting.
 */

import { z } from "zod";
import { getLlm } from "@/lib/agents/llm";
import { getServiceClient } from "@/lib/supabase-server";
import type { TicketLogicBody } from "./types";

export const TRADE_REVIEW_PROMPT_VERSION = "trade-review-v1";

const TradeReviewSchema = z.object({
  skill_or_luck: z.enum(["skill", "luck", "mixed"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  what_worked: z.array(z.string()).default([]),
  what_didnt: z.array(z.string()).default([]),
  suggested_adjustment: z
    .object({
      parameter: z.string().min(1),
      current_value: z.number(),
      proposed_value: z.number(),
      reason: z.string().min(1),
    })
    .nullable()
    .optional(),
});

export type TradeReview = z.infer<typeof TradeReviewSchema>;

export interface ReviewTradeInput {
  trade_id: string;
  strategy: {
    name: string;
    version: number;
    description: string;
    body: TicketLogicBody;
  };
  ticker: string;
  timeframe: string;
  entry: {
    timestamp: string;
    price: number;
    take_profit: number;
    stop_loss: number;
    indicator_snapshot: Record<string, number>;
  };
  exit: {
    timestamp: string | null;
    price: number | null;
    reason: string | null;
    pnl_dollars: number | null;
    pnl_pct: number | null;
  };
  bars_around_entry: Array<{
    timestamp?: string;
    open?: number;
    high: number;
    low: number;
    close: number;
  }>;
  entry_bar_index_local: number;
  exit_bar_index_local: number | null;
}

export interface ReviewTradeResult {
  review: TradeReview;
  model: string;
  prompt_version: string;
}

function summarizeConditions(body: TicketLogicBody): string {
  // Render conditions as human-readable lines like:
  //   low[-1] <= kc_lower_outer[-1]
  //   close[0] > open[0]
  function renderExpr(expr: unknown): string {
    const e = expr as Record<string, unknown>;
    if (e.type === "constant") return String(e.value);
    if (e.type === "ohlc") return `${e.field}[${e.bar_offset}]`;
    if (e.type === "indicator") return `${e.id}[${e.bar_offset}]`;
    if (e.type === "computed") return e.id as string;
    if (e.type === "binary")
      return `(${renderExpr(e.left)} ${e.op} ${renderExpr(e.right)})`;
    return JSON.stringify(e);
  }
  function renderCondNode(node: unknown): string {
    const n = node as Record<string, unknown>;
    if ("op" in n) return `${renderExpr(n.left)} ${n.op} ${renderExpr(n.right)}`;
    if (n.type === "and") return `(${(n.children as unknown[]).map(renderCondNode).join(" AND ")})`;
    if (n.type === "or") return `(${(n.children as unknown[]).map(renderCondNode).join(" OR ")})`;
    if (n.type === "not") return `NOT(${renderCondNode(n.child)})`;
    return JSON.stringify(n);
  }
  const conds = body.entry.conditions.map((c) => `  ${renderCondNode(c)}`);
  if (body.regime_filter) {
    conds.unshift(`  (regime) ${renderCondNode(body.regime_filter)}`);
  }
  return conds.join("\n");
}

function summarizeBarsAroundEntry(
  bars: ReviewTradeInput["bars_around_entry"],
  entryIdx: number,
  exitIdx: number | null,
): string {
  // Send a compact summary: 5 bars before entry, entry bar, up to 5 bars to
  // exit, exit bar. Avoids blowing context for long-held trades.
  const lines: string[] = [];
  const preStart = Math.max(0, entryIdx - 5);
  for (let i = preStart; i < entryIdx; i++) {
    lines.push(`  pre  ${formatBar(bars[i])}`);
  }
  if (bars[entryIdx]) lines.push(`  ENTRY ${formatBar(bars[entryIdx])}`);
  if (exitIdx !== null && bars[exitIdx]) {
    const between = Math.max(0, exitIdx - entryIdx - 1);
    if (between <= 6) {
      for (let i = entryIdx + 1; i < exitIdx; i++) {
        lines.push(`  hold ${formatBar(bars[i])}`);
      }
    } else {
      // Show first 3 + ... + last 3 of holding window
      for (let i = entryIdx + 1; i < entryIdx + 4; i++) {
        lines.push(`  hold ${formatBar(bars[i])}`);
      }
      lines.push(`  ... (${between - 6} bars elided) ...`);
      for (let i = exitIdx - 3; i < exitIdx; i++) {
        lines.push(`  hold ${formatBar(bars[i])}`);
      }
    }
    lines.push(`  EXIT  ${formatBar(bars[exitIdx])}`);
  }
  return lines.join("\n");
}

function formatBar(b: ReviewTradeInput["bars_around_entry"][number]): string {
  const ts = b.timestamp ? b.timestamp.slice(11, 16) : "—:—";
  return `${ts}  O=${(b.open ?? 0).toFixed(2)} H=${b.high.toFixed(2)} L=${b.low.toFixed(2)} C=${b.close.toFixed(2)}`;
}

function buildPrompt(input: ReviewTradeInput): string {
  const indicatorTable = Object.entries(input.entry.indicator_snapshot)
    .map(([k, v]) => `  ${k}: ${v.toFixed(4)}`)
    .join("\n");

  return `You are an experienced systematic trader reviewing ONE backtest trade.
Be skeptical, concrete, and concise. Look for whether the entry was a textbook setup or a stretch.

STRATEGY: ${input.strategy.name} v${input.strategy.version} on ${input.ticker} (${input.timeframe})
DESCRIPTION: ${input.strategy.description}

ENTRY CONDITIONS THAT FIRED:
${summarizeConditions(input.strategy.body)}

INDICATORS AT ENTRY:
${indicatorTable}

PRICE ACTION:
${summarizeBarsAroundEntry(input.bars_around_entry, input.entry_bar_index_local, input.exit_bar_index_local)}

EXIT:
  ${input.exit.timestamp ?? "—"} @ $${input.exit.price?.toFixed(2) ?? "—"} (${input.exit.reason ?? "—"})
  PnL: $${input.exit.pnl_dollars?.toFixed(2) ?? "—"} (${input.exit.pnl_pct != null ? (input.exit.pnl_pct * 100).toFixed(2) + "%" : "—"})
  Take profit was set at $${input.entry.take_profit.toFixed(2)}
  Stop loss was set at $${input.entry.stop_loss.toFixed(2)}

ANSWER ALL FOUR:
1. Was this trade skill, luck, or mixed? (Was the entry well-defined or stretched? Was the exit driven by skill or noise?)
2. What worked? (1-3 bullets)
3. What didn't? (1-3 bullets — include "nothing notable" if it was clean)
4. ONE parameter adjustment that might have improved this trade. Cite a specific numeric parameter from the strategy if possible. If no change would have helped, set suggested_adjustment to null.

Return ONLY a JSON object with this exact shape (no prose before or after):
{
  "skill_or_luck": "skill" | "luck" | "mixed",
  "confidence": <0.0..1.0>,
  "rationale": "<1-3 sentence summary>",
  "what_worked": ["<bullet>", ...],
  "what_didnt": ["<bullet>", ...],
  "suggested_adjustment": { "parameter": "<name>", "current_value": <number>, "proposed_value": <number>, "reason": "<1 sentence>" } | null
}`;
}

function extractJson(raw: string): unknown {
  // Strip ```json ... ``` fences if present, then parse the first top-level JSON object.
  const stripped = raw
    .replace(/```json\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("no JSON object found in LLM response");
  }
  const slice = stripped.slice(firstBrace, lastBrace + 1);
  return JSON.parse(slice);
}

export async function reviewTrade(
  input: ReviewTradeInput,
): Promise<ReviewTradeResult> {
  const prompt = buildPrompt(input);
  const llm = await getLlm("deep");
  const response = await llm.invoke(prompt);
  const rawContent =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  const parsed = extractJson(rawContent);
  const review = TradeReviewSchema.parse(parsed);
  // Identify model name from the response metadata when available; fall back to env.
  const responseMeta = response as unknown as {
    response_metadata?: { model?: string; model_name?: string };
  };
  const model =
    responseMeta.response_metadata?.model_name ??
    responseMeta.response_metadata?.model ??
    process.env.GROQ_DEEP_MODEL ??
    "llama-3.3-70b-versatile";
  return { review, model, prompt_version: TRADE_REVIEW_PROMPT_VERSION };
}

/**
 * Persist a review to the DB. Replaces the existing review for this trade
 * (one-per-trade enforced by unique index).
 */
export async function saveTradeReview(
  tradeId: string,
  result: ReviewTradeResult,
): Promise<{ id: string }> {
  const sb = getServiceClient();
  // Upsert via delete-then-insert; the unique constraint on trade_id makes
  // a true upsert tricky without an on-conflict on a non-PK column.
  await sb.from("ticket_backtest_trade_reviews").delete().eq("trade_id", tradeId);
  const { data, error } = await sb
    .from("ticket_backtest_trade_reviews")
    .insert({
      trade_id: tradeId,
      model: result.model,
      prompt_version: result.prompt_version,
      skill_or_luck: result.review.skill_or_luck,
      confidence: result.review.confidence,
      rationale: result.review.rationale,
      what_worked: result.review.what_worked,
      what_didnt: result.review.what_didnt,
      suggested_adjustment: result.review.suggested_adjustment ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`save trade review: ${error?.message ?? "no row"}`);
  }
  return { id: data.id as string };
}
