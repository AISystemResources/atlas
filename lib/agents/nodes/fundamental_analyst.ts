/**
 * Fundamental Analyst node — financials, earnings, valuations.
 *
 * Mirrors backend/agents/analysts/fundamental.py exactly.
 */

import type { AtlasState, FundamentalOutput } from "../state";
import { FundamentalOutputSchema, validateStateSlice, llmConfigFromState } from "../state";
import { getLlm } from "../llm";
import { getPhilosophyPrefix } from "../philosophies";
import type { AtlasTickerInfo } from "@/lib/market";

function extractMetrics(info: Partial<AtlasTickerInfo>) {
  return {
    pe_ratio: info.trailingPE ?? null,
    forward_pe: info.forwardPE ?? null,
    price_to_book: info.priceToBook ?? null,
    revenue_growth: info.revenueGrowth ?? null,
    earnings_growth: info.earningsGrowth ?? null,
    profit_margins: info.profitMargins ?? null,
    debt_to_equity: info.debtToEquity ?? null,
    return_on_equity: info.returnOnEquity ?? null,
    current_ratio: info.currentRatio ?? null,
    analyst_target: info.targetMeanPrice ?? null,
    analyst_recommendation: info.recommendationMean ?? null,
    "52w_high": info.fiftyTwoWeekHigh ?? null,
    "52w_low": info.fiftyTwoWeekLow ?? null,
    current_price: info.currentPrice ?? null,
  };
}

export async function fundamentalAnalystNode(
  state: AtlasState,
): Promise<Partial<AtlasState>> {
  const startMs = Date.now();
  const { ticker, info = {}, philosophy_mode } = state;

  const metrics = extractMetrics(info as Partial<AtlasTickerInfo>);
  const philosophyPrefix = getPhilosophyPrefix(philosophy_mode);

  const prompt = `${philosophyPrefix}You are a fundamental analyst for a swing trading system. Analyse ${ticker} and return a JSON object.

Company: ${(info as AtlasTickerInfo).shortName ?? ticker} | Sector: ${(info as AtlasTickerInfo).sector} | Industry: ${(info as AtlasTickerInfo).industry}

Key metrics:
${JSON.stringify(metrics, null, 2)}

Return ONLY valid JSON with this exact structure:
{
  "signal": "BUY" or "SELL" or "HOLD",
  "reasoning": "2-3 sentence fundamental analysis focused on valuation and growth",
  "valuation": "undervalued" or "fairly_valued" or "overvalued",
  "upside_to_target_pct": <float or null>
}`;

  const llmConfig = llmConfigFromState(state);
  let text = "";
  try {
    const llm = await getLlm("quick", llmConfig);
    const response = await llm.invoke(prompt);
    text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  } catch (err) {
    console.error("[fundamental] LLM error:", err instanceof Error ? err.message : String(err));
  }

  let parsed: Record<string, unknown>;
  try {
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const current = metrics.current_price;
  const target = metrics.analyst_target;
  const upside =
    current != null && target != null
      ? Math.round(((target - current) / current) * 100 * 100) / 100
      : (parsed["upside_to_target_pct"] as number | null) ?? null;

  const modelId = llmConfig?.model ?? "llama-3.1-8b-instant";

  const result = validateStateSlice<FundamentalOutput>(
    FundamentalOutputSchema,
    {
      signal: parsed["signal"] ?? "HOLD",
      metrics,
      valuation: parsed["valuation"] ?? "fairly_valued",
      upside_to_target_pct: upside,
      reasoning: parsed["reasoning"] ?? "",
      model: modelId,
      latency_ms: Date.now() - startMs,
    },
    "fundamental_analyst",
  );

  return {
    analyst_outputs: { fundamental: result },
  };
}
