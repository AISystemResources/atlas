/**
 * Zod runtime validator for TicketLogicBody — Sprint 053a.
 *
 * Used at write time (when Claude Chat or Distillation v3 inserts a new
 * ticket_logics row) to reject malformed JSON before it lands in the DB.
 * The evaluator trusts that anything loaded from the DB has already passed
 * this schema.
 */

import { z } from "zod";
import type { ConditionNode, Expression, TicketLogicBody } from "./types";

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

// Sprint 152: optional display-only role on any ConditionNode. Missing = "signal".
// Zod rejects unknown values with a clear enum error.
const conditionRoleSchema = z.enum(["signal", "filter"]).optional();

const conditionSchema = z.object({
  op: comparisonOp,
  left: expressionSchema,
  right: expressionSchema,
  role: conditionRoleSchema,
});

// Sprint 080D: recursive compound condition tree.
// conditionNodeSchema accepts either a leaf Condition (has `op`) or a compound
// node (has `type`). z.lazy() is required because the tree is self-referential.
const conditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    // Leaf — backward compatible with all existing strategies.
    conditionSchema,
    // Compound AND: all children must hold.
    z.object({
      type: z.literal("and"),
      children: z.array(conditionNodeSchema).min(1),
      role: conditionRoleSchema,
    }),
    // Compound OR: any child must hold.
    z.object({
      type: z.literal("or"),
      children: z.array(conditionNodeSchema).min(1),
      role: conditionRoleSchema,
    }),
    // Compound NOT: child must not hold.
    z.object({
      type: z.literal("not"),
      child: conditionNodeSchema,
      role: conditionRoleSchema,
    }),
  ]),
);

const indicatorSpecSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "rsi", "ema", "sma", "atr", "kc_upper", "kc_lower",
    // Sprint 080C
    "macd", "macd_signal", "macd_histogram",
    "bb_upper", "bb_lower", "bb_middle",
    "stoch_k", "stoch_d",
    "vwap", "volume_sma",
  ]),
  params: z.record(z.string(), z.number()),
  // Sprint 080E: optional secondary timeframe for multi-timeframe indicators.
  timeframe: z.enum(["1m", "2m", "5m", "15m", "1h", "1d"]).optional(),
});

const sizingSchema = z.object({
  method: z.enum(["fixed_notional", "fixed_shares", "atr_risk"]),
  value: z.number().positive(),
});

const timeStopSchema = z.union([
  z.literal("eod"),
  z.object({ bars: z.number().int().positive() }),
]);

// Sprint 079G: discriminated union for the structured SL methodology.
// Sprint 080B: trailing_atr and trailing_pct added.
const slMethodSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("fixed_buffer"),
    value: z.number(),
  }),
  z.object({
    type: z.literal("atr_multiple"),
    value: z.number().positive(),
    atr_indicator_id: z.string().min(1),
  }),
  z.object({
    type: z.literal("pct_of_entry"),
    value: z.number().positive().max(1),
  }),
  z.object({
    type: z.literal("trailing_atr"),
    value: z.number().positive(),
    atr_indicator_id: z.string().min(1),
  }),
  z.object({
    type: z.literal("trailing_pct"),
    value: z.number().positive().max(1),
  }),
]);

// Sprint 080F: one tranche in a staged exit plan.
const exitStageSchema = z.object({
  fraction: z.number().positive().max(1),
  take_profit: expressionSchema,
});

// Array of stages: each fraction > 0, sum ≤ 1.
const stagesSchema = z
  .array(exitStageSchema)
  .min(1)
  .refine((stages) => stages.reduce((s, t) => s + t.fraction, 0) <= 1 + 1e-9, {
    message: "sum of stage fractions must not exceed 1",
  });

const tunableParameterSchema = z.object({
  name: z.string().min(1),
  path: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  min: z.number().optional(),
  max: z.number().optional(),
  // Sprint 053.1: per-promote ratchet. Fractional cap (0 < x ≤ 1).
  max_step_pct: z.number().positive().max(1).optional(),
});

// Sprint 069: session_window + valid_weekdays
const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const sessionWindowSchema = z.object({
  start: z.string().regex(hhmmRegex, "expected HH:MM 24-hour"),
  end: z.string().regex(hhmmRegex, "expected HH:MM 24-hour"),
  timezone: z.string().min(1, "IANA timezone required"),
});
const validWeekdaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7);

export const ticketLogicBodySchema: z.ZodType<TicketLogicBody> = z.object({
  universe: z.object({
    asset_class: z.enum(["equity", "crypto", "any"]),
    tickers: z.array(z.string().min(1)).optional(),
  }),
  timeframe: z.enum(["1m", "2m", "5m", "15m", "1h", "1d"]),
  direction: z.enum(["long", "short"]),
  indicators: z.array(indicatorSpecSchema).min(1),
  regime_filter: conditionNodeSchema.optional(),
  entry: z.object({
    conditions: z.array(conditionNodeSchema).min(1),
    sizing: sizingSchema,
  }),
  computed: z.record(z.string(), expressionSchema).optional(),
  exit: z
    .object({
      take_profit: expressionSchema,
      stop_loss: expressionSchema.optional(),
      sl_method: slMethodSchema.optional(),
      time_stop: timeStopSchema.optional(),
      // Sprint 080A/080D: indicator-based exit triggers (any fires → close position). Supports compound nodes.
      exit_conditions: z.array(conditionNodeSchema).min(1).optional(),
      // Sprint 080F: staged partial exits.
      stages: stagesSchema.optional(),
    })
    .refine((e) => !!e.stop_loss || !!e.sl_method || !!e.exit_conditions, {
      message:
        "exit must define either stop_loss expression, sl_method, or exit_conditions",
      path: ["sl_method"],
    }),
  tunable_parameters: z.array(tunableParameterSchema).optional(),
  session_window: sessionWindowSchema.optional(),
  valid_weekdays: validWeekdaysSchema.optional(),
});

/** Throws ZodError if body is malformed; returns the parsed body otherwise. */
export function parseTicketLogicBody(input: unknown): TicketLogicBody {
  return ticketLogicBodySchema.parse(input);
}
