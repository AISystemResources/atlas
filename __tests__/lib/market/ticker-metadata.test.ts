/**
 * Sprint 071 — ticker metadata helper tests.
 */

import { describeCapabilities, kindLabel } from "@/lib/market/ticker-metadata";
import type { TickerMetadata } from "@/lib/market/ticker-metadata";

function meta(overrides: Partial<TickerMetadata> = {}): TickerMetadata {
  return {
    ticker: "AAPL",
    kind: "equity",
    display_name: "Apple Inc.",
    has_fundamental_data: false,
    has_sentiment_data: false,
    has_technical_data: true,
    exchange: "NASDAQ",
    currency: "USD",
    description: null,
    ...overrides,
  };
}

describe("describeCapabilities", () => {
  it("lists only technical for an index", () => {
    expect(
      describeCapabilities(meta({ kind: "index", has_technical_data: true })),
    ).toEqual(["Technical"]);
  });

  it("lists technical + fundamentals + sentiment for an equity with all flags", () => {
    expect(
      describeCapabilities(
        meta({ has_fundamental_data: true, has_sentiment_data: true }),
      ),
    ).toEqual(["Technical", "Fundamentals", "Sentiment"]);
  });

  it("omits technical when the flag is off (unusual but supported)", () => {
    expect(
      describeCapabilities(meta({ has_technical_data: false })),
    ).toEqual([]);
  });
});

describe("kindLabel", () => {
  it("capitalizes kind names", () => {
    expect(kindLabel("equity")).toBe("Equity");
    expect(kindLabel("etf")).toBe("ETF");
    expect(kindLabel("index")).toBe("Index");
    expect(kindLabel("crypto")).toBe("Crypto");
  });
});
