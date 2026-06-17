/**
 * GET /api/v1/market/bars?ticker=AAPL&days=90
 *
 * Returns daily OHLCV bars for a ticker over the last N days (default 90, max 365).
 * Used by the stock detail page for the price chart.
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchBars } from "@/lib/market";
import { getUserFromRequest } from "@/lib/auth/context";
import { getBrokerCredentials } from "@/lib/broker/credentials";

const MAX_DAYS = 365;
const DEFAULT_DAYS = 90;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticker = request.nextUrl.searchParams.get("ticker")?.toUpperCase();
  if (!ticker) {
    return NextResponse.json(
      { error: "ticker is required" },
      { status: 400 },
    );
  }

  const rawDays = parseInt(request.nextUrl.searchParams.get("days") ?? "", 10);
  const days = Math.min(
    Number.isFinite(rawDays) && rawDays > 0 ? rawDays : DEFAULT_DAYS,
    MAX_DAYS,
  );

  // Window: today - N days  → today  (UTC ISO YYYY-MM-DD)
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  let creds: Awaited<ReturnType<typeof getBrokerCredentials>> | undefined;
  try {
    creds = await getBrokerCredentials(user.userId);
  } catch {
    // Fall through to env credentials — fetchBars handles undefined creds
  }

  try {
    const bars = await fetchBars(ticker, startStr, endStr, "1Day", creds);
    return NextResponse.json({ ticker, days, bars });
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetchBars failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
