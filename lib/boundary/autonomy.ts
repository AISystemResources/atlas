/**
 * Autonomy matrix — Sprint 070.
 *
 * The 4-cell autonomy matrix replaces the binary advisory/autonomous gate
 * for the live scalper:
 *
 *   ai_intervenes_open  ai_intervenes_close   Cell
 *   ──────────────────  ───────────────────   ──────────────────────
 *   true                true                  AI opens · AI closes  (autonomous)
 *   false               true                  Human opens · AI closes  (asymmetric, recommended)
 *   true                false                 AI opens · Human closes  (asymmetric, high-risk)
 *   false               false                 Human opens · Human closes  (manual)
 *
 * The scalper uses this in two places:
 *   1. Enrollment — the cron only runs the user if at least one cell is
 *      AI-owned (otherwise the scalper has nothing to do).
 *   2. Per-bar gates — entries fire only when ai_intervenes_open is true;
 *      exit logic (crypto polling sells + EOD safety net) fires only when
 *      ai_intervenes_close is true.
 *
 * Failure mode: read errors fall back to (false, false) — the conservative
 * default. This is intentional: silent autonomous trading on a DB blip
 * is the worst possible failure mode for a B2C product.
 */

import { getServiceClient } from "@/lib/supabase-server";

export interface AutonomyMatrix {
  ai_intervenes_open: boolean;
  ai_intervenes_close: boolean;
}

export type AutonomyCell =
  | "ai-opens-ai-closes"
  | "human-opens-ai-closes"
  | "ai-opens-human-closes"
  | "human-opens-human-closes";

export function deriveCell(m: AutonomyMatrix): AutonomyCell {
  if (m.ai_intervenes_open && m.ai_intervenes_close) return "ai-opens-ai-closes";
  if (!m.ai_intervenes_open && m.ai_intervenes_close) return "human-opens-ai-closes";
  if (m.ai_intervenes_open && !m.ai_intervenes_close) return "ai-opens-human-closes";
  return "human-opens-human-closes";
}

export async function getAutonomyMatrix(userId: string): Promise<AutonomyMatrix> {
  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from("profiles")
      .select("ai_intervenes_open, ai_intervenes_close")
      .eq("id", userId)
      .maybeSingle();
    const row = data as { ai_intervenes_open: boolean | null; ai_intervenes_close: boolean | null } | null;
    return {
      ai_intervenes_open: row?.ai_intervenes_open ?? false,
      ai_intervenes_close: row?.ai_intervenes_close ?? false,
    };
  } catch {
    return { ai_intervenes_open: false, ai_intervenes_close: false };
  }
}

/** Whether the scalper has any work for this user. */
export function scalperParticipates(m: AutonomyMatrix): boolean {
  return m.ai_intervenes_open || m.ai_intervenes_close;
}
