/**
 * Canonical TicketLogicBody constants.
 *
 * V1 (Sprint 053a) was a naive first encoding that diverged from Sandy's
 * actual S1 mechanics — outer KC touch + RSI(21) regime + multiplicative
 * buffers + ATR-based TP. v1 backtested at -$2.58 on ^DJI 58 days and the
 * AI aggregate review recommended deprecation. Kept here for the parity
 * test (the evaluator still matches the legacy detectS1Signal on v1 bars).
 *
 * V2 (Sprint 059) is the corrected canonical S1 per the strategy author:
 *   - Signal bar: bullish + close > lower KC 1.3 + close < EMA(13) median
 *     (mean-reversion guard; TP at median requires entry below median)
 *   - Entry: signal_bar.high + 3 points
 *   - Stop:  signal_bar.low  - 3 points
 *   - TP:    EMA(13) (the KC median)
 *   - Time stop: EOD
 *
 * The 3-point buffer is a Dow / DJIA-scale convention. For tickers at
 * different price scales, the entry/stop_buffer_points tunables let the AI
 * (or human) adjust.
 *
 * Migration 20260618400000 inserted v1; migration 20260619000000 inserts
 * v2 and archives v1.
 */

import type { TicketLogicBody } from "./types";

export const SANDY_S1_LONG_V1: TicketLogicBody = {
  universe: { asset_class: "any" },
  timeframe: "5m",
  direction: "long",
  indicators: [
    { id: "rsi_21",         type: "rsi",      params: { period: 21 } },
    { id: "ema_13",         type: "ema",      params: { period: 13 } },
    { id: "atr_14",         type: "atr",      params: { period: 14 } },
    { id: "kc_lower_outer", type: "kc_lower", params: { ema_period: 13, atr_period: 13, multiplier: 2.0 } },
    { id: "kc_lower_inner", type: "kc_lower", params: { ema_period: 13, atr_period: 13, multiplier: 1.3 } },
  ],
  regime_filter: {
    op: "gt",
    left:  { type: "indicator", id: "rsi_21", bar_offset: 0 },
    right: { type: "constant",  value: 50 },
  },
  entry: {
    conditions: [
      { op: "lte",
        left:  { type: "ohlc", field: "low", bar_offset: -1 },
        right: { type: "indicator", id: "kc_lower_outer", bar_offset: -1 } },
      { op: "gt",
        left:  { type: "ohlc", field: "close", bar_offset: 0 },
        right: { type: "ohlc", field: "open",  bar_offset: 0 } },
      { op: "gt",
        left:  { type: "ohlc", field: "close", bar_offset: 0 },
        right: { type: "indicator", id: "kc_lower_inner", bar_offset: 0 } },
    ],
    sizing: { method: "fixed_notional", value: 200 },
  },
  computed: {
    entry_price: {
      type: "binary", op: "*",
      left:  { type: "ohlc", field: "high", bar_offset: 0 },
      right: { type: "constant", value: 1.0005 },
    },
  },
  exit: {
    take_profit: {
      type: "binary", op: "+",
      left:  { type: "computed", id: "entry_price" },
      right: {
        type: "binary", op: "*",
        left:  { type: "constant", value: 0.5 },
        right: { type: "indicator", id: "atr_14", bar_offset: 0 },
      },
    },
    stop_loss: {
      type: "binary", op: "*",
      left:  { type: "ohlc", field: "low", bar_offset: 0 },
      right: { type: "constant", value: 0.995 },
    },
    time_stop: "eod",
  },
};

export const SANDY_S1_LONG_V2: TicketLogicBody = {
  universe: { asset_class: "any" },
  timeframe: "5m",
  direction: "long",
  indicators: [
    { id: "ema_13",         type: "ema",      params: { period: 13 } },
    { id: "atr_5",          type: "atr",      params: { period: 5 } },
    { id: "kc_lower_inner", type: "kc_lower", params: { ema_period: 13, atr_period: 13, multiplier: 1.3 } },
  ],
  entry: {
    conditions: [
      // 1. Bullish signal bar (close > open)
      { op: "gt",
        left:  { type: "ohlc", field: "close", bar_offset: 0 },
        right: { type: "ohlc", field: "open",  bar_offset: 0 } },
      // 2. Close above lower KC 1.3 (entry/exit logic anchor)
      { op: "gt",
        left:  { type: "ohlc", field: "close", bar_offset: 0 },
        right: { type: "indicator", id: "kc_lower_inner", bar_offset: 0 } },
      // 3. Signal bar close BELOW KC median.
      { op: "lt",
        left:  { type: "ohlc", field: "close", bar_offset: 0 },
        right: { type: "indicator", id: "ema_13", bar_offset: 0 } },
      // 4. The ENTRY price (signal_bar.high + 3) must also be below the EMA(13)
      //    median. Without this, a long trade entered above the median with TP
      //    at the median would be an immediate guaranteed loss. This is
      //    Sandy's "signal bar's high is too high" quality filter, encoded as
      //    a strict rejection.
      { op: "lt",
        left:  { type: "computed", id: "entry_price" },
        right: { type: "indicator", id: "ema_13", bar_offset: 0 } },
    ],
    sizing: { method: "fixed_notional", value: 200 },
  },
  computed: {
    // Entry = signal_bar.high + entry_buffer_points
    entry_price: {
      type: "binary", op: "+",
      left:  { type: "ohlc", field: "high", bar_offset: 0 },
      right: { type: "constant", value: 3 },
    },
  },
  exit: {
    // TP = EMA(13) = KC median
    take_profit: { type: "indicator", id: "ema_13", bar_offset: 0 },
    // SL = signal_bar.low - stop_buffer_points
    stop_loss: {
      type: "binary", op: "-",
      left:  { type: "ohlc", field: "low", bar_offset: 0 },
      right: { type: "constant", value: 3 },
    },
    time_stop: "eod",
  },
  tunable_parameters: [
    {
      name: "entry_buffer_points",
      path: ["computed", "entry_price", "right", "value"],
      description:
        "Absolute points added to signal_bar.high for the entry trigger. Sandy's Dow convention is 3.",
      min: 1,
      max: 100,
    },
    {
      name: "stop_buffer_points",
      path: ["exit", "stop_loss", "right", "value"],
      description:
        "Absolute points subtracted from signal_bar.low for the stop loss. Default 3.",
      min: 1,
      max: 100,
    },
    {
      name: "notional_per_trade",
      path: ["entry", "sizing", "value"],
      description: "Position size in dollars per trade. Default 200.",
      min: 50,
      max: 10_000,
    },
  ],
  // Sprint 069: Sandy's S1 was authored as a US-equity-morning strategy.
  // Restrict firing to weekdays 09:31–11:00 ET, matching the window the
  // strategy was originally observed and calibrated on.
  session_window: {
    start: "09:31",
    end: "11:00",
    timezone: "America/New_York",
  },
  valid_weekdays: [1, 2, 3, 4, 5],
};
