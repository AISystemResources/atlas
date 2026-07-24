/**
 * Sprint 054 — parity test for the live-scalper rewire.
 *
 * Proves that detectStrategySignal (the new ticket_logics-driven signal
 * producer) emits entry/SL/TP prices that match the legacy
 * buildS1LongTicket output to 4 dp on a fixture that triggers Edmund S1.
 *
 * The legacy detectS1Signal + buildS1LongTicket code in lib/indicators and
 * lib/signals still exists but is no longer wired into production — its
 * sole remaining role is to be the oracle for this parity test.
 */

import {
  detectStrategySignal,
  type ActiveStrategy,
} from "@/lib/scheduler/ticket-adapter";
import { EDMUND_S1_LONG_V1 } from "@/lib/strategies/seeds";
import type { TicketLogic } from "@/lib/strategies/types";
import { detectS1Signal, computeIndicators } from "@/lib/indicators";
import { buildS1LongTicket } from "@/lib/signals/types";

function makeStrategy(): ActiveStrategy {
  const logic: TicketLogic = {
    id: "00000000-0000-0000-0000-000000000001",
    name: "edmund-s1-long",
    version: 1,
    parent_version_id: null,
    description: "test fixture",
    body: EDMUND_S1_LONG_V1,
    status: "active",
    created_by: "default",
    created_at: new Date().toISOString(),
  };
  return { logic };
}

/** Same fixture as __tests__/lib/strategies/evaluate.test.ts — reliably fires S1 */
function makeS1TriggerBars() {
  const closes = Array.from({ length: 25 }, (_, i) => 99 + i * 0.1);
  const bars = closes.map((c, i) => ({
    open: i > 0 ? closes[i - 1] : c,
    high: c + 0.3,
    low: c - 0.3,
    close: c,
  }));
  bars.push({ open: 101.3, high: 101.5, low: 96, close: 100.5 });
  bars.push({ open: 100, high: 101, low: 99.5, close: 100.8 });
  return bars;
}

describe("detectStrategySignal (Sprint 054 live-scalper rewire)", () => {
  it("fires a signal on the bullish-S1 fixture", () => {
    const strategy = makeStrategy();
    const bars = makeS1TriggerBars();
    const signal = detectStrategySignal(strategy, bars);

    expect(signal).not.toBeNull();
    expect(signal!.direction).toBe("long");
    expect(signal!.logic_name).toBe("edmund-s1-long");
    expect(signal!.logic_version).toBe(1);
    expect(signal!.notional_dollars).toBe(200);
  });

  it("entry/SL/TP match buildS1LongTicket output to 4 dp (parity oracle)", () => {
    const strategy = makeStrategy();
    const bars = makeS1TriggerBars();

    // Sanity: the legacy detector also fires on this fixture.
    const legacy = detectS1Signal(bars);
    expect(legacy).not.toBeNull();

    const signal = detectStrategySignal(strategy, bars);
    expect(signal).not.toBeNull();

    const signalBar = bars[bars.length - 1];
    const atrInd = computeIndicators(bars, 14)!;
    const legacyTicket = buildS1LongTicket({
      ticker: "TEST",
      signal_bar_high: signalBar.high,
      signal_bar_low: signalBar.low,
      atr: atrInd.atr,
      notional_dollars: 200,
      current_price: signalBar.close,
    });
    expect(legacyTicket).not.toBeNull();

    // The new ticket_logics-driven path MUST agree with the legacy oracle.
    // If this ever drifts, either (a) the JSON body of edmund-s1-long v1 was
    // mis-edited, or (b) the legacy hardcoded path was changed in isolation.
    expect(signal!.entry_price).toBeCloseTo(legacyTicket!.entry_price, 3);
    expect(signal!.stop_loss).toBeCloseTo(legacyTicket!.stop_loss, 3);
    expect(signal!.take_profit).toBeCloseTo(legacyTicket!.take_profit, 3);
  });

  it("returns null when no entry fires on the latest bar", () => {
    const strategy = makeStrategy();
    const fallingBars = Array.from({ length: 35 }, (_, i) => ({
      open: 100 - i * 0.5,
      high: 101 - i * 0.5,
      low: 99 - i * 0.5,
      close: 100 - i * 0.5,
    }));
    const signal = detectStrategySignal(strategy, fallingBars);
    expect(signal).toBeNull();
  });

  it("returns null on empty bars (defensive)", () => {
    const strategy = makeStrategy();
    expect(detectStrategySignal(strategy, [])).toBeNull();
  });

  it("indicator_snapshot includes rsi_21 and atr_14 (needed for log messages)", () => {
    const strategy = makeStrategy();
    const bars = makeS1TriggerBars();
    const signal = detectStrategySignal(strategy, bars);
    expect(signal).not.toBeNull();
    expect(signal!.indicator_snapshot).toHaveProperty("rsi_21");
    expect(signal!.indicator_snapshot).toHaveProperty("atr_14");
  });
});
