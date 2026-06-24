/**
 * Extract a TicketLogicBody from an arXiv paper title + abstract using Groq.
 * Sprint 081B.
 */

import { getLlm } from "@/lib/agents/llm";
import { parseTicketLogicBody } from "@/lib/strategies/schema";
import type { TicketLogicBody } from "@/lib/strategies/types";

export type ExtractionResult =
  | { ok: true; body: TicketLogicBody; suggestedName: string }
  | { ok: false; error: string; validationErrors?: string };

export async function extractStrategyFromPaper(params: {
  title: string;
  abstract: string;
  ticker: string;
}): Promise<ExtractionResult> {
  let raw: string;
  try {
    const llm = await getLlm("deep");
    const response = await llm.invoke(buildPrompt(params));
    raw = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  } catch (err) {
    return { ok: false, error: `LLM call failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const jsonStr = stripToJson(raw);
  if (!jsonStr) return { ok: false, error: "LLM did not return parseable JSON" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ok: false, error: "LLM output is not valid JSON" };
  }

  const obj = parsed as Record<string, unknown>;
  const suggestedName = typeof obj["name"] === "string" && obj["name"].length > 0
    ? obj["name"].toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 64)
    : "paper-strategy";

  const rawBody = typeof obj["body"] === "object" && obj["body"] !== null ? obj["body"] : parsed;

  try {
    const body = parseTicketLogicBody(rawBody);
    return { ok: true, body, suggestedName };
  } catch (err) {
    return {
      ok: false,
      error: "Extracted strategy failed schema validation",
      validationErrors: err instanceof Error ? err.message : String(err),
    };
  }
}

function stripToJson(s: string): string | null {
  // Remove markdown code fences if present
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Find first { ... } block
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) return s.slice(start, end + 1);
  return null;
}

function buildPrompt(params: { title: string; abstract: string; ticker: string }): string {
  return `You are a quantitative trading strategy formalizer. Given a research paper, extract ONE concrete entry+exit rule and encode it as a JSON object matching the Atlas TicketLogicBody schema.

## Paper
Title: ${params.title}
Abstract: ${params.abstract}

## Target ticker
${params.ticker}

## Output format
Return ONLY a JSON object — no prose, no explanation. Shape:
{
  "name": "<short-slug-for-strategy>",
  "body": { <TicketLogicBody> }
}

## TicketLogicBody schema (all required unless marked optional)
{
  "universe": { "asset_class": "equity" | "etf" | "crypto" | "index" | "any" },
  "timeframe": "1m" | "5m" | "15m" | "1h" | "1d",
  "direction": "long" | "short" | "both",
  "indicators": [
    { "id": "<unique_id>", "type": "<type>", "params": { <params> } }
  ],
  "regime_filter": <ConditionNode>,  // optional
  "entry": {
    "conditions": [ <ConditionNode> ],  // AND across array
    "sizing": { "method": "fixed_notional", "value": 200 }
  },
  "exit": {
    "take_profit": <Expression>,  // optional if exit_conditions present
    "stop_loss": <Expression>,    // optional if exit_conditions present
    "sl_method": <StopLossMethod>,  // alternative to stop_loss
    "exit_conditions": [ <ConditionNode> ],  // alternative to TP/SL
    "time_stop": "eod" | "next_open" | { "bars": <number> }  // optional
  }
}

## Available indicator types
rsi (params: period), ema (params: period), sma (params: period), atr (params: period),
kc_upper (params: ema_period, atr_period, multiplier), kc_lower (same),
macd (params: fast_period, slow_period, signal_period), macd_signal (same), macd_histogram (same),
bb_upper (params: period, std_dev), bb_lower (same), bb_middle (same),
stoch_k (params: k_period, d_period, smooth), stoch_d (same),
vwap (no params), volume_sma (params: period)

## Expression types
{ "type": "constant", "value": <number> }
{ "type": "ohlc", "field": "open"|"high"|"low"|"close", "bar_offset": 0|-1|-2|... }
{ "type": "indicator", "id": "<indicator_id>", "bar_offset": 0|-1|-2|... }
{ "type": "binary", "op": "+"|"-"|"*"|"/", "left": <Expr>, "right": <Expr> }
{ "type": "volume", "bar_offset": 0|-1 }

## ConditionNode types
{ "op": "gt"|"lt"|"gte"|"lte"|"eq"|"neq", "left": <Expr>, "right": <Expr> }
{ "type": "and"|"or", "children": [ <ConditionNode> ] }
{ "type": "not", "child": <ConditionNode> }

## StopLossMethod (use sl_method instead of stop_loss for dynamic stops)
{ "type": "atr_multiple", "value": 1.5, "atr_indicator_id": "<id>" }
{ "type": "pct_of_entry", "value": 0.01 }
{ "type": "trailing_atr", "value": 1.5, "atr_indicator_id": "<id>" }
{ "type": "trailing_pct", "value": 0.005 }

## Example (RSI oversold long)
{
  "name": "rsi-oversold-long",
  "body": {
    "universe": { "asset_class": "equity" },
    "timeframe": "5m",
    "direction": "long",
    "indicators": [
      { "id": "rsi_14", "type": "rsi", "params": { "period": 14 } },
      { "id": "atr_14", "type": "atr", "params": { "period": 14 } }
    ],
    "entry": {
      "conditions": [
        { "op": "lt", "left": { "type": "indicator", "id": "rsi_14", "bar_offset": 0 }, "right": { "type": "constant", "value": 30 } }
      ],
      "sizing": { "method": "fixed_notional", "value": 200 }
    },
    "exit": {
      "sl_method": { "type": "atr_multiple", "value": 1.5, "atr_indicator_id": "atr_14" },
      "take_profit": {
        "type": "binary", "op": "+",
        "left": { "type": "ohlc", "field": "close", "bar_offset": 0 },
        "right": { "type": "binary", "op": "*",
          "left": { "type": "constant", "value": 2.0 },
          "right": { "type": "indicator", "id": "atr_14", "bar_offset": 0 }
        }
      },
      "time_stop": "eod"
    }
  }
}

If the paper does not contain a concrete tradable rule (e.g. it is purely theoretical), return:
{ "name": "no-extractable-strategy", "body": null, "reason": "<one sentence why>" }

Return ONLY valid JSON. No markdown, no explanation outside the JSON.`;
}
