/**
 * Inngest function: run-backtest
 *
 * Triggered by the "app/backtest.requested" event.
 * For each (date × ticker) pair it runs the Atlas agent graph and persists
 * the result slice to MongoDB — idempotent on Inngest at-least-once replay.
 *
 * Port of backend/backtesting/runner.py.
 */

import { MongoClient } from "mongodb";

import { runGraph } from "../agents";
import { getModelId } from "../agents/llm";
import { inngest } from "./inngest-client";
import { computeMetrics } from "./metrics";
import { VirtualPortfolio } from "./simulator";
import { computeNextState, gateFromState } from "../boundary/circuit-breaker";
import type { EbcRecord, EbcState } from "../boundary/circuit-breaker";
import type { AtlasState } from "../agents/state";
import type { BacktestMetrics, BacktestRequest, BacktestSlice } from "./types";

// ---------------------------------------------------------------------------
// MongoDB helpers
// ---------------------------------------------------------------------------

const MONGO_URI = process.env["MONGODB_URI"];
const DB_NAME = "atlas";
const RESULTS_COLLECTION = "backtest_results";
const JOBS_COLLECTION = "backtest_jobs";

function getMongoClient(): MongoClient {
  if (!MONGO_URI) {
    throw new Error("MONGODB_URI environment variable is not configured");
  }
  return new MongoClient(MONGO_URI);
}

type LlmMeta = {
  provider: string;
  model: string;
  base_url?: string;
};

/**
 * Upsert a single backtest slice by (jobId, date, ticker).
 * Uses replaceOne with upsert:true so replayed Inngest steps never duplicate.
 */
export async function upsertSlice(
  jobId: string,
  date: string,
  ticker: string,
  decision: unknown,
  llmMeta?: LlmMeta,
): Promise<void> {
  const client = getMongoClient();
  try {
    await client.connect();
    const col = client.db(DB_NAME).collection(RESULTS_COLLECTION);
    const doc = {
      jobId,
      date,
      ticker,
      decision,
      llm_config: llmMeta ?? null,
      completedAt: new Date().toISOString(),
    };
    await col.replaceOne({ jobId, date, ticker }, doc, { upsert: true });
  } finally {
    await client.close();
  }
}

/**
 * Mark a backtest job as completed and persist its final metrics.
 */
export async function markJobComplete(
  jobId: string,
  metrics: BacktestMetrics,
): Promise<void> {
  const client = getMongoClient();
  try {
    await client.connect();
    const col = client.db(DB_NAME).collection(JOBS_COLLECTION);
    await col.updateOne(
      { jobId },
      {
        $set: {
          status: "completed",
          progress: 1,
          metrics,
          completedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    );
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Generate ISO trading day strings (Mon–Fri) between startDate and endDate
 * inclusive — mirrors Python's `pd.bdate_range`.
 */
export function generateDateRange(startDate: string, endDate: string): string[] {
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  const dates: string[] = [];

  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const runBacktest = inngest.createFunction(
  {
    id: "run-backtest",
    name: "Run Backtest",
    triggers: [{ event: "app/backtest.requested" }],
  },
  async ({ event, step }: { event: { data: BacktestRequest }; step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const { userId, tickers, startDate, endDate, philosophy, jobId, llmConfig, ebc_mode, circuit_breaker_enabled, history_agent_enabled } = event.data;

    // Default to Gemini when no config supplied
    const resolvedLlmConfig = llmConfig ?? {
      provider: "gemini" as const,
      model: getModelId("quick"),
    };

    const dates = generateDateRange(startDate, endDate);

    const slices: BacktestSlice[] = [];

    for (const date of dates) {
      for (const ticker of tickers) {
        const slice = await step.run(
          `slice-${date}-${ticker}`,
          async (): Promise<BacktestSlice> => {
            const result = await runGraph(ticker, {
              userId,
              mode: "advisory",
              philosophy,
              isBacktest: true,
              asOfDate: date,
              llmConfig: resolvedLlmConfig,
              historyAgentEnabled: history_agent_enabled !== false,
            });

            await upsertSlice(jobId, date, ticker, result, {
              provider: resolvedLlmConfig.provider,
              model: resolvedLlmConfig.model,
              base_url: resolvedLlmConfig.baseUrl,
            });

            return {
              jobId,
              date,
              ticker,
              decision: result,
              completedAt: new Date().toISOString(),
            };
          },
        );
        slices.push(slice);
      }
    }

    // Portfolio simulation pass — deterministic over the collected slices so
    // Inngest step replay doesn't corrupt state (each step returns cached results;
    // we re-simulate from those cached decisions in one sequential sweep).
    const resolvedEbcMode = ebc_mode ?? "advisory";
    const useCb = circuit_breaker_enabled === true && resolvedEbcMode !== "advisory";
    const portfolio = new VirtualPortfolio();
    const lastDate = dates[dates.length - 1];

    // In-memory circuit breaker state for backtest (no Supabase I/O needed)
    let cbRecord: EbcRecord = {
      state: "green" as EbcState,
      consecutiveLosses: 0,
      recoveryWins: 0,
      stateChangedAt: new Date(startDate + "T00:00:00Z"),
    };

    const simulatedSlices: BacktestSlice[] = slices.map((slice) => {
      const agentState = slice.decision as AtlasState;
      const decision = agentState.portfolio_decision;
      const currentPrice = agentState.current_price ?? null;
      const isLastDay = slice.date === lastDate;

      // Derive gate for this step (circuit breaker or plain mode)
      const cbGate = useCb ? gateFromState(cbRecord.state) : null;
      const confidenceOverride = cbGate?.confidenceGate ?? null;
      const notionalOverride = cbGate
        ? cbGate.canExecute ? 1000 * cbGate.notionalMultiplier : 0
        : null;

      // Use confidence_modified when History Agent ran; fall back to raw confidence.
      // When history_agent_enabled=false, confidence_modified === base confidence (byte-for-byte).
      const effectiveConfidence =
        agentState.history_modifier?.confidence_modified ?? decision?.confidence ?? 0;

      const tradeResult = portfolio.process({
        date: slice.date,
        ticker: slice.ticker,
        action: cbGate && !cbGate.canExecute ? "HOLD" : (decision?.action ?? "HOLD"),
        confidence: effectiveConfidence,
        ebcMode: resolvedEbcMode,
        executionPrice: currentPrice,
        isLastDay,
        confidenceThresholdOverride: confidenceOverride,
        positionValueOverride: notionalOverride,
      });

      // Update in-memory circuit breaker state after each executed trade
      if (useCb && tradeResult.executed) {
        const outcome: "win" | "loss" =
          tradeResult.pnl !== undefined && tradeResult.pnl !== null && tradeResult.pnl > 0
            ? "win"
            : "loss";
        cbRecord = computeNextState(cbRecord, outcome);
      }

      const portfolioValueAfter = portfolio.portfolioValue(
        currentPrice !== null ? { [slice.ticker]: currentPrice } : {},
      );

      return {
        ...slice,
        decision: {
          ...(agentState as Record<string, unknown>),
          executed: tradeResult.executed,
          pnl: tradeResult.pnl ?? null,
          portfolio_value_after: portfolioValueAfter,
          ebc_state: cbRecord.state,
        },
      };
    });

    const metrics = computeMetrics(simulatedSlices);
    await markJobComplete(jobId, metrics);

    return { jobId, slices: slices.length, metrics };
  },
);
