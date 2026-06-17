/**
 * Technical indicators for the intraday scalper (sprint 040).
 * Pure functions — no I/O, no side effects.
 */

export interface IndicatorResult {
  rsi: number;    // 0–100
  atr: number;    // dollars per bar (Wilder smoothed)
  lastClose: number;
}

/**
 * Wilder's RSI(period) and ATR(period) on a bar series.
 * Returns null when bars.length < period + 2 (insufficient history).
 */
export function computeIndicators(
  bars: { high: number; low: number; close: number }[],
  period = 14,
): IndicatorResult | null {
  if (bars.length < period + 2) return null;

  // ── ATR ──────────────────────────────────────────────────────────────
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    trs.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close),
      ),
    );
  }
  let atr = 0;
  for (let i = 0; i < period; i++) atr += trs[i];
  atr /= period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  // ── RSI ──────────────────────────────────────────────────────────────
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].close - bars[i - 1].close;
    if (d > 0) avgGain += d;
    else avgLoss += -d;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }

  const rsi =
    avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  return {
    rsi: Math.round(rsi * 100) / 100,
    atr: Math.round(atr * 10000) / 10000,
    lastClose: bars[bars.length - 1].close,
  };
}
