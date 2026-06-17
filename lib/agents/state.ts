/**
 * AtlasState — Zod schemas and TypeScript types for all LangGraph state slices.
 *
 * Mirrors AgentState from backend/agents/state.py exactly.
 * Every node reads from and writes to this shared state.
 *
 * The analyst_outputs key uses LangGraph's reducer pattern (merge-by-key)
 * so parallel analyst nodes can each write their result without overwriting each other.
 */

import { z } from "zod";

// Re-export for convenience so callers can import from state
export type { LLMConfig, LLMProvider } from "./llm";

// ── Primitive sub-schemas ────────────────────────────────────────────────────

export const BarSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

export const NewsItemSchema = z.object({
  title: z.string(),
  published: z.string(),
});

export const AtlasTickerInfoSchema = z.object({
  shortName: z.string().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  trailingPE: z.number().nullable(),
  forwardPE: z.number().nullable(),
  priceToBook: z.number().nullable(),
  revenueGrowth: z.number().nullable(),
  earningsGrowth: z.number().nullable(),
  profitMargins: z.number().nullable(),
  debtToEquity: z.number().nullable(),
  returnOnEquity: z.number().nullable(),
  currentRatio: z.number().nullable(),
  marketCap: z.number().nullable(),
  fiftyTwoWeekHigh: z.number().nullable(),
  fiftyTwoWeekLow: z.number().nullable(),
  currentPrice: z.number().nullable(),
  targetMeanPrice: z.number().nullable(),
  recommendationMean: z.number().nullable(),
});

// ── Analyst output schemas ───────────────────────────────────────────────────

export const TechnicalOutputSchema = z.object({
  signal: z.enum(["BUY", "SELL", "HOLD"]),
  indicators: z.record(z.string(), z.unknown()),
  key_levels: z.object({
    support: z.number().optional(),
    resistance: z.number().optional(),
  }),
  trend: z.enum(["bullish", "bearish", "neutral"]),
  reasoning: z.string(),
  model: z.string(),
  latency_ms: z.number(),
});

export const FundamentalOutputSchema = z.object({
  signal: z.enum(["BUY", "SELL", "HOLD"]),
  metrics: z.record(z.string(), z.unknown()),
  valuation: z.enum(["undervalued", "fairly_valued", "overvalued"]),
  upside_to_target_pct: z.number().nullable(),
  reasoning: z.string(),
  model: z.string(),
  latency_ms: z.number(),
});

export const SentimentOutputSchema = z.object({
  signal: z.enum(["BUY", "SELL", "HOLD"]),
  sentiment_score: z.number(),
  dominant_themes: z.array(z.string()),
  sources: z.array(z.string()),
  headline_count: z.number(),
  reasoning: z.string(),
  news_articles: z.array(z.object({
    title: z.string(),
    date: z.string(),
    url: z.string().optional(),
  })),
  model: z.string(),
  latency_ms: z.number(),
});

export const SynthesisOutputSchema = z.object({
  bull_case: z.string(),
  bear_case: z.string(),
  verdict: z.enum(["BUY", "SELL", "HOLD"]),
  reasoning: z.string(),
  model: z.string(),
  latency_ms: z.number(),
});

export const RiskOutputSchema = z.object({
  current_price: z.number(),
  stop_loss: z.number(),
  take_profit: z.number(),
  position_size: z.number(),
  position_value: z.number(),
  position_pct_of_portfolio: z.number(),
  risk_reward_ratio: z.number(),
  max_loss_dollars: z.number(),
  reasoning: z.string(),
  latency_ms: z.number(),
});

