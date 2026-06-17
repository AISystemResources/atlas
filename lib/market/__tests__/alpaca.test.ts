/**
 * Tests for fetchBars and fetchNews (alpaca.ts)
 * Mocks @alpacahq/alpaca-trade-api to avoid live API calls.
 */

// Set required env vars before any module loads
process.env.ALPACA_API_KEY = "test-key";
process.env.ALPACA_SECRET_KEY = "test-secret";

// Mock the Alpaca SDK
// @alpacahq/alpaca-trade-api uses module.exports = class, so the mock must
// return the constructor directly (not wrapped in { default: ... })
const mockGetBarsV2 = jest.fn();
const mockGetNews = jest.fn();

jest.mock("@alpacahq/alpaca-trade-api", () => {
  const MockAlpaca = jest.fn().mockImplementation(() => ({
    getBarsV2: mockGetBarsV2,
    getNews: mockGetNews,
  }));
  // CJS interop: module.exports = class, so return MockAlpaca directly
  // AND attach as default for esModuleInterop
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (MockAlpaca as any).default = MockAlpaca;
  return MockAlpaca;
});

import { fetchBars, fetchNews } from "../alpaca";

beforeEach(() => {
  jest.clearAllMocks();
});

// Helper: build an async generator from an array
async function* toAsyncGen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

describe("fetchBars", () => {
  it("returns correctly shaped Bar objects from Alpaca bars", async () => {
    const rawBars = [
      {
        Timestamp: "2024-01-02T05:00:00Z",
        OpenPrice: 185.0,
        HighPrice: 190.0,
        LowPrice: 183.0,
        ClosePrice: 188.5,
        Volume: 50_000_000,
      },
      {
        Timestamp: "2024-01-03T05:00:00Z",
        OpenPrice: 188.5,
        HighPrice: 192.0,
        LowPrice: 187.0,
        ClosePrice: 191.0,
        Volume: 45_000_000,
      },
    ];
    mockGetBarsV2.mockReturnValue(toAsyncGen(rawBars));

    const bars = await fetchBars("AAPL", "2024-01-01", "2024-01-05");

    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({
      date: "2024-01-02",
      open: 185.0,
      high: 190.0,
      low: 183.0,
      close: 188.5,
      volume: 50_000_000,
    });
    expect(bars[1]).toEqual({
      date: "2024-01-03",
      open: 188.5,
      high: 192.0,
      low: 187.0,
      close: 191.0,
      volume: 45_000_000,
    });
  });

  it("passes start, end, and timeframe to the SDK", async () => {
    mockGetBarsV2.mockReturnValue(toAsyncGen([]));

    await fetchBars("TSLA", "2024-03-01", "2024-03-31", "1Hour");

    expect(mockGetBarsV2).toHaveBeenCalledWith(
      "TSLA",
      expect.objectContaining({
        start: "2024-03-01",
        end: "2024-03-31",
        timeframe: "1Hour",
      })
    );
  });

  it("defaults to 1Day timeframe when not specified", async () => {
    mockGetBarsV2.mockReturnValue(toAsyncGen([]));

    await fetchBars("MSFT", "2024-01-01", "2024-01-31");

    expect(mockGetBarsV2).toHaveBeenCalledWith(
      "MSFT",
      expect.objectContaining({ timeframe: "1Day" })
    );
  });

  it("returns empty array when SDK throws", async () => {
    mockGetBarsV2.mockImplementation(() => {
      throw new Error("API error");
    });

    const bars = await fetchBars("BOGUS", "2024-01-01", "2024-01-31");
    expect(bars).toEqual([]);
  });

  it("slices timestamp to date-only (YYYY-MM-DD)", async () => {
    const rawBars = [
      {
        Timestamp: "2024-06-15T14:30:00.000Z",
        OpenPrice: 100,
        HighPrice: 105,
        LowPrice: 99,
        ClosePrice: 103,
        Volume: 1_000_000,
      },
    ];
    mockGetBarsV2.mockReturnValue(toAsyncGen(rawBars));

    const bars = await fetchBars("SPY", "2024-06-15", "2024-06-15");
    expect(bars[0].date).toBe("2024-06-15");
  });
});

describe("fetchNews", () => {
  const sampleArticles = [
    { Headline: "Apple beats earnings", CreatedAt: "2024-01-15T10:00:00Z" },
    { Headline: "New iPhone announced", CreatedAt: "2024-01-14T09:30:00Z" },
  ];

  it("returns correctly shaped NewsItem objects", async () => {
    mockGetNews.mockResolvedValue(sampleArticles);

    const news = await fetchNews("AAPL");

    expect(news).toHaveLength(2);
    expect(news[0]).toEqual({
      title: "Apple beats earnings",
      published: "2024-01-15T10:00:00Z",
    });
    expect(news[1]).toEqual({
      title: "New iPhone announced",
      published: "2024-01-14T09:30:00Z",
    });
  });

  it("backtest path: passes end bound to SDK when opts.end is provided", async () => {
    mockGetNews.mockResolvedValue([]);

    await fetchNews("AAPL", { end: "2024-01-15" });

    expect(mockGetNews).toHaveBeenCalledWith(
      expect.objectContaining({
        symbols: ["AAPL"],
        end: "2024-01-15",
      })
    );
    // No 'start' in backtest mode
    const callArgs = mockGetNews.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("start");
  });

  it("live path: passes start bound (now-7d) to SDK when opts.end is absent", async () => {
    mockGetNews.mockResolvedValue([]);

    const before = Date.now();
    await fetchNews("MSFT");
    const after = Date.now();

    expect(mockGetNews).toHaveBeenCalledWith(
      expect.objectContaining({ symbols: ["MSFT"] })
    );
    const callArgs = mockGetNews.mock.calls[0][0];
    expect(callArgs).toHaveProperty("start");
    expect(callArgs).not.toHaveProperty("end");

    // start should be approx 7 days before now
    const startDate = new Date(callArgs.start).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(startDate).toBeGreaterThanOrEqual(before - sevenDaysMs - 1000);
    expect(startDate).toBeLessThanOrEqual(after - sevenDaysMs + 1000);
  });

  it("respects custom limit option", async () => {
    mockGetNews.mockResolvedValue([]);

    await fetchNews("TSLA", { limit: 5 });

    expect(mockGetNews).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 })
    );
  });

  it("defaults limit to 10", async () => {
    mockGetNews.mockResolvedValue([]);

    await fetchNews("TSLA");

    expect(mockGetNews).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 })
    );
  });

  it("returns empty array when SDK throws", async () => {
    mockGetNews.mockRejectedValue(new Error("API error"));

    const news = await fetchNews("BOGUS");
    expect(news).toEqual([]);
  });
});
