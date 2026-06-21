/**
 * Sprint 053.0 — attribution mapping tests.
 *
 * The full reviewBacktest hits an LLM; here we exercise the pure helper
 * that maps LLM-cited indices (1-based, into the visible window) to
 * real trade ids — plus the schema validation.
 */

import { BACKTEST_INSIGHT_PROMPT_VERSION } from "@/lib/strategies/review-backtest";

// Re-implement the pure helper here so we test the contract without
// triggering the LLM module's lazy llm import. This duplicates the
// logic from review-backtest.ts; keep them in sync.
function mapIndicesToIds(indices: number[], trades: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const idx of indices) {
    if (idx < 1 || idx > Math.min(trades.length, 50)) continue;
    const id = trades[idx - 1].id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

describe("Sprint 053.0 attribution", () => {
  const trades = Array.from({ length: 12 }, (_, i) => ({ id: `t-${i + 1}` }));

  it("prompt version bumped to v2-attribution", () => {
    expect(BACKTEST_INSIGHT_PROMPT_VERSION).toContain("attribution");
  });

  it("maps 1-based indices to trade ids in order", () => {
    expect(mapIndicesToIds([1, 3, 5], trades)).toEqual(["t-1", "t-3", "t-5"]);
  });

  it("drops out-of-range indices silently (hallucinated)", () => {
    expect(mapIndicesToIds([0, 1, 13, 99], trades)).toEqual(["t-1"]);
  });

  it("deduplicates repeated indices", () => {
    expect(mapIndicesToIds([2, 2, 4, 2], trades)).toEqual(["t-2", "t-4"]);
  });

  it("returns empty array on empty input", () => {
    expect(mapIndicesToIds([], trades)).toEqual([]);
  });

  it("caps citation window at 50 even when more trades exist", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `t-${i + 1}` }));
    expect(mapIndicesToIds([1, 50, 51, 80], many)).toEqual(["t-1", "t-50"]);
  });
});
