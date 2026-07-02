/**
 * Sprint 124: points-first PnL formatter guards.
 */

import {
  formatPnl,
  clampPointValue,
  POINT_VALUE_MIN,
  POINT_VALUE_MAX,
  POINT_VALUE_DEFAULT,
} from "@/lib/format/pnl";

describe("formatPnl", () => {
  it("formats a positive points figure with default 1-dp", () => {
    const r = formatPnl(9.42, 1);
    expect(r.pointsText).toBe("+9.4");
    expect(r.dollarsText).toBe("+$9.42");
    expect(r.sign).toBe(1);
    expect(r.full).toBe("+9.4 pts (≈ +$9.42)");
  });

  it("formats a negative points figure with a minus sign glyph", () => {
    const r = formatPnl(-12.5, 1);
    expect(r.pointsText).toBe("−12.5");
    expect(r.dollarsText).toBe("−$12.50");
    expect(r.sign).toBe(-1);
  });

  it("handles zero without a sign", () => {
    const r = formatPnl(0, 1);
    expect(r.pointsText).toBe("0.0");
    expect(r.sign).toBe(0);
  });

  it("scales the dollar echo by point value", () => {
    expect(formatPnl(10, 0.5).dollarsText).toBe("+$5.00");
    expect(formatPnl(10, 5).dollarsText).toBe("+$50.00");
  });

  it("omits the dollar echo when point value is null / 0 / non-finite", () => {
    expect(formatPnl(9.4, null).dollarsText).toBe("");
    expect(formatPnl(9.4, null).full).toBe("+9.4 pts");
    expect(formatPnl(9.4, 0).dollarsText).toBe("");
    expect(formatPnl(9.4, NaN).dollarsText).toBe("");
  });

  it("returns em-dashes when points is null / undefined / NaN", () => {
    expect(formatPnl(null, 1).pointsText).toBe("—");
    expect(formatPnl(undefined, 1).pointsText).toBe("—");
    expect(formatPnl(NaN, 1).pointsText).toBe("—");
  });

  it("honors a custom decimals option", () => {
    expect(formatPnl(9.42, 1, { decimals: 2 }).pointsText).toBe("+9.42");
    expect(formatPnl(9.42, 1, { decimals: 0 }).pointsText).toBe("+9");
  });
});

describe("clampPointValue", () => {
  it("returns default for non-numeric / non-finite input", () => {
    expect(clampPointValue("abc")).toBe(POINT_VALUE_DEFAULT);
    expect(clampPointValue(null)).toBe(POINT_VALUE_DEFAULT);
    expect(clampPointValue(undefined)).toBe(POINT_VALUE_DEFAULT);
    expect(clampPointValue(NaN)).toBe(POINT_VALUE_DEFAULT);
    expect(clampPointValue(Infinity)).toBe(POINT_VALUE_MAX);
  });

  it("clamps below min", () => {
    expect(clampPointValue(0)).toBe(POINT_VALUE_MIN);
    expect(clampPointValue(-5)).toBe(POINT_VALUE_MIN);
  });

  it("clamps above max", () => {
    expect(clampPointValue(1000)).toBe(POINT_VALUE_MAX);
    expect(clampPointValue(100.5)).toBe(POINT_VALUE_MAX);
  });

  it("passes through in-range values", () => {
    expect(clampPointValue(0.1)).toBe(0.1);
    expect(clampPointValue(5)).toBe(5);
    expect(clampPointValue(99.99)).toBe(99.99);
  });

  it("coerces numeric strings", () => {
    expect(clampPointValue("2.5")).toBe(2.5);
  });
});
