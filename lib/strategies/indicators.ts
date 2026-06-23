/**
 * Streaming indicator library — Sprint 053a.
 *
 * Each indicator returns a parallel array (one value per input bar, with
 * leading nulls during the warmup period). The evaluator scans the array
 * to find bars where entry conditions hold.
 *
 * Parity invariant: at the LAST index, these match the single-value outputs
 * of computeIndicators() and computeKeltnerChannel() in lib/indicators/index.ts.
 * Internal smoothing is unrounded; existing callers round at output.
 */

import type { IndicatorSpec } from "./types";

export interface Bar {
  high: number;
  low: number;
  close: number;
  open?: number;
  timestamp?: string;
  /** Sprint 080C: required by vwap and volume_sma indicators. */
  volume?: number;
}

export type IndicatorArrays = Record<string, (number | null)[]>;

/**
 * Sprint 080E: keyed by Timeframe string. Callers (run.ts, ab-harness.ts)
 * fetch and supply these when the strategy declares secondary-timeframe
 * indicators; the engine aligns them to the primary timeline automatically.
 */
export type SecondaryBarsMap = Record<string, Bar[]>;

/**
 * Compute all indicators declared in the strategy. Returns a map of indicator
 * id → parallel array of values (null during warmup).
 *
 * Sprint 080E: when `secondaryBarsMap` is provided and an indicator declares
 * a `timeframe` override, that indicator is computed on the matching secondary
 * bar series and re-indexed onto the primary timeline via last-known-value
 * semantics (see `alignToTimeline`).
 */
export function computeAllIndicators(
  specs: IndicatorSpec[],
  primaryBars: Bar[],
  secondaryBarsMap?: SecondaryBarsMap,
): IndicatorArrays {
  const out: IndicatorArrays = {};
  for (const spec of specs) {
    const secondary = spec.timeframe ? secondaryBarsMap?.[spec.timeframe] : undefined;
    if (secondary && secondary.length > 0) {
      const rawValues = computeOne(spec, secondary);
      out[spec.id] = alignToTimeline(primaryBars, secondary, rawValues);
    } else {
      out[spec.id] = computeOne(spec, primaryBars);
    }
  }
  return out;
}

/**
 * Sprint 080E: re-index secondary indicator values onto the primary bar
 * timeline using last-known-value semantics. For each primary bar at
 * timestamp T, the output value is the most recent secondary bar's value
 * where secondaryBar.timestamp ≤ T. Returns null before any secondary bar.
 */
function alignToTimeline(
  primaryBars: Bar[],
  secondaryBars: Bar[],
  secondaryValues: (number | null)[],
): (number | null)[] {
  const out: (number | null)[] = new Array(primaryBars.length).fill(null);
  let si = 0;
  let lastValue: number | null = null;
  for (let pi = 0; pi < primaryBars.length; pi++) {
    const pTs = primaryBars[pi].timestamp ?? "";
    while (si < secondaryBars.length && (secondaryBars[si].timestamp ?? "") <= pTs) {
      lastValue = secondaryValues[si];
      si++;
    }
    out[pi] = lastValue;
  }
  return out;
}

