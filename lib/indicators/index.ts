/**
 * Technical indicators for the intraday scalper.
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

// ── Keltner Channel ───────────────────────────────────────────────────────────

export interface KCResult {
  ema: number;
  upperInner: number;
  lowerInner: number;
  upperOuter: number;
  lowerOuter: number;
  atr: number;
}

/**
 * Keltner Channel with EMA(period) ± innerMult×ATR (inner) and ± outerMult×ATR (outer).
 * Edmund Jadeja S1 uses period=13, innerMult=1.3, outerMult=2.0.
 * Returns null when bars.length < period + 2 (insufficient history).
 */
export function computeKeltnerChannel(
  bars: { high: number; low: number; close: number }[],
  period = 13,
  innerMult = 1.3,
  outerMult = 2.0,
): KCResult | null {
  if (bars.length < period + 2) return null;

  // ── EMA of close ─────────────────────────────────────────────────────
  const k = 2 / (period + 1);
  // Seed: SMA of first `period` closes
  let ema = 0;
  for (let i = 0; i < period; i++) ema += bars[i].close;
  ema /= period;
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
  }

  // ── ATR (Wilder) ─────────────────────────────────────────────────────
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

  return {
    ema: Math.round(ema * 10000) / 10000,
    upperInner: Math.round((ema + innerMult * atr) * 10000) / 10000,
    lowerInner: Math.round((ema - innerMult * atr) * 10000) / 10000,
    upperOuter: Math.round((ema + outerMult * atr) * 10000) / 10000,
    lowerOuter: Math.round((ema - outerMult * atr) * 10000) / 10000,
    atr: Math.round(atr * 10000) / 10000,
  };
}

// ── S1 Signal Detection ───────────────────────────────────────────────────────

export interface S1Signal {
  action: "BUY";
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  atr: number;
  rsi21: number;
  kcEma: number;
}

const S1_BUFFER = 0.0005;     // 0.05% entry/stop buffer
const RSI_REGIME_MIN = 50;    // RSI(21) must be above 50 for long signals
const REGIME_RSI_PERIOD = 21;

/**
 * Edmund Jadeja S1 signal detection on a bar series.
 *
 * Long signal conditions (all must hold):
 *   1. RSI(21) > 50 — bullish regime (long-only; short selling deferred per supervisor)
 *   2. Penultimate bar low ≤ outer lower KC band (price touched outer band)
 *   3. Final bar is bullish: close > open
 *   4. Final bar close > inner lower KC band (bounced back above inner band)
 *
 * Returns null when conditions are not met or bars are insufficient.
 * Entry, stop, and target follow Edmund's mechanics: SB high/low ± 0.05% buffer, target = ATR(14)/2.
 */
export function detectS1Signal(
  bars: { high: number; low: number; close: number; open?: number }[],
  kcPeriod = 13,
  innerMult = 1.3,
  outerMult = 2.0,
): S1Signal | null {
  // Need at least RSI(21) minimum bars + 2 (REGIME_RSI_PERIOD + 2 = 23) and KC minimum
  const minBars = Math.max(REGIME_RSI_PERIOD + 2, kcPeriod + 2);
  if (bars.length < minBars) return null;

  // ── Regime filter: RSI(21) > 50 ──────────────────────────────────────
  const regimeInd = computeIndicators(bars, REGIME_RSI_PERIOD);
  if (!regimeInd || regimeInd.rsi <= RSI_REGIME_MIN) return null;

  // ── Keltner Channel ───────────────────────────────────────────────────
  const kc = computeKeltnerChannel(bars, kcPeriod, innerMult, outerMult);
  if (!kc) return null;

  const prevBar = bars[bars.length - 2];
  const signalBar = bars[bars.length - 1];

  // ── S1 Long conditions ────────────────────────────────────────────────
  const prevTouchedOuter = prevBar.low <= kc.lowerOuter;
  const isBullishCandle = (signalBar.open !== undefined)
    ? signalBar.close > signalBar.open
    : true; // if open not provided, skip this check
  const closeAboveInner = signalBar.close > kc.lowerInner;

  if (!prevTouchedOuter || !isBullishCandle || !closeAboveInner) return null;

  // ── ATR(14) for profit target ─────────────────────────────────────────
  const atrInd = computeIndicators(bars, 14);
  if (!atrInd) return null;

  const entryPrice = Math.round(signalBar.high * (1 + S1_BUFFER) * 10000) / 10000;
  const stopPrice = Math.round(signalBar.low * (1 - S1_BUFFER) * 10000) / 10000;
  const targetPrice = Math.round((entryPrice + atrInd.atr / 2) * 10000) / 10000;

  return {
    action: "BUY",
    entryPrice,
    stopPrice,
    targetPrice,
    atr: atrInd.atr,
    rsi21: regimeInd.rsi,
    kcEma: kc.ema,
  };
}
