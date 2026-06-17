/**
 * LangGraph pipeline for Atlas.
 *
 * Graph shape (exact match to backend/agents/graph.py):
 *   START
 *     → fetch_data
 *         → [technical_analyst, fundamental_analyst, sentiment_analyst]  (parallel fan-out)
 *         → synthesize → fetch_account → assess_risk → portfolio → save_trace
 *     → END
 *
 * analyst_outputs uses a merge reducer so parallel analyst nodes each write their
 * own key without overwriting each other.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import type { AtlasState } from "./state";
import { marketDataNode } from "./nodes/market_data";
import { technicalAnalystNode } from "./nodes/technical_analyst";
import { fundamentalAnalystNode } from "./nodes/fundamental_analyst";
import { sentimentAnalystNode } from "./nodes/sentiment_analyst";
import { reviewAnalystNode } from "./nodes/review_analyst";
import { synthesisNode } from "./nodes/synthesis";
import { fetchAccountNode } from "./nodes/fetch_account";
import { riskNode } from "./nodes/risk";
import { portfolioDecisionNode } from "./nodes/portfolio_decision";
import { historyModifierNode } from "./nodes/history_modifier";
import { saveTraceNode } from "./nodes/save_trace";

// ── State annotation with analyst_outputs reducer ───────────────────────────
// LangGraph requires an annotation to describe how to merge parallel updates.
// The analyst_outputs key merges dicts so parallel nodes don't overwrite each other.

const AtlasStateAnnotation = Annotation.Root({
  // Inputs
  ticker: Annotation<string>({ reducer: (_prev: any, next: any) => next }),
  user_id: Annotation<string>({ reducer: (_prev: any, next: any) => next }),
  boundary_mode: Annotation<string>({ reducer: (_prev: any, next: any) => next }),
  as_of_date: Annotation<string | null | undefined>({
    reducer: (_prev: any, next: any) => next,
  }),
  philosophy_mode: Annotation<string | null | undefined>({
    reducer: (_prev: any, next: any) => next,
  }),

  // Market data
  ohlcv: Annotation<AtlasState["ohlcv"]>({ reducer: (_prev: any, next: any) => next }),
  info: Annotation<AtlasState["info"]>({ reducer: (_prev: any, next: any) => next }),
  news: Annotation<AtlasState["news"]>({ reducer: (_prev: any, next: any) => next }),
  current_price: Annotation<number | undefined>({
    reducer: (_prev: any, next: any) => next,
  }),

  // analyst_outputs: merge (operator.or_ equivalent) — parallel nodes each add their key
  analyst_outputs: Annotation<AtlasState["analyst_outputs"]>({
    reducer: (prev: any, next: any) => ({ ...(prev ?? {}), ...(next ?? {}) }),
    default: () => ({}),
  }),

  // Positions and account
  current_positions: Annotation<AtlasState["current_positions"]>({
    reducer: (_prev: any, next: any) => next,
  }),
  account_info: Annotation<AtlasState["account_info"]>({
    reducer: (_prev: any, next: any) => next,
  }),

  // Sequential stage outputs
  synthesis: Annotation<AtlasState["synthesis"]>({
    reducer: (_prev: any, next: any) => next,
  }),
  risk: Annotation<AtlasState["risk"]>({ reducer: (_prev: any, next: any) => next }),
  portfolio_decision: Annotation<AtlasState["portfolio_decision"]>({
    reducer: (_prev: any, next: any) => next,
  }),
  trace_id: Annotation<string | null | undefined>({
    reducer: (_prev: any, next: any) => next,
  }),

  // History Agent output and control flag
  history_modifier: Annotation<AtlasState["history_modifier"]>({
    reducer: (_prev: any, next: any) => next,
  }),
  history_agent_enabled: Annotation<AtlasState["history_agent_enabled"]>({
    reducer: (_prev: any, next: any) => next,
  }),

  // Optional LLM config — flows top-down, never mutated by nodes
  llm_config: Annotation<AtlasState["llm_config"]>({
    reducer: (_prev: any, next: any) => next,
  }),
});

// ── Graph assembly ───────────────────────────────────────────────────────────

function buildGraph() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = new StateGraph(AtlasStateAnnotation) as any;

  // Nodes
  builder.addNode("fetch_data", marketDataNode);
  builder.addNode("technical_analyst", technicalAnalystNode);
  builder.addNode("fundamental_analyst", fundamentalAnalystNode);
  builder.addNode("sentiment_analyst", sentimentAnalystNode);
  builder.addNode("review_analyst", reviewAnalystNode);
  builder.addNode("synthesize", synthesisNode);
  builder.addNode("fetch_account", fetchAccountNode);
  builder.addNode("assess_risk", riskNode);
  builder.addNode("portfolio", portfolioDecisionNode);
  builder.addNode("history_modifier", historyModifierNode);
  builder.addNode("save_trace", saveTraceNode);

  // Fan-out: fetch_data → all four analysts in parallel
  builder.addEdge(START, "fetch_data");
  builder.addEdge("fetch_data", "technical_analyst");
  builder.addEdge("fetch_data", "fundamental_analyst");
  builder.addEdge("fetch_data", "sentiment_analyst");
  builder.addEdge("fetch_data", "review_analyst");

  // Fan-in: all four analysts → synthesis (LangGraph waits for all four)
  builder.addEdge("technical_analyst", "synthesize");
  builder.addEdge("fundamental_analyst", "synthesize");
  builder.addEdge("sentiment_analyst", "synthesize");
  builder.addEdge("review_analyst", "synthesize");

  // Sequential tail
  builder.addEdge("synthesize", "fetch_account");
  builder.addEdge("fetch_account", "assess_risk");
  builder.addEdge("assess_risk", "portfolio");
  builder.addEdge("portfolio", "history_modifier");
  builder.addEdge("history_modifier", "save_trace");
  builder.addEdge("save_trace", END);

  return builder.compile();
}

// Singleton — compile once, reuse across requests
let _graph: ReturnType<typeof buildGraph> | null = null;

export function getGraph(): ReturnType<typeof buildGraph> {
  if (_graph === null) {
    _graph = buildGraph();
  }
  return _graph;
}