function computeOne(spec: IndicatorSpec, bars: Bar[]): (number | null)[] {
  switch (spec.type) {
    case "rsi":
      return rsi(bars.map((b) => b.close), reqPeriod(spec.params.period, spec.id));
    case "ema":
      return ema(bars.map((b) => b.close), reqPeriod(spec.params.period, spec.id));
    case "sma":
      return sma(bars.map((b) => b.close), reqPeriod(spec.params.period, spec.id));
    case "atr":
      return atr(bars, reqPeriod(spec.params.period, spec.id));
    case "kc_upper":
      return kcBand(
        bars,
        reqPeriod(spec.params.ema_period, spec.id),
        reqPeriod(spec.params.atr_period, spec.id),
        reqMultiplier(spec.params.multiplier, spec.id),
        "upper",
      );
    case "kc_lower":
      return kcBand(
        bars,
        reqPeriod(spec.params.ema_period, spec.id),
        reqPeriod(spec.params.atr_period, spec.id),
        reqMultiplier(spec.params.multiplier, spec.id),
        "lower",
      );
    // Sprint 080C ─────────────────────────────────────────────────────────────
    case "macd":
      return macdLine(
        bars.map((b) => b.close),
        reqPeriod(spec.params.fast_period, spec.id),
        reqPeriod(spec.params.slow_period, spec.id),
      );
    case "macd_signal":
      return macdSignalLine(
        bars.map((b) => b.close),
        reqPeriod(spec.params.fast_period, spec.id),
        reqPeriod(spec.params.slow_period, spec.id),
        reqPeriod(spec.params.signal_period, spec.id),
      );
    case "macd_histogram":
      return macdHist(
        bars.map((b) => b.close),
        reqPeriod(spec.params.fast_period, spec.id),
        reqPeriod(spec.params.slow_period, spec.id),
        reqPeriod(spec.params.signal_period, spec.id),
      );
    case "bb_upper":
      return bbBand(bars.map((b) => b.close), reqPeriod(spec.params.period, spec.id), reqMultiplier(spec.params.std_dev, spec.id), "upper");
    case "bb_lower":
      return bbBand(bars.map((b) => b.close), reqPeriod(spec.params.period, spec.id), reqMultiplier(spec.params.std_dev, spec.id), "lower");
    case "bb_middle":
      return sma(bars.map((b) => b.close), reqPeriod(spec.params.period, spec.id));
    case "stoch_k":
      return stochK(bars, reqPeriod(spec.params.period, spec.id));
    case "stoch_d":
      return stochD(bars, reqPeriod(spec.params.k_period, spec.id), reqPeriod(spec.params.d_period, spec.id));
    case "vwap":
      return vwap(bars);
    case "volume_sma":
      return sma(bars.map((b) => b.volume ?? NaN), reqPeriod(spec.params.period, spec.id));
  }
}

function reqPeriod(p: number | undefined, id: string): number {
  if (p === undefined || !Number.isInteger(p) || p < 1) {
    throw new Error(`indicator '${id}': invalid or missing period`);
  }
  return p;
}

function reqMultiplier(m: number | undefined, id: string): number {
  if (m === undefined || !Number.isFinite(m) || m <= 0) {
    throw new Error(`indicator '${id}': invalid or missing multiplier`);
  }
  return m;
}

// ── RSI (Wilder) ─────────────────────────────────────────────────────────────