export const PortfolioDecisionSchema = z.object({
  action: z.enum(["BUY", "SELL", "HOLD"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  latency_ms: z.number(),
});

export const HistoryModifierSchema = z.object({
  win_rate: z.number().min(0).max(1),
  n_trades: z.number().int().min(0),
  modifier: z.number().min(-0.15).max(0.15),
  confidence_modified: z.number().min(0).max(1),
  enabled: z.boolean(),
});

export const ReviewOutputSchema = z.object({
  recent_trade_count: z.number(),
  recent_win_rate: z.number().min(0).max(1).nullable(),
  signal_bias: z.enum(["buy_biased", "sell_biased", "balanced", "insufficient_data"]),
  consecutive_losses: z.number(),
  consecutive_wins: z.number(),
  patterns: z.array(z.string()),
  reasoning: z.string(),
  model: z.string(),
  latency_ms: z.number(),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export const AnalystOutputsSchema = z.object({
  technical: TechnicalOutputSchema.optional(),
  fundamental: FundamentalOutputSchema.optional(),
  sentiment: SentimentOutputSchema.optional(),
  review: ReviewOutputSchema.optional(),
});

export const AccountInfoSchema = z.object({
  portfolio_value: z.number(),
  buying_power: z.number(),
  equity: z.number(),
});

export const CurrentPositionSchema = z.object({
  shares: z.number(),
  avg_cost: z.number(),
});

// ── AtlasState ───────────────────────────────────────────────────────────────

export const PhilosophyModeSchema = z
  .enum(["balanced", "buffett", "soros", "lynch"])
  .nullable()
  .optional();

export const BoundaryModeSchema = z.enum(["advisory", "semi-autonomous", "autonomous"]);

/**
 * Full graph state schema — used for Zod validation at node boundaries.
 * Partial because nodes only populate their own slice.
 */
export const AtlasStateSchema = z.object({
  // Inputs (required to start the graph)
  ticker: z.string().min(1),
  user_id: z.string().min(1),
  boundary_mode: BoundaryModeSchema,
  as_of_date: z.string().nullable().optional(),
  philosophy_mode: PhilosophyModeSchema,

  // Market data (populated by fetch_data node)
  ohlcv: z.array(BarSchema).optional(),
  info: AtlasTickerInfoSchema.partial().optional(),
  news: z.array(NewsItemSchema).optional(),
  current_price: z.number().optional(),

  // Analyst outputs — merged by LangGraph reducer so parallel nodes don't overwrite
  analyst_outputs: AnalystOutputsSchema.optional(),

  // Live positions — fetched before portfolio node, null if unavailable
  current_positions: z.record(z.string(), CurrentPositionSchema).nullable().optional(),

  // Account info — fetched before risk node
  account_info: AccountInfoSchema.nullable().optional(),

  // Sequential stage outputs
  synthesis: SynthesisOutputSchema.nullable().optional(),
  risk: RiskOutputSchema.nullable().optional(),
  portfolio_decision: PortfolioDecisionSchema.nullable().optional(),
  trace_id: z.string().nullable().optional(),

  // History Agent output — populated by history_modifier node
  history_modifier: HistoryModifierSchema.nullable().optional(),

  // Controls whether the history_modifier node computes a modifier or passes through.
  // false = disabled (byte-for-byte equivalence with pre-agent behaviour).
  // Defaults to true when absent.
  history_agent_enabled: z.boolean().nullable().optional(),

  // Optional LLM config — injected by backtest runner.
  // When absent, each node defaults to Gemini (backward-compatible).
  llm_config: z.object({
    provider: z.enum(["gemini", "groq", "ollama", "openai-compatible"]),
    model: z.string(),
    base_url: z.string().optional(),
    api_key: z.string().optional(),
  }).nullable().optional(),
});

// ── TypeScript types ─────────────────────────────────────────────────────────

export type AtlasState = z.infer<typeof AtlasStateSchema>;
export type HistoryModifierOutput = z.infer<typeof HistoryModifierSchema>;
export type TechnicalOutput = z.infer<typeof TechnicalOutputSchema>;
export type FundamentalOutput = z.infer<typeof FundamentalOutputSchema>;
export type SentimentOutput = z.infer<typeof SentimentOutputSchema>;
export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;
export type RiskOutput = z.infer<typeof RiskOutputSchema>;
export type PortfolioDecision = z.infer<typeof PortfolioDecisionSchema>;
export type AnalystOutputs = z.infer<typeof AnalystOutputsSchema>;
export type AccountInfo = z.infer<typeof AccountInfoSchema>;
export type CurrentPosition = z.infer<typeof CurrentPositionSchema>;
export type PhilosophyMode = NonNullable<z.infer<typeof PhilosophyModeSchema>>;
export type BoundaryMode = z.infer<typeof BoundaryModeSchema>;

/**
 * Extract an LLMConfig from graph state.
 * Returns undefined when no config was injected — callers fall back to Gemini.
 */
export function llmConfigFromState(state: AtlasState): import("./llm").LLMConfig | undefined {
  if (!state.llm_config) return undefined;
  return {
    provider: state.llm_config.provider,
    model: state.llm_config.model,
    baseUrl: state.llm_config.base_url,
    apiKey: state.llm_config.api_key,
  };
}

/**
 * Validates a partial state update at a node boundary.
 * Throws a ZodError if the shape is invalid — prevents silent state corruption.
 */
export function validateStateSlice<T>(
  schema: z.ZodType<T>,
  data: unknown,
  nodeName: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `[${nodeName}] State validation failed: ${result.error.message}`,
    );
  }
  return result.data;
}
