/**
 * /dashboard/backtests — list of the user's Ticket Logic backtests + Run form.
 * Sprint 053c.
 */

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { BacktestsClient, type BacktestRow } from "./BacktestsClient";

export default async function BacktestsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

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
