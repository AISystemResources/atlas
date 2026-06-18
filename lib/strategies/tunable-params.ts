/**
 * Tunable parameter registry — Sprint 053e.
 *
 * Maps a strategy name to the list of parameters the aggregate reviewer
 * may propose changes to, along with their JSON paths into the
 * TicketLogicBody. The path is an array of keys; numeric indices for
 * arrays would be represented as strings (e.g. ["indicators", "0", "params"]).
 *
 * Why a per-strategy registry rather than schema-embedded metadata?
 * Embedding would expand the migration scope across all seed bodies. Keeping
 * the registry here lets 053e land as a closed-loop demo for Sandy S1
 * without touching the existing schema. Future sprints can move this into
 * the TicketLogicBody as a `tunable_parameters` field.
 */

export interface TunableParameter {
  /** Human-readable name shown to the LLM and rendered in the UI */
  name: string;
  /** Dot-path into TicketLogicBody, as an array of keys */
  path: string[];
  /** What this parameter controls — sent to the LLM */
  description: string;
  /** Optional soft bounds. The reviewer should respect these, but we don't enforce. */
  min?: number;
  max?: number;
}

export const STRATEGY_TUNABLES: Record<string, TunableParameter[]> = {
  "sandy-s1-long": [
    {
      name: "rsi_regime_threshold",
      path: ["regime_filter", "right", "value"],
      description:
        "RSI(21) threshold for bullish regime. Longs only fire above this. Default 50.",
      min: 30,
      max: 70,
    },
    {
      name: "entry_buffer_multiplier",
      path: ["computed", "entry_price", "right", "value"],
      description:
        "Multiplier on signal-bar high for entry price. Default 1.0005 (+0.05% buffer above SB high).",
      min: 1.0001,
      max: 1.005,
    },
    {
      name: "stop_loss_multiplier",
      path: ["exit", "stop_loss", "right", "value"],
      description:
        "Multiplier on signal-bar low for stop loss. Default 0.995 (-0.5% buffer below SB low).",
      min: 0.985,
      max: 0.999,
    },
    {
      name: "target_atr_multiple",
      path: ["exit", "take_profit", "right", "left", "value"],
      description:
        "Number of ATR(14) added to entry price for take profit. Default 0.5.",
      min: 0.2,
      max: 2.0,
    },
    {
      name: "notional_per_trade",
      path: ["entry", "sizing", "value"],
      description: "Position size in dollars per trade. Default 200.",
      min: 50,
      max: 10_000,
    },
  ],
};

export function getTunablesForStrategy(name: string): TunableParameter[] {
  return STRATEGY_TUNABLES[name] ?? [];
}

/**
 * Read the current value of a tunable from a TicketLogicBody.
 * Returns undefined if any segment of the path is missing.
 */
export function readByPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Mutates `obj` in place: walks the path and sets the leaf to `value`.
 * Throws if any segment of the path is missing.
 */
export function setByPath(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  if (path.length === 0) throw new Error("setByPath: empty path");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]];
    if (next === null || next === undefined || typeof next !== "object") {
      throw new Error(
        `setByPath: path ${path.join(".")} not navigable at segment '${path[i]}'`,
      );
    }
    cur = next as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

/**
 * Deep-clones `body` and applies the proposed parameter changes. Returns the
 * new body. Throws if any change references an unknown tunable name OR if the
 * path can't be navigated in the current body.
 */
export function applyParameterChanges<T extends Record<string, unknown>>(
  body: T,
  changes: Array<{ name: string; proposed_value: number }>,
  strategyName: string,
): T {
  const tunables = getTunablesForStrategy(strategyName);
  const cloned = JSON.parse(JSON.stringify(body)) as T;
  for (const change of changes) {
    const tunable = tunables.find((t) => t.name === change.name);
    if (!tunable) {
      throw new Error(
        `applyParameterChanges: unknown tunable '${change.name}' for strategy '${strategyName}'`,
      );
    }
    setByPath(cloned, tunable.path, change.proposed_value);
  }
  return cloned;
}
