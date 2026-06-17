/**
 * Technical Analyst node — price action, indicators, chart patterns.
 *
 * Mirrors backend/agents/analysts/technical.py exactly.
 */

import type { AtlasState, TechnicalOutput } from "../state";
import { TechnicalOutputSchema, validateStateSlice, llmConfigFromState } from "../state";
import { getLlm } from "../llm";
import { getPhilosophyPrefix } from "../philosophies";
import type { Bar } from "@/lib/market";

interface Indicators {
  current_price: number | null;
  rsi_14: number | null;
  sma_20: number | null;
  sma_50: number | null;
  sma_200: number | null;
  price_vs_sma50_pct: number | null;
  price_vs_sma200_pct: number | null;
  price_5d_pct: number | null;
  price_20d_pct: number | null;
  volume_ratio_vs_20d_avg: number | null;
}

function sma(data: number[], n: number): number | null {
  if (data.length < n) return null;
  const slice = data.slice(-n);
  return Math.round((slice.reduce((a, b) => a + b, 0) / n) * 10000) / 10000;
}

function computeIndicators(ohlcv: Bar[]): Indicators {
  if (ohlcv.length < 20) {
    return {
      current_price: null,
      rsi_14: null,
      sma_20: null,
      sma_50: null,
      sma_200: null,
      price_vs_sma50_pct: null,
      price_vs_sma200_pct: null,
      price_5d_pct: null,
      price_20d_pct: null,
      volume_ratio_vs_20d_avg: null,
    };
  }

  const closes = ohlcv.map((r) => r.close);
  const volumes = ohlcv.map((r) => r.volume);

  // RSI-14
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < Math.min(15, closes.length); i++) {
    const delta = closes[closes.length - i] - closes[closes.length - i - 1];
    if (delta > 0) gains.push(Math.abs(delta));
    else losses.push(Math.abs(delta));
  }
  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / 14 : 0.001;
  const rsi = Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const lastClose = closes[closes.length - 1];

  const price5dPct =
    closes.length >= 6
      ? Math.round(
          ((lastClose - closes[closes.length - 6]) / closes[closes.length - 6]) *
            100 *
            100,
        ) / 100
      : null;
  const price20dPct =
    closes.length >= 21
      ? Math.round(
          ((lastClose - closes[closes.length - 21]) / closes[closes.length - 21]) *
            100 *
            100,
        ) / 100
      : null;

  const avgVol20 = sma(volumes, 20);
  const volRatio =
    avgVol20 != null
      ? Math.round((volumes[volumes.length - 1] / avgVol20) * 100) / 100
      : null;

  return {
    current_price: lastClose,
    rsi_14: rsi,
    sma_20: sma20,
    sma_50: sma50,
    sma_200: sma200,
    price_vs_sma50_pct:
      sma50 != null
        ? Math.round(((lastClose - sma50) / sma50) * 100 * 100) / 100
        : null,
    price_vs_sma200_pct:
      sma200 != null
        ? Math.round(((lastClose - sma200) / sma200) * 100 * 100) / 100
        : null,
    price_5d_pct: price5dPct,
    price_20d_pct: price20dPct,
    volume_ratio_vs_20d_avg: volRatio,
  };
}

export async function technicalAnalystNode(
  state: AtlasState,
): Promise<Partial<AtlasState>> {
  const startMs = Date.now();
  const { ticker, ohlcv = [], philosophy_mode } = state;

  const indicators = computeIndicators(ohlcv as Bar[]);
  const philosophyPrefix = getPhilosophyPrefix(philosophy_mode);

  const prompt = `${philosophyPrefix}You are a technical analyst for a swing trading system. Analyse ${ticker} and return a JSON object.

Computed indicators:
${JSON.stringify(indicators, null, 2)}

Recent price history (last 10 days):
${JSON.stringify(ohlcv.slice(-10), null, 2)}

Return ONLY valid JSON with this exact structure:
{
  "signal": "BUY" or "SELL" or "HOLD",
  "reasoning": "2-3 sentence technical analysis focused on swing trading",
  "key_levels": {"support": <float>, "resistance": <float>},
  "trend": "bullish" or "bearish" or "neutral"
}`;

  const llmConfig = llmConfigFromState(state);
  let text = "";
  try {
    const llm = await getLlm("quick", llmConfig);
    const response = await llm.invoke(prompt);
    text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  } catch (err) {
    console.error("[technical] LLM error:", err instanceof Error ? err.message : String(err));
  }

  let parsed: Record<string, unknown>;
  try {
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const modelId = llmConfig?.model ?? "llama-3.1-8b-instant";

  const result = validateStateSlice<TechnicalOutput>(
    TechnicalOutputSchema,
    {
      signal: parsed["signal"] ?? "HOLD",
      indicators,
      key_levels: (parsed["key_levels"] as Record<string, number>) ?? {},
      trend: parsed["trend"] ?? "neutral",
      reasoning: parsed["reasoning"] ?? "",
      model: modelId,
      latency_ms: Date.now() - startMs,
    },
    "technical_analyst",
  );

  return {
    analyst_outputs: { technical: result },
  };
}
