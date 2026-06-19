/**
 * Tunable parameter helpers — Sprint 060B.
 *
 * As of Sprint 060, tunables live inside `TicketLogicBody.tunable_parameters`
 * (each strategy declares its own). This file used to host a hardcoded
 * registry keyed by strategy name; that registry was the wrong shape for
 * multi-tenant infrastructure where any user can create any strategy.
 *
 * The path-traversal helpers (readByPath, setByPath, applyParameterChanges)
 * remain here because they're generic to the body shape.
 */

import type { TicketLogicBody, TunableParameter } from "./types";

export type { TunableParameter } from "./types";

/** Return the tunables declared by a body, or [] if the body has none. */
export function getTunables(body: TicketLogicBody): TunableParameter[] {
  return body.tunable_parameters ?? [];
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
 *
 * The tunable lookup is done against the body's own declared
 * `tunable_parameters`, NOT a global registry. This means each strategy is
 * self-describing — adding a new strategy never requires a code change here.
 */
export function applyParameterChanges<T extends TicketLogicBody>(
  body: T,
  changes: Array<{ name: string; proposed_value: number }>,
): T {
  const tunables = getTunables(body);
  const cloned = JSON.parse(JSON.stringify(body)) as T;
  for (const change of changes) {
    const tunable = tunables.find((t) => t.name === change.name);
    if (!tunable) {
      throw new Error(
        `applyParameterChanges: unknown tunable '${change.name}' (body declares: ${tunables.map((t) => t.name).join(", ") || "none"})`,
      );
    }
    setByPath(
      cloned as unknown as Record<string, unknown>,
      tunable.path,
      change.proposed_value,
    );
  }
  return cloned;
}
