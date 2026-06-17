/**
 * Review Analyst node — retrospective analysis of recent trade history.
 *
 * Connects to MongoDB to fetch the last 20 reasoning traces for the ticker,
 * computes win rate, signal bias, consecutive streaks, and notable patterns,
 * then calls an LLM for a brief 2-3 sentence reasoning summary.
 *
 * Always returns a valid ReviewOutput — never throws.
 */

import { MongoClient } from "mongodb";
import type { AtlasState, ReviewOutput } from "../state";
import { ReviewOutputSchema, validateStateSlice, llmConfigFromState } from "../state";
import { getLlm } from "../llm";

const LOOKBACK = 20;
const MIN_OUTCOMES_FOR_WIN_RATE = 3;
const MIN_TRACES_FOR_BIAS = 3;
const BIAS_THRESHOLD = 0.6;

let _client: MongoClient | null = null;

function getCollection() {
  if (!_client) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI is not set");
    }
    _client = new MongoClient(uri);
  }
  const dbName = process.env.MONGODB_DB_NAME ?? "atlas";
  return _client.db(dbName).collection("reasoning_traces");
}

interface TraceDoc {
  ticker?: string;
  created_at?: Date;
  portfolio_decision?: { action?: string };
  backtest_outcome?: { correct?: boolean };
  // Nested inside pipeline_run in some schema versions
  pipeline_run?: {
    final_decision?: { action?: string };
    backtest_outcome?: { correct?: boolean };
  };
}

