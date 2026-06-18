/**
 * Sprint 049 — Ticket Logic unit tests.
 *
 * Verifies the signal-layer math is deterministic: same inputs → same ticket.
 */

import {
  computeWholeShareQty,
  buildS1LongTicket,
} from "@/lib/signals/types";

describe("computeWholeShareQty", () => {
  it("returns floor(notional / price) when price > 0", () => {
    expect(computeWholeShareQty(200, 50)).toBe(4);
    expect(computeWholeShareQty(200, 67)).toBe(2);
    expect(computeWholeShareQty(200, 199.99)).toBe(1);
  });

  it("returns 0 when notional cannot afford a single share", () => {
    expect(computeWholeShareQty(200, 400)).toBe(0);
    expect(computeWholeShareQty(50, 100)).toBe(0);
  });

  it("returns 0 for non-positive inputs", () => {
    expect(computeWholeShareQty(0, 50)).toBe(0);
    expect(computeWholeShareQty(-100, 50)).toBe(0);
    expect(computeWholeShareQty(200, 0)).toBe(0);
    expect(computeWholeShareQty(200, -50)).toBe(0);
  });
});

describe("buildS1LongTicket — default Sandy S1 mechanics", () => {
  const baseInput = {
    ticker: "AAPL",
    signal_bar_high: 200,
    signal_bar_low: 198,
    atr: 2,
    notional_dollars: 1000,
    current_price: 199.5,
  };

  it("produces a deterministic ticket with default params", () => {
    const t = buildS1LongTicket(baseInput);
    expect(t).not.toBeNull();
    expect(t!.ticker).toBe("AAPL");
    expect(t!.action).toBe("BUY");
    expect(t!.strategy).toBe("scalper");
    expect(t!.time_in_force).toBe("day");
    // entry = SB_high * (1 + 0.05/100) = 200 * 1.0005 = 200.1
    expect(t!.entry_price).toBeCloseTo(200.1, 4);
    // stop = SB_low * (1 - 0.5/100) = 198 * 0.995 = 197.01
    expect(t!.stop_loss).toBeCloseTo(197.01, 4);
    // target = entry + atr * 0.5 = 200.1 + 1 = 201.1
    expect(t!.take_profit).toBeCloseTo(201.1, 4);
    // qty = floor(1000 / 199.5) = 5
    expect(t!.qty).toBe(5);
  });

  it("returns null when notional cannot fit a single share", () => {
    const t = buildS1LongTicket({ ...baseInput, notional_dollars: 50 });
    expect(t).toBeNull();
  });

  it("respects custom stop_buffer_pct (tighter stop = higher stop_loss)", () => {
    const tight = buildS1LongTicket({ ...baseInput, stop_buffer_pct: 0.1 });
    const wide = buildS1LongTicket({ ...baseInput, stop_buffer_pct: 1.0 });
    expect(tight!.stop_loss).toBeGreaterThan(wide!.stop_loss);
  });

  it("respects custom target_atr_multiple (larger multiple = higher take_profit)", () => {
    const conservative = buildS1LongTicket({ ...baseInput, target_atr_multiple: 0.3 });
    const ambitious = buildS1LongTicket({ ...baseInput, target_atr_multiple: 1.0 });
    expect(ambitious!.take_profit).toBeGreaterThan(conservative!.take_profit);
  });

  it("records signal metadata for the audit trail", () => {
    const t = buildS1LongTicket(baseInput);
    expect(t!.signal_metadata).toMatchObject({
      signal_bar_high: 200,
      signal_bar_low: 198,
      atr: 2,
      stop_buffer_pct: 0.5,
      target_atr_multiple: 0.5,
      entry_buffer_pct: 0.05,
    });
  });

  it("returns null when degenerate signal would invert risk-reward (take_profit <= entry)", () => {
    // With atr=0 the target collapses to entry exactly — guard rejects.
    const t = buildS1LongTicket({ ...baseInput, atr: 0 });
    expect(t).toBeNull();
  });

  it("returns null when stop would be at or above entry (signal bar inverted)", () => {
    // signal_bar_low > signal_bar_high — pathological signal
    const t = buildS1LongTicket({
      ...baseInput,
      signal_bar_high: 198,
      signal_bar_low: 200,
    });
    expect(t).toBeNull();
  });
});
