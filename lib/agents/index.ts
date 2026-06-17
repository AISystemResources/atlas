/**
 * Public API for the Atlas agent graph.
 *
 * Usage:
 *   import { runGraph } from "@/lib/agents"
 *
 *   const result = await runGraph("AAPL", {
 *     userId: "user_123",
 *     mode: "advisory",
 *     philosophy: "balanced",
 *     isBacktest: false,
 *   })
 */

import { getGraph } from "./graph";
import type { AtlasState } from "./state";

export { getGraph } from "./graph";
export type { AtlasState, PhilosophyMode, BoundaryMode } from "./state";
export type {
  TechnicalOutput,
  FundamentalOutput,
  SentimentOutput,
  SynthesisOutput,
  RiskOutput,
  PortfolioDecision,
} from "./state";
export type { LLMConfig, LLMProvider } from "./llm";

export interface RunGraphOptions {
  /** Clerk user ID */
  userId?: string;
  /** advisory | semi-autonomous | autonomous */
  mode?: "advisory" | "semi-autonomous" | "autonomous";
  /** Investment philosophy overlay */
  philosophy?: "balanced" | "buffett" | "soros" | "lynch";
  /** When true, uses MockBrokerAdapter and skips live broker calls */
  isBacktest?: boolean;
  /** ISO date string for backtest mode (YYYY-MM-DD) */
  asOfDate?: string;
  /**
   * Optional LLM config.  When absent, all nodes default to Gemini.
   * Only respected in backtest mode — live trading is always Gemini.
   */
  llmConfig?: import("./llm").LLMConfig;
  /**
   * Enable/disable the History Agent confidence modifier.
   * false = modifier=0, confidence_modified=base_confidence (A/B control arm).
   * Defaults to true when absent.
   */
  historyAgentEnabled?: boolean;
}

/**
 * Run the full Atlas agent graph for a given ticker.
 *
 * @param ticker  - Stock symbol e.g. "AAPL"
 * @param opts    - Run options
 * @returns Final graph state after all nodes have executed
 */
export async function runGraph(
  ticker: string,
  opts: RunGraphOptions = {},
): Promise<AtlasState> {
  const {
    userId = "system",
    mode = "advisory",
    philosophy = "balanced",
    isBacktest = false,
    asOfDate,
    llmConfig,
    historyAgentEnabled,
  } = opts;

  const graph = getGraph();

  // Live trading is always locked to Gemini — never pass llmConfig there.
  const resolvedLlmConfig = isBacktest ? llmConfig : undefined;

  const initialState: Partial<AtlasState> = {
    ticker: ticker.toUpperCase(),
    user_id: userId,
    boundary_mode: mode,
    philosophy_mode: philosophy,
    as_of_date: isBacktest
      ? (asOfDate ?? new Date().toISOString().slice(0, 10))
      : null,
    // Defaults to true (enabled) when not specified
    history_agent_enabled: historyAgentEnabled !== false,
    llm_config: resolvedLlmConfig
      ? {
          provider: resolvedLlmConfig.provider,
          model: resolvedLlmConfig.model,
          base_url: resolvedLlmConfig.baseUrl,
          api_key: resolvedLlmConfig.apiKey,
        }
      : null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalState = await graph.invoke(initialState as any);
  return finalState as AtlasState;
}
