/**
 * Crypto symbol detection (Sprint 050a).
 *
 * The "/" separator is the unambiguous marker — equity tickers never contain it,
 * crypto pairs always do.
 */

import { isCryptoSymbol } from "@/lib/market/alpaca";

describe("isCryptoSymbol", () => {
  it("recognises crypto pairs by the slash separator", () => {
    expect(isCryptoSymbol("BTC/USD")).toBe(true);
    expect(isCryptoSymbol("ETH/USD")).toBe(true);
    expect(isCryptoSymbol("SOL/USD")).toBe(true);
    expect(isCryptoSymbol("BTC/USDT")).toBe(true);
  });

  it("rejects equity tickers", () => {
    expect(isCryptoSymbol("AAPL")).toBe(false);
    expect(isCryptoSymbol("DIA")).toBe(false);
    expect(isCryptoSymbol("BRK.B")).toBe(false);  // dot, not slash
    expect(isCryptoSymbol("^DJI")).toBe(false);
  });

  it("treats empty string as not crypto", () => {
    expect(isCryptoSymbol("")).toBe(false);
  });
});
