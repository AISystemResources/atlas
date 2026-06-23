/**
 * One-shot: close all open legacy investment positions (AAPL, AMZN, BTCUSD,
 * MSFT, NVDA, TSLA) from the user's Alpaca paper account.
 *
 * These are long-term investment holds, not intraday scalper trades.
 *
 * Run:  npx tsx --env-file .env.local scripts/close-legacy-positions.ts
 */

import { createClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Alpaca = require("@alpacahq/alpaca-trade-api");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Clerk user ID for the Atlas account owner
const USER_ID = "user_3B4k96FjK9wZUDi8Xs0AzeNLnvy";

const TICKERS = ["AAPL", "AMZN", "BTCUSD", "MSFT", "NVDA", "TSLA"];

async function main() {
  const sb = createClient(url, key!);

  // 1. Load Alpaca credentials from broker_connections
  const { data: conn, error: connErr } = await sb
    .from("broker_connections")
    .select("api_key, api_secret, environment")
    .eq("user_id", USER_ID)
    .eq("broker", "alpaca")
    .eq("is_active", true)
    .single() as {
      data: { api_key: string; api_secret: string; environment: string } | null;
      error: unknown;
    };

  if (connErr || !conn) {
    console.error("No active Alpaca connection found:", connErr);
    process.exit(1);
  }

  const isPaper = conn.environment === "paper";
  console.log(`Using Alpaca ${isPaper ? "paper" : "live"} account`);

  // 2. Create Alpaca client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alpaca = new Alpaca({
    keyId: conn.api_key,
    secretKey: conn.api_secret,
    paper: isPaper,
  });

  // 3. Close each position
  for (const ticker of TICKERS) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (alpaca as any).closePosition(ticker);
      console.log(`✓ Closed ${ticker}  order_id=${result.id ?? "(no id)"}  status=${result.status ?? "?"}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // 422 = position not found (already closed or never existed) — not fatal
      if (msg.includes("422") || msg.includes("not found") || msg.includes("position does not exist")) {
        console.log(`  ${ticker}: no open position — skipped`);
      } else {
        console.error(`✗ ${ticker}: ${msg}`);
      }
    }
  }
}

main().catch(console.error);
