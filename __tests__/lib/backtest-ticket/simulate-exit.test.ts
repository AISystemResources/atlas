/**
 * Exit simulator tests — Sprint 053b.
 *
 * Covers all five exit reasons and the SL-first conservative-bias
 * convention on straddled bars.
 */

import { simulateExit } from "@/lib/backtest-ticket/simulate-exit";
import type { Bar } from "@/lib/strategies/indicators";

function bar(
  ts: string,
  open: number,
  high: number,
  low: number,
  close: number,
): Bar {
  return { timestamp: ts, open, high, low, close };
}

describe("simulateExit — long direction", () => {
  it("hits TP cleanly", () => {
    const bars = [
      bar("2026-06-01T14:30:00Z", 100, 101, 99, 100),  // entry bar
      bar("2026-06-01T14:35:00Z", 100, 102, 99.5, 101), // no exit
      bar("2026-06-01T14:40:00Z", 101, 105, 100, 104),  // TP=103 hit (high=105)
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 103,
      stopLossPrice: 97,
      direction: "long",
      bars,
    });
    expect(result.exitReason).toBe("tp_hit");
    expect(result.exitBarIndex).toBe(2);
    expect(result.exitPrice).toBe(103);
  });

  it("hits SL cleanly", () => {
    const bars = [
      bar("2026-06-01T14:30:00Z", 100, 101, 99, 100),
      bar("2026-06-01T14:35:00Z", 100, 101, 96, 97),   // SL=97 hit (low=96)
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 103,
      stopLossPrice: 97,
      direction: "long",
      bars,
    });
    expect(result.exitReason).toBe("sl_hit");
    expect(result.exitPrice).toBe(97);
  });

  it("on straddled bar (both TP and SL hit), reports SL (conservative)", () => {
    const bars = [
      bar("2026-06-01T14:30:00Z", 100, 101, 99, 100),
      bar("2026-06-01T14:35:00Z", 100, 105, 95, 100),  // straddles SL=97 AND TP=103
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 103,
      stopLossPrice: 97,
      direction: "long",
      bars,
    });
    expect(result.exitReason).toBe("sl_hit");
    expect(result.exitPrice).toBe(97);
  });

  it("returns open_at_end when no exit triggers", () => {
    const bars = [
      bar("2026-06-01T14:30:00Z", 100, 101, 99, 100),
      bar("2026-06-01T14:35:00Z", 100, 101.5, 99, 101),
      bar("2026-06-01T14:40:00Z", 101, 102, 100, 101.5),
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 105,
      stopLossPrice: 95,
      direction: "long",
      bars,
    });
    expect(result.exitReason).toBe("open_at_end");
    expect(result.exitPrice).toBe(101.5);
  });

  it("EOD time stop exits at the close of the entry day", () => {
    const bars = [
      bar("2026-06-01T14:30:00Z", 100, 101, 99, 100),   // entry bar (day 1)
      bar("2026-06-01T15:00:00Z", 100, 101, 99, 100.5),
      bar("2026-06-01T20:00:00Z", 100, 101, 99, 102),   // last bar of day 1 (close=102)
      bar("2026-06-02T14:30:00Z", 102, 103, 101, 102.5), // first bar of day 2
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 90,
      direction: "long",
      bars,
      timeStop: "eod",
    });
    expect(result.exitReason).toBe("eod");
    expect(result.exitBarIndex).toBe(2);
    expect(result.exitPrice).toBe(102);
  });

  it("EOD time stop on a same-day-truncated series exits at last bar with reason eod", () => {
    // Bars end on the entry day with no day-2 bar (e.g., end_date == entry date).
    // Position should close at the last bar with reason "eod", not "open_at_end".
    const bars = [
      bar("2026-06-01T14:30:00Z", 100, 101, 99, 100),
      bar("2026-06-01T15:00:00Z", 100, 101, 99, 100.5),
      bar("2026-06-01T20:55:00Z", 100, 101, 99, 101.2), // last bar (no day-2 follow)
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 90,
      direction: "long",
      bars,
      timeStop: "eod",
    });
    expect(result.exitReason).toBe("eod");
    expect(result.exitBarIndex).toBe(2);
    expect(result.exitPrice).toBe(101.2);
  });

  it("N-bar time stop exits at the Nth bar after entry", () => {
    const bars = [
      bar("2026-06-01T14:30:00Z", 100, 101, 99, 100),  // entry
      bar("2026-06-01T14:35:00Z", 100, 101, 99, 100.2),
      bar("2026-06-01T14:40:00Z", 100, 101, 99, 100.5),
      bar("2026-06-01T14:45:00Z", 100, 101, 99, 100.7), // bar 3 after entry
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 90,
      direction: "long",
      bars,
      timeStop: { bars: 3 },
    });
    expect(result.exitReason).toBe("time_stop");
    expect(result.exitBarIndex).toBe(3);
    expect(result.exitPrice).toBe(100.7);
  });
});

describe("simulateExit — short direction (mirror)", () => {
  it("hits TP cleanly (price drops below TP)", () => {
    const bars = [
      bar("2026-06-01T14:30:00Z", 100, 101, 99, 100),
      bar("2026-06-01T14:35:00Z", 100, 100, 96, 97),  // low=96 < TP=98
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 98,
      stopLossPrice: 102,
      direction: "short",
      bars,
    });
    expect(result.exitReason).toBe("tp_hit");
    expect(result.exitPrice).toBe(98);
  });

  it("hits SL cleanly (price spikes above SL)", () => {
    const bars = [
      bar("2026-06-01T14:30:00Z", 100, 101, 99, 100),
      bar("2026-06-01T14:35:00Z", 100, 103, 99, 102),  // high=103 > SL=102
    ];
    const result = simulateExit({
      entryBarIndex: 0,
      entryPrice: 100,
      takeProfitPrice: 98,
      stopLossPrice: 102,
      direction: "short",
      bars,
    });
    expect(result.exitReason).toBe("sl_hit");
    expect(result.exitPrice).toBe(102);
  });
});
