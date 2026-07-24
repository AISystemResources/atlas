/**
 * Sprint 124: points-first PnL formatting.
 *
 * Traders think in points. Edmund Jadeja teaches "3 points above the high",
 * not "$0.006 above the high." Backtests already store total_pnl_points
 * alongside total_pnl_dollars — this helper renders the points as the
 * headline with the dollar-equivalent as secondary context.
 *
 * point_value_dollars is a per-user setting (profiles.point_value_dollars).
 * Range enforced at API + client: 0.01 to 100. Defaults to 1.0.
 */

export const POINT_VALUE_MIN = 0.01;
export const POINT_VALUE_MAX = 100;
export const POINT_VALUE_DEFAULT = 1.0;

/** Presets shown on the Settings picker. Custom = any value in-range. */
export const POINT_VALUE_PRESETS: readonly number[] = [0.1, 0.5, 1, 5, 10];

export interface FormattedPnl {
  /** Points figure with sign, e.g. "+9.4" or "−12.5". Empty when points is null. */
  pointsText: string;
  /** Dollar figure with sign, e.g. "+$9.40". Empty when points or ratio is null. */
  dollarsText: string;
  /** Signed sign for CSS coloring: +1, -1, or 0. */
  sign: 1 | -1 | 0;
  /** Full display string, e.g. "+9.4 pts (≈ +$9.40)". */
  full: string;
}

/**
 * Format a PnL figure primarily as points.
 *
 * @param points     Points PnL (positive = win). null returns em-dash placeholders.
 * @param pointValue User's point_value_dollars setting.
 * @param opts.decimals Points decimals (default 1). Dollars always uses 2.
 */
export function formatPnl(
  points: number | null | undefined,
  pointValue: number | null | undefined,
  opts: { decimals?: number } = {},
): FormattedPnl {
  const decimals = opts.decimals ?? 1;
  if (points == null || !Number.isFinite(points)) {
    return { pointsText: "—", dollarsText: "—", sign: 0, full: "—" };
  }
  const sign = points > 0 ? 1 : points < 0 ? -1 : 0;
  const signChar = sign > 0 ? "+" : sign < 0 ? "−" : "";
  const pointsAbs = Math.abs(points).toFixed(decimals);
  const pointsText = `${signChar}${pointsAbs}`;

  let dollarsText = "";
  let full = `${pointsText} pts`;
  if (pointValue != null && Number.isFinite(pointValue) && pointValue > 0) {
    const dollarsAbs = (Math.abs(points) * pointValue).toFixed(2);
    dollarsText = `${signChar}$${dollarsAbs}`;
    full = `${pointsText} pts (≈ ${dollarsText})`;
  }
  return { pointsText, dollarsText, sign, full };
}

/** Snap a raw value into the allowed point-value range. Non-numeric → default. */
export function clampPointValue(v: unknown): number {
  // Guard null/undefined/empty explicitly — Number(null) is 0 and would
  // otherwise clamp to MIN, which reads as a valid user choice.
  if (v == null || v === "") return POINT_VALUE_DEFAULT;
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return POINT_VALUE_DEFAULT;
  return Math.min(POINT_VALUE_MAX, Math.max(POINT_VALUE_MIN, n));
}
