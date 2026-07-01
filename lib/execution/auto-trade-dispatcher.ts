/**
 * Sprint 109 Phase 3: server-side auto-trade dispatcher.
 *
 * Called from the signalEvaluatorCron immediately after a fresh signal_event
 * is inserted. Attempts to open the corresponding gTrade position on the
 * user's Smart Wallet using the ERC-7715 spend permission they previously
 * granted.
 *
 * Flow:
 *   1. Load the signal_events row (guard: executed_at IS NULL, no error yet)
 *   2. Look up the user's active spend_permissions row (unrevoked, unexpired)
 *   3. Decrypt the user_spender_keys.encrypted_private_key
 *   4. Construct a viem WalletClient bound to Base mainnet with that key
 *   5. Call the Base Spend Permission Manager's spend() with the trade
 *      calldata (this is the piece pending on-chain verification — see the
 *      big TODO block below)
 *   6. Record tx_hash + executed_at on the signal_events row
 *
 * If any step fails, record execution_error on the row so it surfaces in
 * the Recent Signals UI. Never throws to the caller — the cron loop must
 * complete for other users.
 */

import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getServiceClient } from "@/lib/supabase-server";
import { loadSpenderPrivateKey } from "./spender-key";

export type AutoExecuteResult = "executed" | "skipped" | "errored";

interface SignalEventRow {
  id: string;
  user_id: string;
  strategy_id: string;
  direction: "long" | "short";
  entry_price: number | null;
  take_profit: number | null;
  stop_loss: number | null;
  current_price: number | null;
  ticker: string | null;
  timeframe: string | null;
  executed_at: string | null;
  execution_error: string | null;
}

interface ActivePermissionRow {
  id: string;
  spender_address: string;
  token_address: string;
  contract_target: string;
  allowance_wei: string;
  period_seconds: number;
  grant_tx_hash: string;
  expires_at: string;
}

async function recordError(eventId: string, msg: string): Promise<void> {
  const sb = getServiceClient();
  await sb
    .from("signal_events")
    .update({ execution_error: msg })
    .eq("id", eventId);
}

async function loadEvent(eventId: string): Promise<SignalEventRow | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("signal_events")
    .select(
      "id, user_id, strategy_id, direction, entry_price, take_profit, stop_loss, current_price, ticker, timeframe, executed_at, execution_error",
    )
    .eq("id", eventId)
    .maybeSingle();
  return (data as SignalEventRow | null) ?? null;
}

async function loadActivePermission(userId: string): Promise<ActivePermissionRow | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("spend_permissions")
    .select(
      "id, spender_address, token_address, contract_target, allowance_wei, period_seconds, grant_tx_hash, expires_at",
    )
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ActivePermissionRow | null) ?? null;
}

export async function autoExecuteSignal(eventId: string): Promise<AutoExecuteResult> {
  const event = await loadEvent(eventId);
  if (!event) return "skipped";
  if (event.executed_at || event.execution_error) return "skipped";

  const permission = await loadActivePermission(event.user_id);
  if (!permission) {
    // No active grant — this user is on Manual mode. Leave the row pending
    // so the Recent Signals UI shows it and the user can review + trade.
    return "skipped";
  }

  let privateKey: `0x${string}` | null;
  try {
    privateKey = await loadSpenderPrivateKey(event.user_id);
  } catch (err) {
    await recordError(
      eventId,
      err instanceof Error ? `spender decrypt: ${err.message}` : "spender decrypt failed",
    );
    return "errored";
  }
  if (!privateKey) {
    await recordError(eventId, "no spender key provisioned for this user");
    return "errored";
  }

  try {
    const account = privateKeyToAccount(privateKey);

    // Sanity: spender address on-chain must match what's in the permission
    // record. If they don't, the on-chain manager will reject anyway; we
    // return a clean error message instead.
    if (account.address.toLowerCase() !== permission.spender_address.toLowerCase()) {
      await recordError(
        eventId,
        `spender mismatch: key derives ${account.address}, permission expects ${permission.spender_address}`,
      );
      return "errored";
    }

    // Reserved by autoExecuteSignal for the on-chain submission path below.
    // Right now clients aren't used because the actual spend() call is a TODO.
    // The imports are kept so a future patch just needs to fill in the
    // contract address + ABI + call body without touching the top of the file.
    void createPublicClient;
    void createWalletClient;
    void http;
    void parseAbi;
    void base;

    // ────────────────────────────────────────────────────────────────────
    // TODO — actual on-chain submission via Base Spend Permission Manager.
    //
    // Two moving pieces need to be verified before this ships fully live:
    //
    //   1. The Base Spend Permission Manager contract address on mainnet.
    //      As of writing, Coinbase has published this but the address /
    //      ABI is not embedded in @base-org/account itself — it comes from
    //      Base's smart-account docs. Once we test the Phase 2 grant flow
    //      end-to-end on Base mainnet, the `wallet_grantPermissions`
    //      response will contain the manager address + a permission
    //      opaque handle we pass to `spend()`.
    //
    //   2. The exact `spend()` call shape:
    //         spend(PermissionData permission, uint256 value, bytes call)
    //      where `call` is the encoded gTrade `openTrade` call built from
    //      the signal's direction / entry / TP / SL / collateral.
    //
    // Wired but disabled until (1) + (2) are pinned down against a real
    // grant — surfacing as an "execution_error" in the Recent Signals UI
    // so it's visible instead of silently doing nothing.
    // ────────────────────────────────────────────────────────────────────
    await recordError(
      eventId,
      "auto-execute wired but on-chain submission awaiting Base Spend Permission Manager verification (Phase 3b)",
    );
    return "errored";
  } catch (err) {
    await recordError(
      eventId,
      err instanceof Error ? `dispatcher: ${err.message}` : "dispatcher failed",
    );
    return "errored";
  }
}
