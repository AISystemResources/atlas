/**
 * /dashboard/backtests — list of the user's Ticket Logic backtests + Run form.
 * Sprint 053c.
 */

import { getServiceClient } from "@/lib/supabase-server";
import { requireSuperadmin } from "@/lib/auth/require-superadmin";
import { BacktestsClient, type BacktestRow } from "./BacktestsClient";

export default async function BacktestsPage() {
  // Sprint 067: backtests live inside Strategy detail pages now. The top-level
  // /dashboard/backtests page is academic / debug only.
  const userId = await requireSuperadmin();

  const sb = getServiceClient();
  const { data } = await sb
    .from("ticket_backtests")
    .select(
      "id, ticker, timeframe, start_date, end_date, total_trades, win_rate, total_pnl_dollars, max_drawdown_dollars, created_at, ticket_logics(name, version)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as unknown as BacktestRow[];

  return <BacktestsClient initialRows={rows} />;
}
