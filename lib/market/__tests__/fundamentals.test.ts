/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for fetchTickerInfo (fundamentals.ts)
 * Mocks yahoo-finance2 to avoid live API calls.
 */

// Mock yahoo-finance2 before any imports.
// yahoo-finance2 v3 uses exports.default = YahooFinance (ESM-style CJS),
// so we must return { default: MockClass } for esModuleInterop.
jest.mock("yahoo-finance2", () => {
  const mockQuoteSummary = jest.fn();
  const MockYahooFinance = jest.fn().mockImplementation(() => ({
    quoteSummary: mockQuoteSummary,
  }));
  // Expose mock for access in tests
  (MockYahooFinance as any).__mockQuoteSummary = mockQuoteSummary;
  return {
    __esModule: true,
    default: MockYahooFinance,
  };
});

import YahooFinance from "yahoo-finance2";
import { fetchTickerInfo } from "../fundamentals";
import type { AtlasTickerInfo } from "../types";

const MockYF = YahooFinance as jest.MockedClass<typeof YahooFinance>;
const mockQuoteSummary = (MockYF as any).__mockQuoteSummary as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

/** Full stub response covering all 18 keys */
function buildFullStub(): Record<string, any> {
  return {
    price: {
      shortName: "Apple Inc.",
      marketCap: 3_000_000_000_000,
      regularMarketPrice: 195.0,
    },
    assetProfile: {
      sector: "Technology",
      industry: "Consumer Electronics",
    },
    defaultKeyStatistics: {
      trailingPE: 28.5,
      forwardPE: 26.0,
      priceToBook: 45.2,
      profitMargins: 0.25,
    },
    summaryDetail: {
      fiftyTwoWeekHigh: 220.0,
      fiftyTwoWeekLow: 150.0,
      marketCap: 3_000_000_000_000,
    },
    financialData: {
      revenueGrowth: 0.05,
      earningsGrowth: 0.08,
      profitMargins: 0.25,
      debtToEquity: 180.0,
      returnOnEquity: 1.47,
      currentRatio: 1.07,
      currentPrice: 195.0,
      targetMeanPrice: 210.0,
      recommendationMean: 1.8,
    },
  };
}

describe("fetchTickerInfo", () => {
  it("returns all 18 keys for a healthy ticker (AAPL)", async () => {
    mockQuoteSummary.mockResolvedValue(buildFullStub());

    const result = await fetchTickerInfo("AAPL");

    const expectedKeys: (keyof AtlasTickerInfo)[] = [
      "shortName", "sector", "industry",
      "trailingPE", "forwardPE", "priceToBook",
      "revenueGrowth", "earningsGrowth", "profitMargins",
      "debtToEquity", "returnOnEquity", "currentRatio",
      "marketCap", "fiftyTwoWeekHigh", "fiftyTwoWeekLow",
      "currentPrice", "targetMeanPrice", "recommendationMean",
    ];

    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key);
    }

    expect(result.shortName).toBe("Apple Inc.");
    expect(result.sector).toBe("Technology");
    expect(result.industry).toBe("Consumer Electronics");
    expect(result.trailingPE).toBe(28.5);
    expect(result.forwardPE).toBe(26.0);
    expect(result.priceToBook).toBe(45.2);
    expect(result.revenueGrowth).toBe(0.05);
    expect(result.earningsGrowth).toBe(0.08);
    expect(result.debtToEquity).toBe(180.0);
    expect(result.returnOnEquity).toBe(1.47);
    expect(result.currentRatio).toBe(1.07);
    expect(result.marketCap).toBe(3_000_000_000_000);
    expect(result.fiftyTwoWeekHigh).toBe(220.0);
    expect(result.fiftyTwoWeekLow).toBe(150.0);
    expect(result.currentPrice).toBe(195.0);
    expect(result.targetMeanPrice).toBe(210.0);
    expect(result.recommendationMean).toBe(1.8);
  });

  it("returns null for debtToEquity and currentRatio for bank tickers (JPM/BAC pattern)", async () => {
    const stub = buildFullStub();
    stub.financialData = {
      ...stub.financialData,
      debtToEquity: null as any,
      currentRatio: null as any,
    };
    mockQuoteSummary.mockResolvedValue(stub);

    const result = await fetchTickerInfo("JPM");
    expect(result.debtToEquity).toBeNull();
    expect(result.currentRatio).toBeNull();
    // other fields still present
    expect(result.shortName).toBe("Apple Inc.");
  });

  it("returns null for trailingPE and earningsGrowth for loss-quarter tickers (INTC pattern)", async () => {
    const stub = buildFullStub();
    stub.defaultKeyStatistics = {
      ...stub.defaultKeyStatistics,
      trailingPE: null as any,
    };
    stub.summaryDetail = {
      ...stub.summaryDetail,
      trailingPE: undefined as any,
    };
    stub.financialData = {
      ...stub.financialData,
      earningsGrowth: null as any,
    };
    mockQuoteSummary.mockResolvedValue(stub);

    const result = await fetchTickerInfo("INTC");
    expect(result.trailingPE).toBeNull();
    expect(result.earningsGrowth).toBeNull();
    // other fields not affected
    expect(result.forwardPE).toBe(26.0);
  });

  it("returns all-null AtlasTickerInfo when quoteSummary throws", async () => {
    mockQuoteSummary.mockRejectedValue(new Error("Network error"));

    const result = await fetchTickerInfo("BOGUS");

    const keys: (keyof AtlasTickerInfo)[] = [
      "shortName", "sector", "industry",
      "trailingPE", "forwardPE", "priceToBook",
      "revenueGrowth", "earningsGrowth", "profitMargins",
      "debtToEquity", "returnOnEquity", "currentRatio",
      "marketCap", "fiftyTwoWeekHigh", "fiftyTwoWeekLow",
      "currentPrice", "targetMeanPrice", "recommendationMean",
    ];

    for (const key of keys) {
      expect(result[key]).toBeNull();
    }
  });

  it("falls back to summaryDetail.marketCap when price.marketCap is missing", async () => {
    const stub = buildFullStub();
    stub.price = { shortName: "Test Corp", marketCap: undefined as any, regularMarketPrice: 50 };
    stub.summaryDetail = { ...stub.summaryDetail, marketCap: 999_000_000 };
    mockQuoteSummary.mockResolvedValue(stub);

    const result = await fetchTickerInfo("TEST");
    expect(result.marketCap).toBe(999_000_000);
  });

  it("uses price.regularMarketPrice as currentPrice fallback", async () => {
    const stub = buildFullStub();
    stub.financialData = { ...stub.financialData, currentPrice: undefined as any };
    stub.price = { ...stub.price, regularMarketPrice: 182.5 };
    mockQuoteSummary.mockResolvedValue(stub);

    const result = await fetchTickerInfo("AAPL");
    expect(result.currentPrice).toBe(182.5);
  });
});
