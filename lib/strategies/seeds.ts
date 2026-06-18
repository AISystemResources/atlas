/**
 * Canonical TicketLogicBody constants — Sprint 053a.
 *
 * The migration file 20260618400000_ticket_logics.sql contains an inline
 * SQL copy of this body. Drift between this constant and the SQL is a known
 * risk; a follow-up sprint should add a drift-check test that hashes both.
 * For now, the schema-level Zod parse in evaluate.test.ts ensures the
 * constant remains a valid TicketLogicBody.
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
