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
}

export type IndicatorArrays = Record<string, (number | null)[]>;

/**
 * Compute all indicators declared in the strategy. Returns a map of indicator
 * id → parallel array of values (null during warmup).
 */
export function computeAllIndicators(
  specs: IndicatorSpec[],
  bars: Bar[],
): IndicatorArrays {
  const out: IndicatorArrays = {};
  for (const spec of specs) {
    out[spec.id] = computeOne(spec, bars);
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
