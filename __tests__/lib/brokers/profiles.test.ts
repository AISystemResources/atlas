/**
 * Sprint 077B — BrokerProfile catalog + fill friction tests.
 */

import {
  BROKER_PROFILES,
  applyFillFriction,
  getBrokerProfile,
} from "@/lib/brokers/profiles";

describe("BrokerProfile catalog", () => {
  it("includes the pure reference profile", () => {
    const pure = getBrokerProfile("pure");
    expect(pure.spread.half_spread_bps).toBe(0);
    expect(pure.slippage.additive_bps).toBe(0);
    expect(Object.keys(pure.commission)).toHaveLength(0);
  });

  it("seeds all canonical profiles", () => {
    const ids = new Set(BROKER_PROFILES.map((p) => p.id));
    for (const id of ["pure", "ibkr-paper", "pepperstone-cfd-dow"]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("throws on unknown profile id", () => {
    expect(() => getBrokerProfile("does-not-exist")).toThrow();
  });
});

describe("applyFillFriction", () => {
  it("pure profile: fillPrice == referencePrice, zero commission", () => {
    const out = applyFillFriction(getBrokerProfile("pure"), {
      action: "BUY",
      referencePrice: 100,
      qty: 10,
      asset: "equity",
    });
    expect(out.fillPrice).toBe(100);
    expect(out.commission).toBe(0);
  });

  it("ibkr-paper: commission per-share with min", () => {
    const out = applyFillFriction(getBrokerProfile("ibkr-paper"), {
      action: "BUY",
      referencePrice: 100,
      qty: 50,
      asset: "equity",
    });
    // 50 shares × $0.0035 = $0.175 → bumped to $0.35 minimum
    expect(out.commission).toBe(0.35);
    // 3 bps + 2 bps = 5 bps = 0.05%
    expect(out.fillPrice).toBeCloseTo(100.05, 2);
  });

  it("ibkr-paper: commission scales linearly past the minimum", () => {
    const out = applyFillFriction(getBrokerProfile("ibkr-paper"), {
      action: "BUY",
      referencePrice: 100,
      qty: 1000,
      asset: "equity",
    });
    // 1000 × $0.0035 = $3.50, well above the $0.35 min
    expect(out.commission).toBe(3.5);
  });

  it("pepperstone-cfd-dow: half-spread + slippage = 9 bps on the index", () => {
    const out = applyFillFriction(getBrokerProfile("pepperstone-cfd-dow"), {
      action: "BUY",
      referencePrice: 40_000,
      qty: 1,
      asset: "cfd",
    });
    // 4 bps spread + 5 bps slippage = 9 bps on $40k = $36
    expect(out.fillPrice).toBeCloseTo(40_036, 0);
  });
});
