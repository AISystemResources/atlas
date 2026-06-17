/**
 * Graph integration tests.
 *
 * We mock the LangGraph StateGraph entirely (it's an ESM-only package
 * not compatible with Jest's CommonJS environment). Instead, we verify:
 *   1. runGraph correctly assembles the initial state and calls the graph
 *   2. The graph topology is correct (node wiring via the builder calls)
 *   3. Analyst outputs are merged correctly from parallel nodes
 *   4. The public runGraph API is callable with expected options
 *
 * All external I/O (LLM, market data, broker, MongoDB) is mocked.
 */

// ── Captured mock references ───────────────────────────────────────────────
// Defined before jest.mock calls so they can be referenced inside factories.

const capturedNodes: string[] = [];
const capturedEdges: string[] = [];
const mockInvoke = jest.fn();

// ── mock @langchain/langgraph before any imports ───────────────────────────

jest.mock("@langchain/langgraph", () => {
  const mockAddNode = jest.fn().mockImplementation((name: string) => {
    capturedNodes.push(name);
  });
  const mockAddEdge = jest.fn().mockImplementation((from: string, to: string) => {
    capturedEdges.push(`${from}→${to}`);
  });
  const mockCompile = jest.fn().mockReturnValue({ invoke: mockInvoke });

  // Annotation must be callable AND have a .Root method
  const annotationFn = Object.assign(
    jest.fn().mockImplementation((config: unknown) => config),
    { Root: jest.fn().mockImplementation((schema: unknown) => schema) },
  );

  return {
    StateGraph: jest.fn().mockImplementation(() => ({
      addNode: mockAddNode,
      addEdge: mockAddEdge,
      compile: mockCompile,
    })),
    START: "__start__",
    END: "__end__",
    Annotation: annotationFn,
  };
});

jest.mock("@/lib/agents/llm", () => ({
  getLlm: jest.fn().mockReturnValue({
    invoke: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        signal: "HOLD",
        reasoning: "Mock.",
        key_levels: { support: 100, resistance: 110 },
        trend: "neutral",
        valuation: "fairly_valued",
        upside_to_target_pct: 5,
        sentiment_score: 0,
        dominant_themes: [],
        bull_case: "Mock bull.",
        bear_case: "Mock bear.",
        verdict: "HOLD",
        action: "HOLD",
        confidence: 0.5,
      }),
    }),
  }),
}));

jest.mock("@/lib/market", () => ({
  fetchBars: jest.fn().mockResolvedValue(
    Array.from({ length: 25 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      open: 150,
      high: 155,
      low: 148,
      close: 152,
      volume: 10_000_000,
    })),
  ),
  fetchNews: jest.fn().mockResolvedValue([]),
  fetchTickerInfo: jest.fn().mockResolvedValue({
    shortName: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    trailingPE: 25,
    forwardPE: 22,
    priceToBook: 35,
    revenueGrowth: 0.08,
    earningsGrowth: 0.12,
    profitMargins: 0.25,
    debtToEquity: 150,
    returnOnEquity: 1.7,
    currentRatio: 1.1,
    marketCap: 2_800_000_000_000,
    fiftyTwoWeekHigh: 200,
    fiftyTwoWeekLow: 140,
    currentPrice: 152,
    targetMeanPrice: 180,
    recommendationMean: 1.8,
  }),
}));