export async function reviewAnalystNode(
  state: AtlasState,
): Promise<Partial<AtlasState>> {
  const startMs = Date.now();
  const { ticker } = state;

  const fallback = (reason: string): Partial<AtlasState> => {
    const result = validateStateSlice<ReviewOutput>(
      ReviewOutputSchema,
      {
        recent_trade_count: 0,
        recent_win_rate: null,
        signal_bias: "insufficient_data",
        consecutive_losses: 0,
        consecutive_wins: 0,
        patterns: [reason],
        reasoning: `Insufficient historical data to perform a retrospective review for ${ticker}.`,
        model: llmConfigFromState(state)?.model ?? "llama-3.1-8b-instant",
        latency_ms: Date.now() - startMs,
      },
      "review_analyst",
    );
    return { analyst_outputs: { review: result } };
  };

  try {
    const collection = getCollection();
    const rawDocs = await collection
      .find({ ticker })
      .sort({ created_at: -1 })
      .limit(LOOKBACK)
      .toArray();

    const docs = rawDocs as TraceDoc[];
    const recentTradeCount = docs.length;

    if (recentTradeCount === 0) {
      return fallback("No historical traces found for this ticker.");
    }

    // Extract action and outcome from each trace, handling both schema shapes
    const trades = docs.map((doc) => {
      const action: string | undefined =
        doc.portfolio_decision?.action ??
        doc.pipeline_run?.final_decision?.action;
      const correct: boolean | undefined =
        doc.backtest_outcome?.correct ??
        doc.pipeline_run?.backtest_outcome?.correct;
      return { action: action?.toUpperCase(), correct };
    });

    // Win rate — only count trades that have an explicit outcome recorded
    const tradesWithOutcome = trades.filter((t) => t.correct !== undefined);
    const wins = tradesWithOutcome.filter((t) => t.correct === true).length;
    const recentWinRate =
      tradesWithOutcome.length >= MIN_OUTCOMES_FOR_WIN_RATE
        ? wins / tradesWithOutcome.length
        : null;

    // Signal bias
    const tradesWithAction = trades.filter((t) => t.action);
    const buyCount = tradesWithAction.filter((t) => t.action === "BUY").length;
    const sellCount = tradesWithAction.filter((t) => t.action === "SELL").length;
    const totalWithAction = tradesWithAction.length;

    let signalBias: ReviewOutput["signal_bias"] = "insufficient_data";
    if (totalWithAction >= MIN_TRACES_FOR_BIAS) {
      const buyRatio = buyCount / totalWithAction;
      const sellRatio = sellCount / totalWithAction;
      if (buyRatio > BIAS_THRESHOLD) {
        signalBias = "buy_biased";
      } else if (sellRatio > BIAS_THRESHOLD) {
        signalBias = "sell_biased";
      } else {
        signalBias = "balanced";
      }
    }

    // Consecutive losses / wins (from most recent going back)
    let consecutiveLosses = 0;
    let consecutiveWins = 0;
    let countingLosses = true;
    let countingWins = true;
    for (const trade of trades) {
      if (trade.correct === undefined) {
        // Missing outcome breaks the streak
        countingLosses = false;
        countingWins = false;
        break;
      }
      if (countingLosses && trade.correct === false) {
        consecutiveLosses++;
      } else {
        countingLosses = false;
      }
      if (countingWins && trade.correct === true) {
        consecutiveWins++;
      } else {
        countingWins = false;
      }
    }

    // Human-readable patterns
    const patterns: string[] = [];
    if (signalBias === "buy_biased") {
      patterns.push(`Model has been BUY-biased in recent history (${buyCount}/${totalWithAction} signals were BUY).`);
    } else if (signalBias === "sell_biased") {
      patterns.push(`Model has been SELL-biased in recent history (${sellCount}/${totalWithAction} signals were SELL).`);
    }
    if (consecutiveLosses >= 3) {
      patterns.push(`Current losing streak: ${consecutiveLosses} consecutive incorrect calls.`);
    }
    if (consecutiveWins >= 3) {
      patterns.push(`Current winning streak: ${consecutiveWins} consecutive correct calls.`);
    }
    if (recentWinRate !== null && recentWinRate < 0.4) {
      patterns.push(`Win rate is low at ${Math.round(recentWinRate * 100)}% over ${tradesWithOutcome.length} evaluated trades.`);
    }
    if (recentWinRate !== null && recentWinRate >= 0.65) {
      patterns.push(`Win rate is strong at ${Math.round(recentWinRate * 100)}% over ${tradesWithOutcome.length} evaluated trades.`);
    }
    if (patterns.length === 0) {
      patterns.push(`No notable patterns in last ${recentTradeCount} trades.`);
    }

    // LLM reasoning summary
    const summary = [
      `Ticker: ${ticker}`,
      `Recent trade count: ${recentTradeCount}`,
      `Win rate: ${recentWinRate !== null ? `${Math.round(recentWinRate * 100)}%` : "N/A (insufficient evaluated outcomes)"}`,
      `Signal bias: ${signalBias}`,
      `Consecutive losses: ${consecutiveLosses} | Consecutive wins: ${consecutiveWins}`,
      `Patterns: ${patterns.join(" ")}`,
    ].join("\n");

    const prompt = `You are a retrospective review analyst for a swing trading system. Summarise the following historical performance data for ${ticker} in 2-3 sentences, noting any concerns or strengths the synthesis agent should weigh.

${summary}

Return ONLY a plain text summary (no JSON, no markdown).`;

    const llmConfig = llmConfigFromState(state);
    const llm = await getLlm("quick", llmConfig);
    const response = await llm.invoke(prompt);
    const reasoning =
      typeof response.content === "string"
        ? response.content.trim()
        : JSON.stringify(response.content);

    const modelId = llmConfig?.model ?? "llama-3.1-8b-instant";

    const result = validateStateSlice<ReviewOutput>(
      ReviewOutputSchema,
      {
        recent_trade_count: recentTradeCount,
        recent_win_rate: recentWinRate,
        signal_bias: signalBias,
        consecutive_losses: consecutiveLosses,
        consecutive_wins: consecutiveWins,
        patterns,
        reasoning: reasoning || `Reviewed ${recentTradeCount} recent traces for ${ticker}.`,
        model: modelId,
        latency_ms: Date.now() - startMs,
      },
      "review_analyst",
    );

    return { analyst_outputs: { review: result } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fallback(`Review analyst error: ${message}`);
  }
}
