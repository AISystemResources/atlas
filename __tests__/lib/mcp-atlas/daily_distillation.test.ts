/**
 * Tests for the daily-distillation MCP tools:
 *   - get_daily_distillation_context (read)
 *   - submit_daily_learning (write)
 *
 * Focus areas (per advisor):
 *   - DST boundary handling (EDT vs EST offset must be detected, not hardcoded)
 *   - Cross-user isolation (other users' trades must not leak)
 *   - Validation rejects (short summary, empty arrays, bad date)
 *   - Upsert behavior (re-submission overwrites prior MCP entry)
 *
 * Supabase + MongoDB clients are mocked to keep the suite hermetic.
 */

// ── DST helper: pure function, test directly ──────────────────────────────────

import { getNyTradingDayBounds, getNyTodayDate } from "@/lib/mcp-atlas/utils";

describe("getNyTradingDayBounds — DST handling", () => {
  it("uses EDT (UTC-4) for a summer date — 2026-06-17", () => {
    const { dayStart, dayEnd } = getNyTradingDayBounds("2026-06-17");
    // EDT midnight 2026-06-17 = 04:00 UTC same day
    expect(dayStart).toBe("2026-06-17T04:00:00.000Z");
    expect(dayEnd).toBe("2026-06-18T04:00:00.000Z");
  });

  it("uses EST (UTC-5) for a winter date — 2026-01-15", () => {
    const { dayStart, dayEnd } = getNyTradingDayBounds("2026-01-15");
    // EST midnight 2026-01-15 = 05:00 UTC same day
    expect(dayStart).toBe("2026-01-15T05:00:00.000Z");
    expect(dayEnd).toBe("2026-01-16T05:00:00.000Z");
  });

  it("uses EDT for the day after spring-forward — 2026-03-09", () => {
    const { dayStart } = getNyTradingDayBounds("2026-03-09");
    expect(dayStart).toBe("2026-03-09T04:00:00.000Z");
  });

  it("uses EST for the day after fall-back — 2026-11-02", () => {
    const { dayStart } = getNyTradingDayBounds("2026-11-02");
    expect(dayStart).toBe("2026-11-02T05:00:00.000Z");
  });

  it("dayEnd is exactly +24h after dayStart in both seasons", () => {
    const summer = getNyTradingDayBounds("2026-07-15");
    const winter = getNyTradingDayBounds("2026-12-15");
    const summerSpan = new Date(summer.dayEnd).getTime() - new Date(summer.dayStart).getTime();
    const winterSpan = new Date(winter.dayEnd).getTime() - new Date(winter.dayStart).getTime();
    expect(summerSpan).toBe(24 * 60 * 60 * 1000);
    expect(winterSpan).toBe(24 * 60 * 60 * 1000);
  });
});

describe("getNyTodayDate", () => {
  it("returns ISO YYYY-MM-DD format", () => {
    const today = getNyTodayDate();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── MCP tool handlers — mocked I/O ────────────────────────────────────────────

const mockFrom = jest.fn();
const mockMongoFindOne = jest.fn();
const mockMongoFind = jest.fn();
const mockMongoToArray = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({ from: mockFrom })),
}));

jest.mock("mongodb", () => {
  const actual = jest.requireActual("mongodb");
  return {
    ...actual,
    MongoClient: jest.fn().mockImplementation(() => ({
      db: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          findOne: mockMongoFindOne,
          find: mockMongoFind,
        }),
      }),
    })),
  };
});

import { handleReadTool } from "@/lib/mcp-atlas/tools/read";
import { handleWriteTool } from "@/lib/mcp-atlas/tools/write";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainable(finalResult: unknown): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.gte = jest.fn().mockReturnValue(chain);
  chain.lt = jest.fn().mockReturnValue(chain);
  chain.order = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.upsert = jest.fn().mockReturnValue(chain);
  chain.maybeSingle = jest.fn().mockResolvedValue(finalResult);
  chain.single = jest.fn().mockResolvedValue(finalResult);
  // Thenable: lets `await chain` resolve to finalResult (Supabase query builder pattern)
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMongoFind.mockReturnValue({ toArray: mockMongoToArray });
});

// ── get_daily_distillation_context ────────────────────────────────────────────