export function rsi(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss += -d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// ── EMA ──────────────────────────────────────────────────────────────────────

export function ema(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return out;

  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += closes[i];
  e /= period;
  out[period - 1] = e;

  for (let i = period; i < closes.length; i++) {
    e = closes[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

// ── SMA ──────────────────────────────────────────────────────────────────────

export function sma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  out[period - 1] = sum / period;

  for (let i = period; i < closes.length; i++) {
    sum += closes[i] - closes[i - period];
    out[i] = sum / period;
  }
  return out;
}

// ── ATR (Wilder) ─────────────────────────────────────────────────────────────

export function atr(bars: Bar[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return out;

  // trs[k] = True Range between bars[k] and bars[k+1], aligned with bars[k+1].
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

  let a = 0;
  for (let i = 0; i < period; i++) a += trs[i];
  a /= period;
  out[period] = a; // seed aligned with bars[period] (after period TRs)

  for (let i = period; i < trs.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
    out[i + 1] = a;
  }
  return out;
}

// ── Keltner Channel band ─────────────────────────────────────────────────────

function kcBand(
  bars: Bar[],
  emaPeriod: number,
  atrPeriod: number,
  multiplier: number,
  side: "upper" | "lower",
): (number | null)[] {
  const emaArr = ema(bars.map((b) => b.close), emaPeriod);
  const atrArr = atr(bars, atrPeriod);
  const sign = side === "upper" ? 1 : -1;
  const out: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    const e = emaArr[i];
    const a = atrArr[i];
    if (e === null || a === null) continue;
    out[i] = e + sign * multiplier * a;
  }
  return out;
}

// ── Sprint 080C: MACD ────────────────────────────────────────────────────────

function macdLine(closes: number[], fast: number, slow: number): (number | null)[] {
  const fastArr = ema(closes, fast);
  const slowArr = ema(closes, slow);
  return closes.map((_, i) => {
    const f = fastArr[i];
    const s = slowArr[i];
    return f !== null && s !== null ? f - s : null;
  });
}

function macdSignalLine(closes: number[], fast: number, slow: number, signal: number): (number | null)[] {
  const line = macdLine(closes, fast, slow);
  // EMA of the MACD line; treat nulls as gaps and seed once we have `signal` consecutive values.
  const out: (number | null)[] = new Array(closes.length).fill(null);
  const k = 2 / (signal + 1);
  let seeded = false;
  let e = 0;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const v = line[i];
    if (v === null) { count = 0; e = 0; seeded = false; continue; }
    if (!seeded) {
      e += v;
      count++;
      if (count === signal) { e /= signal; out[i] = e; seeded = true; }
    } else {
      e = v * k + e * (1 - k);
      out[i] = e;
    }
  }
  return out;
}

function macdHist(closes: number[], fast: number, slow: number, signal: number): (number | null)[] {
  const line = macdLine(closes, fast, slow);
  const sig = macdSignalLine(closes, fast, slow, signal);
  return closes.map((_, i) => {
    const l = line[i];
    const s = sig[i];
    return l !== null && s !== null ? l - s : null;
  });
}

// ── Sprint 080C: Bollinger Bands ─────────────────────────────────────────────

function bbBand(closes: number[], period: number, stdDevMult: number, side: "upper" | "lower"): (number | null)[] {
  const middle = sma(closes, period);
  const sign = side === "upper" ? 1 : -1;
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = middle[i];
    if (m === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - m) ** 2;
    out[i] = m + sign * stdDevMult * Math.sqrt(variance / period);
  }
  return out;
}

// ── Sprint 080C: Stochastic ──────────────────────────────────────────────────

function stochK(bars: Bar[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      highest = Math.max(highest, bars[j].high);
      lowest = Math.min(lowest, bars[j].low);
    }
    const range = highest - lowest;
    out[i] = range === 0 ? 50 : ((bars[i].close - lowest) / range) * 100;
  }
  return out;
}

function stochD(bars: Bar[], kPeriod: number, dPeriod: number): (number | null)[] {
  const kArr = stochK(bars, kPeriod);
  const out: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    if (kArr[i] === null) continue;
    // Require dPeriod consecutive non-null %K values; break on any gap.
    let sum = 0;
    let count = 0;
    for (let j = i; j >= 0 && count < dPeriod; j--) {
      if (kArr[j] === null) break;
      sum += kArr[j]!;
      count++;
    }
    if (count === dPeriod) out[i] = sum / dPeriod;
  }
  return out;
}

// ── Sprint 080C: VWAP (session, resets each calendar day) ───────────────────

function vwap(bars: Bar[]): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let cumPV = 0;
  let cumVol = 0;
  let currentDay = "";
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const day = bar.timestamp?.slice(0, 10) ?? "";
    if (day !== currentDay) {
      cumPV = 0;
      cumVol = 0;
      currentDay = day;
    }
    const vol = bar.volume;
    if (vol === undefined || isNaN(vol) || vol <= 0) continue;
    const typical = (bar.high + bar.low + bar.close) / 3;
    cumPV += typical * vol;
    cumVol += vol;
    out[i] = cumPV / cumVol;
  }
  return out;
}
