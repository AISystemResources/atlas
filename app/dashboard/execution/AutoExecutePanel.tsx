"use client";

import { useCallback, useEffect, useState } from "react";
import { connectSmartWallet, grantSpendPermission } from "@/lib/execution/smart-wallet";
import { GTRADE_DIAMOND_BASE, USDC_BASE, USDC_DECIMALS } from "@/lib/execution/gtrade";

// Sprint 109 Phase 2: opt-in Auto-Execute panel.
//
// Sits in the left rail below the Wallet card. Users who want the server to
// sign gTrade trades on their behalf (within a pre-authorised USDC cap on
// gTrade only) connect a Base Smart Wallet here and grant an ERC-7715
// permission. This is entirely separate from the browser wallet used for
// manual trades — the two flows coexist.

const DEFAULT_CAP_USDC = 10;
const MAX_CAP_USDC = 50;
const PERIOD_DAYS = 30;

interface ActivePermission {
  id: string;
  spender_address: string;
  allowance_wei: string;
  expires_at: string;
  grant_tx_hash: string;
}

export function AutoExecutePanel() {
  const [spenderAddress, setSpenderAddress] = useState<string | null>(null);
  const [loadingSpender, setLoadingSpender] = useState(false);
  const [activeGrants, setActiveGrants] = useState<ActivePermission[]>([]);
  const [loadingGrants, setLoadingGrants] = useState(false);
  const [capUsdc, setCapUsdc] = useState(DEFAULT_CAP_USDC);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const loadGrants = useCallback(async () => {
    setLoadingGrants(true);
    try {
      const res = await fetch("/api/v1/spend-permissions");
      if (res.ok) {
        const json = (await res.json()) as { permissions: ActivePermission[] };
        setActiveGrants(json.permissions ?? []);
      }
    } finally {
      setLoadingGrants(false);
    }
  }, []);

  useEffect(() => {
    loadGrants();
  }, [loadGrants]);

  async function ensureSpender(): Promise<string | null> {
    if (spenderAddress) return spenderAddress;
    setLoadingSpender(true);
    setError("");
    try {
      const res = await fetch("/api/v1/spender-key");
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { spender_address: string };
      setSpenderAddress(j.spender_address);
      return j.spender_address;
    } catch (err) {
      setError(err instanceof Error ? err.message : "spender key load failed");
      return null;
    } finally {
      setLoadingSpender(false);
    }
  }

  async function onGrant() {
    setError("");
    const spender = await ensureSpender();
    if (!spender) return;
    setGranting(true);
    try {
      // Step 1: connect Smart Wallet if not already open.
      const { provider } = await connectSmartWallet();

      // Step 2: request the permission grant.
      const allowanceWei = (BigInt(Math.round(capUsdc * 10 ** USDC_DECIMALS))).toString();
      const periodSeconds = PERIOD_DAYS * 24 * 3600;
      const expiresAt = Math.floor(Date.now() / 1000) + periodSeconds;

      const result = await grantSpendPermission({
        provider,
        spenderAddress: spender,
        tokenAddress: USDC_BASE,
        contractTarget: GTRADE_DIAMOND_BASE,
        allowanceWei,
        periodSeconds,
        expiresAtEpochSeconds: expiresAt,
      });

      // Step 3: record server-side. The wallet response shape varies; we
      // pass through whatever tx hash / receipt we can find.
      const grantTxHash = extractTxHash(result) ?? "0x-pending";

      const recordRes = await fetch("/api/v1/spend-permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spender_address: spender,
          token_address: USDC_BASE,
          contract_target: GTRADE_DIAMOND_BASE,
          allowance_wei: allowanceWei,
          period_seconds: periodSeconds,
          grant_tx_hash: grantTxHash,
          expires_at: new Date(expiresAt * 1000).toISOString(),
        }),
      });

      if (!recordRes.ok) {
        const j = (await recordRes.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${recordRes.status}`);
      }

      await loadGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "grant failed");
    } finally {
      setGranting(false);
    }
  }

  async function onRevoke(grantId: string) {
    if (!confirm("Revoke this permission grant? Atlas will stop auto-executing trades until you grant a new one.")) {
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/v1/spend-permissions?id=${encodeURIComponent(grantId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await loadGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "revoke failed");
    }
  }

  const hasActiveGrant = activeGrants.length > 0;

  return (
    <div
      className="rounded-lg p-4 border"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
          Auto-execute
        </h2>
        {hasActiveGrant && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: "var(--bull-bg)", color: "var(--bull)" }}
          >
            Active
          </span>
        )}
      </div>

      {!expanded && !hasActiveGrant ? (
        <>
          <p className="text-xs mb-3" style={{ color: "var(--dim)" }}>
            Let Atlas auto-fire trades within a cap you set. Uses ERC-7715
            spend permissions on Base Smart Wallet.
          </p>
          <button
            onClick={() => setExpanded(true)}
            className="w-full py-2 rounded-md text-xs font-medium transition-colors border"
            style={{ borderColor: "var(--brand)", color: "var(--brand)", background: "transparent" }}
          >
            Enable auto-execute
          </button>
        </>
      ) : hasActiveGrant ? (
        <div className="flex flex-col gap-2">
          {loadingGrants ? (
            <p className="text-xs" style={{ color: "var(--ghost)" }}>Loading grants…</p>
          ) : (
            activeGrants.map((g) => (
              <ActiveGrantRow key={g.id} grant={g} onRevoke={() => onRevoke(g.id)} />
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--ghost)" }}>
              Daily cap (USDC)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={MAX_CAP_USDC}
                value={capUsdc}
                onChange={(e) => setCapUsdc(Number(e.target.value))}
                className="flex-1"
                style={{ accentColor: "var(--brand)" }}
              />
              <span
                className="text-xs font-mono px-2 py-1 rounded"
                style={{ background: "var(--elevated)", color: "var(--ink)", minWidth: 60, textAlign: "center" }}
              >
                ${capUsdc}
              </span>
            </div>
          </div>

          <div
            className="text-[11px] rounded-md p-2"
            style={{ background: "var(--elevated)", color: "var(--dim)" }}
          >
            You are authorising Atlas to spend up to <strong>${capUsdc}/day</strong> of USDC,{" "}
            <strong>only on the gTrade contract</strong>, for <strong>{PERIOD_DAYS} days</strong>.
            Atlas holds a server-side signer scoped to this cap; revoke anytime.
          </div>

          {spenderAddress && (
            <div className="text-[10px] font-mono" style={{ color: "var(--ghost)" }}>
              Spender: {spenderAddress.slice(0, 6)}…{spenderAddress.slice(-4)}
            </div>
          )}

          <button
            onClick={onGrant}
            disabled={granting || loadingSpender}
            className="w-full py-2 rounded-md text-xs font-medium transition-colors"
            style={{
              background: granting || loadingSpender ? "var(--elevated)" : "var(--brand)",
              color: granting || loadingSpender ? "var(--ghost)" : "#fff",
            }}
          >
            {granting ? "Awaiting wallet…" : loadingSpender ? "Loading spender…" : "Grant permission"}
          </button>

          <button
            onClick={() => setExpanded(false)}
            className="w-full py-1 text-[10px]"
            style={{ color: "var(--ghost)", background: "transparent", border: "none" }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs mt-2" style={{ color: "var(--bear)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function ActiveGrantRow({
  grant,
  onRevoke,
}: {
  grant: ActivePermission;
  onRevoke: () => void;
}) {
  const capUsdc = Number(grant.allowance_wei) / 10 ** USDC_DECIMALS;
  // Expiry rendered as raw date — computing "days left" from Date.now()
  // during render trips the React compiler's impurity rule.
  const expiresLabel = new Date(grant.expires_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return (
    <div
      className="rounded-md p-2 flex flex-col gap-1"
      style={{ background: "var(--elevated)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "var(--ghost)" }}>
          Daily cap
        </span>
        <span className="text-sm font-mono font-medium" style={{ color: "var(--ink)" }}>
          ${capUsdc.toFixed(2)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "var(--ghost)" }}>
          Expires
        </span>
        <span className="text-xs font-mono" style={{ color: "var(--ink)" }}>
          {expiresLabel}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "var(--ghost)" }}>
          Spender
        </span>
        <span className="text-[10px] font-mono" style={{ color: "var(--dim)" }}>
          {grant.spender_address.slice(0, 6)}…{grant.spender_address.slice(-4)}
        </span>
      </div>
      <button
        onClick={onRevoke}
        className="text-[10px] mt-1 py-1 rounded-md border"
        style={{ borderColor: "var(--bear)", color: "var(--bear)", background: "transparent" }}
      >
        Revoke
      </button>
    </div>
  );
}

function extractTxHash(result: unknown): string | null {
  if (typeof result === "string" && result.startsWith("0x")) return result;
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.txHash === "string") return obj.txHash;
    if (typeof obj.transactionHash === "string") return obj.transactionHash;
    if (typeof obj.hash === "string") return obj.hash;
    // ERC-7715 grants may return an array of permissions with hashes
    if (Array.isArray(obj.permissions) && obj.permissions.length > 0) {
      const first = obj.permissions[0] as Record<string, unknown>;
      if (typeof first.txHash === "string") return first.txHash;
    }
  }
  return null;
}
