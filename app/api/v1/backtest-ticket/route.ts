/**
 * POST /api/v1/backtest-ticket — run a Ticket Logic backtest synchronously.
 *
 * Sprint 053b. Replaces nothing — this is a new endpoint alongside the
 * existing /api/v1/backtest (which is for the multi-agent advisory backtest).
 *
 * Runs in-process: the evaluator is fast enough that a 60-day 5-min backtest
 * on ^DJI completes in well under a second. No Inngest, no polling. Returns
 * the BacktestSummary with the inserted backtest_id so the caller can fetch
 * per-trade detail from the Trade Inspector UI (053c).
 */

import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth/context";
import { backtestTicketLogic } from "@/lib/backtest-ticket/run";

const BodySchema = z.object({
  logic_name: z.string().min(1),
  version: z.number().int().positive().optional(),
  ticker: z.string().min(1).max(16),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  timeframe: z.enum(["5m", "15m", "1h", "1d"]),
  notional_per_trade: z.number().positive().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 422 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const body = parsed.data;

  if (new Date(body.end_date) <= new Date(body.start_date)) {
    return Response.json(
      { error: "end_date must be after start_date" },
      { status: 422 },
    );
  }

  try {
    const result = await backtestTicketLogic({
      logic_name: body.logic_name,
      version: body.version,
      ticker: body.ticker,
      start_date: body.start_date,
      end_date: body.end_date,
      timeframe: body.timeframe,
      userId: user.userId,
      notionalPerTrade: body.notional_per_trade,
    });
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backtest-ticket] failed:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
