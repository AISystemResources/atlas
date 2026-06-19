/**
 * Zod runtime validator for TicketLogicBody — Sprint 053a.
 *
 * Used at write time (when Claude Chat or Distillation v3 inserts a new
 * ticket_logics row) to reject malformed JSON before it lands in the DB.
 * The evaluator trusts that anything loaded from the DB has already passed
 * this schema.
 */

import { z } from "zod";
import type { Expression, TicketLogicBody } from "./types";

const ohlcField = z.enum(["open", "high", "low", "close"]);
const binaryOp = z.enum(["+", "-", "*", "/"]);
const comparisonOp = z.enum(["gt", "lt", "gte", "lte", "eq", "neq"]);

// Recursive Expression schema.
// Bar offsets are non-positive integers: 0 = signal bar, -1 = previous bar.
const expressionSchema: z.ZodType<Expression> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("constant"), value: z.number() }),
    z.object({
      type: z.literal("ohlc"),
      field: ohlcField,
      bar_offset: z.number().int().nonpositive(),
    }),
    z.object({
      type: z.literal("indicator"),
      id: z.string().min(1),
      bar_offset: z.number().int().nonpositive(),
    }),
    z.object({ type: z.literal("computed"), id: z.string().min(1) }),
    z.object({
      type: z.literal("binary"),
      op: binaryOp,
      left: expressionSchema,
      right: expressionSchema,
    }),
  ]),
);

const conditionSchema = z.object({
  op: comparisonOp,
  left: expressionSchema,
  right: expressionSchema,
});

const indicatorSpecSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["rsi", "ema", "sma", "atr", "kc_upper", "kc_lower"]),
  params: z.record(z.string(), z.number()),
});

const sizingSchema = z.object({
  method: z.enum(["fixed_notional", "fixed_shares", "atr_risk"]),
  value: z.number().positive(),
});

const timeStopSchema = z.union([
  z.literal("eod"),
  z.object({ bars: z.number().int().positive() }),
]);

const tunableParameterSchema = z.object({
  name: z.string().min(1),
  path: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const ticketLogicBodySchema: z.ZodType<TicketLogicBody> = z.object({
  universe: z.object({
    asset_class: z.enum(["equity", "crypto", "any"]),
    tickers: z.array(z.string().min(1)).optional(),
  }),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "1d"]),
  direction: z.enum(["long", "short"]),
  indicators: z.array(indicatorSpecSchema).min(1),
  regime_filter: conditionSchema.optional(),
  entry: z.object({
    conditions: z.array(conditionSchema).min(1),
    sizing: sizingSchema,
  }),
  computed: z.record(z.string(), expressionSchema).optional(),
  exit: z.object({
    take_profit: expressionSchema,
    stop_loss: expressionSchema,
    time_stop: timeStopSchema.optional(),
  }),
  tunable_parameters: z.array(tunableParameterSchema).optional(),
});

/** Throws ZodError if body is malformed; returns the parsed body otherwise. */
export function parseTicketLogicBody(input: unknown): TicketLogicBody {
  return ticketLogicBodySchema.parse(input);
}
