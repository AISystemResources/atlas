/**
 * @jest-environment node
 *
 * Tests for extractStrategyFromPaper — Sprint 081B.
 * Mocks getLlm and parseTicketLogicBody to avoid LLM API calls.
 */

const mockInvoke = jest.fn();

jest.mock("@/lib/agents/llm", () => ({
  getLlm: jest.fn().mockResolvedValue({ invoke: mockInvoke }),
}));

const mockParseTicketLogicBody = jest.fn();
jest.mock("@/lib/strategies/schema", () => ({
  parseTicketLogicBody: (input: unknown) => mockParseTicketLogicBody(input),
}));

import { extractStrategyFromPaper } from "@/lib/paper-ingest/extract-strategy";

const VALID_BODY = {
  universe: { asset_class: "equity" },
  timeframe: "5m",
  direction: "long",
  indicators: [{ id: "rsi_14", type: "rsi", params: { period: 14 } }],
  entry: {
    conditions: [
      { op: "lt", left: { type: "indicator", id: "rsi_14", bar_offset: 0 }, right: { type: "constant", value: 30 } },
    ],
    sizing: { method: "fixed_notional", value: 200 },
  },
  exit: {
    take_profit: { type: "binary", op: "*", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 1.01 } },
    stop_loss: { type: "binary", op: "*", left: { type: "ohlc", field: "close", bar_offset: 0 }, right: { type: "constant", value: 0.99 } },
    time_stop: "eod",
  },
};

const VALID_LLM_RESPONSE = JSON.stringify({ name: "rsi-oversold-long", body: VALID_BODY });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("extractStrategyFromPaper", () => {
  it("returns ok=true with body and suggestedName on valid LLM response", async () => {
    mockInvoke.mockResolvedValueOnce({ content: VALID_LLM_RESPONSE });
    mockParseTicketLogicBody.mockReturnValueOnce(VALID_BODY);

    const result = await extractStrategyFromPaper({
      title: "RSI Mean Reversion in Equity Markets",
      abstract: "We propose an entry when RSI falls below 30...",
      ticker: "SPY",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedName).toBe("rsi-oversold-long");
    expect(result.body).toEqual(VALID_BODY);
  });

  it("strips markdown fences from LLM response", async () => {
    mockInvoke.mockResolvedValueOnce({
      content: "```json\n" + VALID_LLM_RESPONSE + "\n```",
    });
    mockParseTicketLogicBody.mockReturnValueOnce(VALID_BODY);

    const result = await extractStrategyFromPaper({
      title: "Some paper",
      abstract: "abstract text",
      ticker: "SPY",
    });

    expect(result.ok).toBe(true);
  });

  it("sanitizes suggestedName to slug format", async () => {
    const response = JSON.stringify({ name: "My Strategy With Spaces!", body: VALID_BODY });
    mockInvoke.mockResolvedValueOnce({ content: response });
    mockParseTicketLogicBody.mockReturnValueOnce(VALID_BODY);

    const result = await extractStrategyFromPaper({
      title: "t",
      abstract: "a",
      ticker: "SPY",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedName).toMatch(/^[a-z0-9-]+$/);
  });

  it("returns ok=false with validationErrors when Zod parse fails", async () => {
    mockInvoke.mockResolvedValueOnce({ content: VALID_LLM_RESPONSE });
    mockParseTicketLogicBody.mockImplementationOnce(() => {
      throw new Error("Required field missing: exit.stop_loss");
    });

    const result = await extractStrategyFromPaper({
      title: "t",
      abstract: "a",
      ticker: "SPY",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/schema validation/);
    expect(result.validationErrors).toMatch(/exit.stop_loss/);
  });

  it("returns ok=false when LLM output is not JSON", async () => {
    mockInvoke.mockResolvedValueOnce({
      content: "The paper describes a vague regime-switching model with no concrete entry rules.",
    });

    const result = await extractStrategyFromPaper({
      title: "t",
      abstract: "a",
      ticker: "SPY",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/JSON/);
  });

  it("returns ok=false when LLM call throws", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Groq rate limit exceeded"));

    const result = await extractStrategyFromPaper({
      title: "t",
      abstract: "a",
      ticker: "SPY",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/LLM call failed/);
    expect(result.error).toMatch(/rate limit/);
  });

  it("falls back to 'paper-strategy' when LLM omits the name field", async () => {
    const response = JSON.stringify({ body: VALID_BODY });
    mockInvoke.mockResolvedValueOnce({ content: response });
    mockParseTicketLogicBody.mockReturnValueOnce(VALID_BODY);

    const result = await extractStrategyFromPaper({
      title: "t",
      abstract: "a",
      ticker: "SPY",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedName).toBe("paper-strategy");
  });
});
