/**
 * Core types for the Atlas backtest library.
 *
 * BacktestRequest  — input to trigger a backtest job
 * BacktestSlice    — result of one (date × ticker) step
 * BacktestMetrics  — aggregate performance metrics
 * BacktestJob      — job status document persisted in MongoDB
 */

import type { LLMConfig } from "@/lib/agents/llm";

export type { LLMConfig } from "@/lib/agents/llm";

export interface BacktestRequest {
  userId: string;
  tickers: string[];
  /** ISO "YYYY-MM-DD" */
  startDate: string;
  /** ISO "YYYY-MM-DD" */
  endDate: string;
  philosophy: "buffett" | "soros" | "lynch" | "balanced";
  /** Pre-generated UUID — used for idempotency on Inngest replay. */
  jobId: string;
  /**
   * Optional LLM provider config.  Defaults to Gemini when absent.
   * Live trading always ignores this field.
   */
  llmConfig?: LLMConfig;
  /**
   * EBC execution mode for the virtual portfolio simulation.
   * "advisory"   — no trades executed; metrics reflect signal quality only.
   * "autonomous" — trades execute above 0.65 confidence; P&L / Sharpe are meaningful.
   * Defaults to "advisory" for safe backward-compatibility.
   */
  ebc_mode?: "advisory" | "autonomous";
  /**
   * When true, the simulation pass applies the 3-state circuit breaker on top of
   * ebc_mode. Enables the paper's comparison experiment: autonomous vs.
   * autonomous-with-circuit-breaker. Only meaningful when ebc_mode = "autonomous".
   */
  circuit_breaker_enabled?: boolean;
  /**
   * Enable/disable the History Agent confidence modifier for this run.
   * false = A/B control arm (modifier=0, identical to pre-agent behaviour).
   * Defaults to true when absent.
   */
  history_agent_enabled?: boolean;
}

export interface BacktestSlice {
  jobId: string;
  date: string;
  ticker: string;
  /** PortfolioDecision returned by the agent graph. */
  decision: unknown;
  completedAt: string;
}

export interface BacktestMetrics {
  cagr: number;
  sharpeRatio: number;
  maxDrawdown: number;
  calmarRatio: number;
  profitFactor: number;
  winRate: number;
  totalTrades: number;
  totalReturn: number;
}

export interface BacktestJob {
  jobId: string;
  userId: string;
  status: "pending" | "running" | "completed" | "failed";
  /** 0–1 */
  progress: number;
  metrics?: BacktestMetrics;
  createdAt: string;
  completedAt?: string;
}
