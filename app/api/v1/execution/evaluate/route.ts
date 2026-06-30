/**
 * POST /api/v1/execution/evaluate
 *
 * Evaluates a strategy's entry conditions against the most recent market bars
 * and returns the current signal (BUY / SELL / HOLD).
 *
 * This is the bridge between the strategy DSL and live execution:
 * paper → extracted strategy → backtested → live signal here.
 *
 * Body: { strategy_id: string }
 *
 * Response:
 *   signal:         "BUY" | "SELL" | "HOLD"
 *   direction:      "long" | "short" | null
 *   entry_price:    number | null   (strategy's computed entry level)
 *   take_profit:    number | null
 *   stop_loss:      number | null
 *   current_price:  number | null   (latest bar close)
 *   last_bar_ts:    string | null
 *   bars_evaluated: number
 *   strategy:       { id, name, version, ticker, timeframe }
 */

import { getUserFromRequest } from "@/lib/auth/context";
import { loadTicketLogicById } from "@/lib/strategies/loader";
import { fetchHistoricalBarsCached } from "@/lib/backtest-ticket/fetch-bars-cached";
import { evaluate } from "@/lib/strategies/evaluate";
import { getServiceClient } from "@/lib/supabase-server";

const DAYS_BACK: Record<string, number> = {
  "1m": 7,
  "2m": 30,
  "5m": 60,
  "15m": 60,
  "1h": 60,
  "1d": 365,
};

// A signal is "current" if it fired within this many bars of the latest bar.
const RECENCY_WINDOW: Record<string, number> = {
  "1m": 10,
  "2m": 5,
  "5m": 3,
  "15m": 2,
  "1h": 1,
  "1d": 1,
};

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { strategy_id } = body as { strategy_id?: string };
  if (!strategy_id) return Response.json({ error: "strategy_id required" }, { status: 400 });

  // Load the strategy including the ticker column (Sprint 068, stored separately from body)
  const sb = getServiceClient();
  const { data: row, error: rowErr } = await sb
    .from("ticket_logics")
    .select("id, name, version, ticker, body, status")
    .eq("id", strategy_id)
    .maybeSingle();

  if (rowErr) return Response.json({ error: rowErr.message }, { status: 500 });
  if (!row) return Response.json({ error: "strategy not found" }, { status: 404 });

  // Load and validate the body via the typed loader
  const logic = await loadTicketLogicById(strategy_id);
  if (!logic) return Response.json({ error: "strategy not found" }, { status: 404 });

  const ticker = (row.ticker as string | null) ?? logic.body.universe.tickers?.[0];
  if (!ticker) return Response.json({ error: "strategy has no ticker" }, { status: 400 });

  const timeframe = logic.body.timeframe;
  const daysBack = DAYS_BACK[timeframe] ?? 60;
  const recencyWindow = RECENCY_WINDOW[timeframe] ?? 3;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  let bars;
  try {
    bars = await fetchHistoricalBarsCached(ticker, startDate, endDate, timeframe);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "bar fetch failed" },
      { status: 500 },
    );
  }

  if (bars.length === 0) {
    return Response.json({ error: `No bars available for ${ticker} ${timeframe}` }, { status: 422 });
  }

  const signals = evaluate(logic.body, bars);
  const lastBar = bars[bars.length - 1];
  const lastSignal = signals.length > 0 ? signals[signals.length - 1] : null;

  const isRecent =
    lastSignal !== null && lastSignal.bar_index >= bars.length - recencyWindow;
  const currentSignal = isRecent ? lastSignal : null;

  return Response.json({
    signal: currentSignal
      ? currentSignal.direction === "long"
        ? "BUY"
        : "SELL"
      : "HOLD",
    direction: currentSignal?.direction ?? null,
    entry_price: currentSignal?.entry_price ?? null,
    take_profit: currentSignal?.take_profit ?? null,
    stop_loss: currentSignal?.stop_loss ?? null,
    current_price: lastBar.close,
    last_bar_ts: lastBar.timestamp ?? null,
    bars_evaluated: bars.length,
    last_signal_bar_index: lastSignal?.bar_index ?? null,
    strategy: {
      id: logic.id,
      name: logic.name,
      version: logic.version,
      ticker,
      timeframe,
    },
  });
}