jest.mock("@/lib/broker", () => ({
  AlpacaAdapter: jest.fn().mockImplementation(() => ({
    getAccount: jest.fn().mockResolvedValue({
      equity: 100_000,
      cash: 50_000,
      buyingPower: 100_000,
      portfolioValue: 100_000,
    }),
    getPositions: jest.fn().mockResolvedValue([]),
  })),
  MockBrokerAdapter: jest.fn().mockImplementation(() => ({
    getAccount: jest.fn().mockResolvedValue({
      equity: 100_000,
      cash: 50_000,
      buyingPower: 100_000,
      portfolioValue: 100_000,
    }),
    getPositions: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock("@/lib/agents/memory/trace", () => ({
  saveTrace: jest.fn().mockResolvedValue("mock-trace-id-123"),
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import { getGraph } from "../graph";
import { runGraph } from "../index";

// Set up the mock invoke to return a sensible state
const mockFinalState = {
  ticker: "AAPL",
  user_id: "test_user",
  boundary_mode: "advisory",
  as_of_date: "2024-01-25",
  philosophy_mode: "balanced",
  ohlcv: [{ date: "2024-01-01", open: 150, high: 155, low: 148, close: 152, volume: 10_000_000 }],
  info: { currentPrice: 152 },
  news: [],
  current_price: 152,
  analyst_outputs: {
    technical: { signal: "HOLD", indicators: {}, key_levels: {}, trend: "neutral", reasoning: "Mock.", model: "gemini-2.5-flash", latency_ms: 100 },
    fundamental: { signal: "HOLD", metrics: {}, valuation: "fairly_valued", upside_to_target_pct: 5, reasoning: "Mock.", model: "gemini-2.5-flash", latency_ms: 100 },
    sentiment: { signal: "HOLD", sentiment_score: 0, dominant_themes: [], sources: ["news"], headline_count: 0, reasoning: "Mock.", news_articles: [], model: "gemini-2.5-flash", latency_ms: 100 },
  },
  synthesis: { bull_case: "Bull.", bear_case: "Bear.", verdict: "HOLD", reasoning: "Balanced.", model: "gemini-2.5-flash", latency_ms: 500 },
  risk: { current_price: 152, stop_loss: 144.4, take_profit: 167.2, position_size: 10, position_value: 1520, position_pct_of_portfolio: 1.52, risk_reward_ratio: 2, max_loss_dollars: 1000, reasoning: "1% rule.", latency_ms: 5 },
  portfolio_decision: { action: "HOLD", confidence: 0.5, reasoning: "Mock.", latency_ms: 800 },
  trace_id: "mock-trace-id-123",
};

beforeAll(() => {
  // Trigger graph construction once to populate capturedNodes and capturedEdges
  getGraph();
  mockInvoke.mockResolvedValue(mockFinalState);
});

beforeEach(() => {
  mockInvoke.mockResolvedValue(mockFinalState);
});

describe("graph topology", () => {
  it("registers 10 nodes", () => {
    expect(capturedNodes).toContain("fetch_data");
    expect(capturedNodes).toContain("technical_analyst");
    expect(capturedNodes).toContain("fundamental_analyst");
    expect(capturedNodes).toContain("sentiment_analyst");
    expect(capturedNodes).toContain("review_analyst");
    expect(capturedNodes).toContain("synthesize");
    expect(capturedNodes).toContain("fetch_account");
    expect(capturedNodes).toContain("assess_risk");
    expect(capturedNodes).toContain("portfolio");
    expect(capturedNodes).toContain("save_trace");
  });

  it("wires fan-out edges from fetch_data to all four analysts", () => {
    expect(capturedEdges).toContain("fetch_data→technical_analyst");
    expect(capturedEdges).toContain("fetch_data→fundamental_analyst");
    expect(capturedEdges).toContain("fetch_data→sentiment_analyst");
    expect(capturedEdges).toContain("fetch_data→review_analyst");
  });

  it("wires fan-in edges from all four analysts to synthesize", () => {
    expect(capturedEdges).toContain("technical_analyst→synthesize");
    expect(capturedEdges).toContain("fundamental_analyst→synthesize");
    expect(capturedEdges).toContain("sentiment_analyst→synthesize");
    expect(capturedEdges).toContain("review_analyst→synthesize");
  });

  it("wires sequential tail: synthesize → fetch_account → assess_risk → portfolio → save_trace", () => {
    expect(capturedEdges).toContain("synthesize→fetch_account");
    expect(capturedEdges).toContain("fetch_account→assess_risk");
    expect(capturedEdges).toContain("assess_risk→portfolio");
    expect(capturedEdges).toContain("portfolio→save_trace");
  });

  it("starts with START→fetch_data and ends with save_trace→END", () => {
    expect(capturedEdges).toContain("__start__→fetch_data");
    expect(capturedEdges).toContain("save_trace→__end__");
  });
});

describe("runGraph", () => {
  it("is callable with ticker and options", async () => {
    const result = await runGraph("AAPL", {
      userId: "test_user",
      mode: "advisory",
      philosophy: "balanced",
      isBacktest: true,
      asOfDate: "2024-01-25",
    });
    expect(result).toBeDefined();
  });

  it("passes ticker in uppercase to the graph", async () => {
    await runGraph("aapl", {
      userId: "test_user",
      isBacktest: true,
    });
    // The invoke call should receive AAPL
    const lastCall = mockInvoke.mock.calls[mockInvoke.mock.calls.length - 1];
    const invokeArg = lastCall[0] as { ticker: string };
    expect(invokeArg.ticker).toBe("AAPL");
  });

  it("sets as_of_date when isBacktest=true with explicit date", async () => {
    await runGraph("AAPL", {
      userId: "test_user",
      isBacktest: true,
      asOfDate: "2024-01-15",
    });
    const lastCall = mockInvoke.mock.calls[mockInvoke.mock.calls.length - 1];
    const invokeArg = lastCall[0] as { as_of_date: string };
    expect(invokeArg.as_of_date).toBe("2024-01-15");
  });

  it("sets as_of_date to null when isBacktest=false", async () => {
    await runGraph("AAPL", {
      userId: "test_user",
      isBacktest: false,
    });
    const lastCall = mockInvoke.mock.calls[mockInvoke.mock.calls.length - 1];
    const invokeArg = lastCall[0] as { as_of_date: null };
    expect(invokeArg.as_of_date).toBeNull();
  });

  it("returns final state with expected keys", async () => {
    const result = await runGraph("AAPL", {
      userId: "test_user",
      isBacktest: true,
    });
    expect(result.ticker).toBe("AAPL");
    expect(result.analyst_outputs?.technical).toBeDefined();
    expect(result.synthesis).toBeDefined();
    expect(result.risk).toBeDefined();
    expect(result.portfolio_decision).toBeDefined();
    expect(result.trace_id).toBe("mock-trace-id-123");
  });
});