describe("get_daily_distillation_context", () => {
  it("returns empty trades + traces when no trades on that day", async () => {
    mockFrom.mockReturnValueOnce(makeChainable({ data: [], error: null }));

    const result = await handleReadTool(
      "get_daily_distillation_context",
      { date: "2026-06-17" },
      "user_1",
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.trading_date).toBe("2026-06-17");
    expect(payload.trade_count).toBe(0);
    expect(payload.win_count).toBe(0);
    expect(payload.trades).toEqual([]);
    expect(payload.reasoning_traces).toEqual([]);
  });

  it("rejects malformed date", async () => {
    const result = await handleReadTool(
      "get_daily_distillation_context",
      { date: "2026/06/17" },
      "user_1",
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.code).toBe("invalid_input");
    expect(payload.message).toMatch(/YYYY-MM-DD/);
  });

  it("uses DST-aware bounds when querying trades (summer date)", async () => {
    const chain = makeChainable({ data: [], error: null });
    mockFrom.mockReturnValueOnce(chain);

    await handleReadTool(
      "get_daily_distillation_context",
      { date: "2026-06-17" },
      "user_1",
    );
    // .gte should have been called with the EDT bound (04:00:00Z), not EST (05:00:00Z)
    const gteCall = chain.gte.mock.calls.find((c: unknown[]) => c[0] === "executed_at");
    expect(gteCall).toBeDefined();
    expect(gteCall![1]).toBe("2026-06-17T04:00:00.000Z");
  });

  it("filters by user_id (cross-user isolation)", async () => {
    const chain = makeChainable({ data: [], error: null });
    mockFrom.mockReturnValueOnce(chain);

    await handleReadTool(
      "get_daily_distillation_context",
      { date: "2026-06-17" },
      "user_abc",
    );
    const eqCall = chain.eq.mock.calls.find(
      (c: unknown[]) => c[0] === "user_id" && c[1] === "user_abc",
    );
    expect(eqCall).toBeDefined();
  });

  it("computes win_count from trades with positive realized_pnl", async () => {
    const trades = [
      { id: "t1", realized_pnl: 50, signal_id: null },
      { id: "t2", realized_pnl: -20, signal_id: null },
      { id: "t3", realized_pnl: 100, signal_id: null },
      { id: "t4", realized_pnl: null, signal_id: null },
    ];
    mockFrom.mockReturnValueOnce(makeChainable({ data: trades, error: null }));

    const result = await handleReadTool(
      "get_daily_distillation_context",
      { date: "2026-06-17" },
      "user_1",
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.trade_count).toBe(4);
    expect(payload.win_count).toBe(2);
  });
});

// ── submit_daily_learning ─────────────────────────────────────────────────────

describe("submit_daily_learning", () => {
  const validInput = {
    date: "2026-06-17",
    summary: "Tech sector underperformed on rate-hike news; sentiment lagged price action.",
    key_observations: [
      "NVDA dropped 3% after 14:00 ET on Fed minutes release",
      "AAPL held steady despite broad tech weakness",
    ],
    recommendations: [
      "Reduce tech exposure tomorrow until Fed clarity",
      "Watch AAPL for relative strength signal",
    ],
  };

  it("rejects malformed date", async () => {
    const result = await handleWriteTool(
      "submit_daily_learning",
      { ...validInput, date: "06-17-2026" },
      "user_1",
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.code).toBe("invalid_input");
  });

  it("rejects summary that's too short", async () => {
    const result = await handleWriteTool(
      "submit_daily_learning",
      { ...validInput, summary: "ok" },
      "user_1",
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.code).toBe("invalid_input");
  });

  it("rejects empty key_observations", async () => {
    const result = await handleWriteTool(
      "submit_daily_learning",
      { ...validInput, key_observations: [] },
      "user_1",
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.code).toBe("invalid_input");
  });

  it("rejects empty recommendations", async () => {
    const result = await handleWriteTool(
      "submit_daily_learning",
      { ...validInput, recommendations: [] },
      "user_1",
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.code).toBe("invalid_input");
  });

  it("rejects observations and recommendations that are too short (<10 chars)", async () => {
    const result = await handleWriteTool(
      "submit_daily_learning",
      {
        ...validInput,
        key_observations: ["short"],
        recommendations: ["meh"],
      },
      "user_1",
    );
    const payload = JSON.parse(result.content[0].text);
    expect(payload.code).toBe("invalid_input");
  });

  it("upserts with source='mcp' when input is valid", async () => {
    // First call (trades query for trade_count/win_count) returns empty
    const tradesChain = makeChainable({ data: [], error: null });
    // Second call (upsert) returns inserted row
    const upsertChain = makeChainable({
      data: {
        id: "uuid-1",
        trading_date: "2026-06-17",
        trade_count: 0,
        win_count: 0,
        source: "mcp",
        created_at: "2026-06-17T20:00:00Z",
        updated_at: "2026-06-17T20:00:00Z",
      },
      error: null,
    });
    mockFrom.mockReturnValueOnce(tradesChain).mockReturnValueOnce(upsertChain);

    const result = await handleWriteTool("submit_daily_learning", validInput, "user_1");
    const payload = JSON.parse(result.content[0].text);
    expect(payload.source).toBe("mcp");
    expect(payload.trading_date).toBe("2026-06-17");

    // upsert was called with onConflict
    const upsertCall = upsertChain.upsert.mock.calls[0];
    expect(upsertCall[0]).toMatchObject({
      user_id: "user_1",
      trading_date: "2026-06-17",
      source: "mcp",
    });
    expect(upsertCall[1]).toEqual({ onConflict: "user_id,trading_date" });
  });
});
