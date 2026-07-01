/**
 * POST/GET /api/cron/evaluate-signals
 *
 * Sprint 109 Phase 1: the scheduled evaluator. Vercel Cron pings this every
 * 5 minutes (see vercel.json). For each row in watched_strategies:
 *   1. Load the strategy body + ticker + timeframe
 *   2. Fetch the latest historical bars
 *   3. Run the deterministic evaluator
 *   4. If a signal fired on the *last* bar within the recency window, INSERT
 *      a signal_events row. The UNIQUE (user_id, strategy_id, bar_ts) index
 *      guarantees idempotency — cron re-runs on the same bar are safe.
 *
 * Auto-execution (Phase 3) will hang off this same loop, but for now we
 * just detect and record.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` where the
 * secret is the value of the CRON_SECRET env var. Local dev / manual pokes
 * without the header are rejected in production; allowed in dev for
 * debugging.
 */

import { getServiceClient } from "@/lib/supabase-server";
import { loadTicketLogicById } from "@/lib/strategies/loader";
import { fetchHistoricalBarsCached } from "@/lib/backtest-ticket/fetch-bars-cached";
import { evaluate } from "@/lib/strategies/evaluate";
import { autoExecuteSignal } from "@/lib/execution/auto-trade-dispatcher";

const DAYS_BACK: Record<string, number> = {
  "1m": 7,
  "2m": 30,
  "5m": 60,
  "15m": 60,
  "1h": 60,
  "1d": 365,
};

const RECENCY_WINDOW: Record<string, number> = {
  "1m": 10,
  "2m": 5,
  "5m": 3,
  "15m": 2,
  "1h": 1,
  "1d": 1,
};

interface WatchedRow {
  user_id: string;
  strategy_id: string;
}

interface EvalOutcome {
  user_id: string;
  strategy_id: string;
  status: "detected" | "flat" | "skipped" | "error";
  reason?: string;
  event_id?: string;
}

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — allow in dev (NODE_ENV=development) only.
    return process.env.NODE_ENV !== "production";
  }
  return authHeader === `Bearer ${secret}`;
}

async function handle(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();

  const { data: watchedRows, error: watchedErr } = await sb
    .from("watched_strategies")
    .select("user_id, strategy_id");

  if (watchedErr) {
    return Response.json({ error: watchedErr.message }, { status: 500 });
  }

  const watched = (watchedRows ?? []) as WatchedRow[];
  const outcomes: EvalOutcome[] = [];

  for (const w of watched) {
    try {
      const outcome = await evaluateOne(w);
      outcomes.push(outcome);
    } catch (err) {
      outcomes.push({
        user_id: w.user_id,
        strategy_id: w.strategy_id,
        status: "error",
        reason: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  const detected = outcomes.filter((o) => o.status === "detected").length;
  const flat = outcomes.filter((o) => o.status === "flat").length;
  const errors = outcomes.filter((o) => o.status === "error").length;

  // Sprint 109 Phase 3: after detection, try to auto-execute newly detected
  // signals for users with an active spend permission. The dispatcher is
  // idempotent (guards on signal_events.executed_at IS NULL) so redoing
  // this pass on a re-run is safe.
  let autoExecuted = 0;
  let autoErrored = 0;
  for (const o of outcomes) {
    if (o.status !== "detected" || !o.event_id) continue;
    const res = await autoExecuteSignal(o.event_id);
    if (res === "executed") autoExecuted += 1;
    else if (res === "errored") autoErrored += 1;
  }

  return Response.json({
    ok: true,
    watched: watched.length,
    detected,
    flat,
    errors,
    auto_executed: autoExecuted,
    auto_errored: autoErrored,
    outcomes,
  });
}

async function evaluateOne(w: WatchedRow): Promise<EvalOutcome> {
  const sb = getServiceClient();

  const { data: row } = await sb
    .from("ticket_logics")
    .select("id, name, ticker, status")
    .eq("id", w.strategy_id)
    .maybeSingle();

  if (!row || row.status === "archived") {
    return {
      user_id: w.user_id,
      strategy_id: w.strategy_id,
      status: "skipped",
      reason: "strategy missing or archived",
    };
  }

  const logic = await loadTicketLogicById(w.strategy_id);
  if (!logic) {
    return {
      user_id: w.user_id,
      strategy_id: w.strategy_id,
      status: "skipped",
      reason: "strategy body failed schema validation",
    };
  }

  const ticker = (row.ticker as string | null) ?? logic.body.universe.tickers?.[0];
  if (!ticker) {
    return {
      user_id: w.user_id,
      strategy_id: w.strategy_id,
      status: "skipped",
      reason: "strategy has no ticker",
    };
  }

  const timeframe = logic.body.timeframe;
  const daysBack = DAYS_BACK[timeframe] ?? 60;
  const recencyWindow = RECENCY_WINDOW[timeframe] ?? 3;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const bars = await fetchHistoricalBarsCached(ticker, startDate, endDate, timeframe);
  if (bars.length === 0) {
    return {
      user_id: w.user_id,
      strategy_id: w.strategy_id,
      status: "skipped",
      reason: `no bars available for ${ticker} ${timeframe}`,
    };
  }

  const signals = evaluate(logic.body, bars);
  const lastSignal = signals.length > 0 ? signals[signals.length - 1] : null;
  const isRecent =
    lastSignal !== null && lastSignal.bar_index >= bars.length - recencyWindow;

  if (!isRecent || !lastSignal) {
    return {
      user_id: w.user_id,
      strategy_id: w.strategy_id,
      status: "flat",
    };
  }

  const firedBar = bars[lastSignal.bar_index];
  const lastBar = bars[bars.length - 1];

  const { data: insertResult, error: insertErr } = await sb
    .from("signal_events")
    .insert({
      user_id: w.user_id,
      strategy_id: w.strategy_id,
      bar_ts: firedBar.timestamp,
      direction: lastSignal.direction,
      entry_price: lastSignal.entry_price,
      take_profit: lastSignal.take_profit,
      stop_loss: lastSignal.stop_loss,
      current_price: lastBar.close,
      ticker,
      timeframe,
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    // UNIQUE violation on (user_id, strategy_id, bar_ts) is fine — same
    // bar already recorded on a previous cron run. Anything else is real.
    if (insertErr.code === "23505") {
      return {
        user_id: w.user_id,
        strategy_id: w.strategy_id,
        status: "flat",
        reason: "signal already recorded for this bar",
      };
    }
    return {
      user_id: w.user_id,
      strategy_id: w.strategy_id,
      status: "error",
      reason: insertErr.message,
    };
  }

  return {
    user_id: w.user_id,
    strategy_id: w.strategy_id,
    status: "detected",
    event_id: insertResult?.id,
  };
}

// Vercel Cron sends GET by default; keep POST too for manual triggers.
export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
