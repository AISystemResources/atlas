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
  // Sandy S1 long — v2 schema (Sprint 059). v1 was archived; the AI reviewer
  // and promote endpoint only operate on the active version, so this registry
  // tracks the latest schema only.
  "sandy-s1-long": [
    {
      name: "entry_buffer_points",
      path: ["computed", "entry_price", "right", "value"],
      description:
        "Absolute points added to signal_bar.high for the entry trigger. Sandy's Dow convention is 3. Tune up for higher-priced tickers, down for crypto.",
      min: 1,
      max: 100,
    },
    {
      name: "stop_buffer_points",
      path: ["exit", "stop_loss", "right", "value"],
      description:
        "Absolute points subtracted from signal_bar.low for the stop loss. Default 3 (Dow convention).",
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
