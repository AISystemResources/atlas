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
    <div>
      {/* Sprint 115: match the rest of the Execution page's mono-terminal
          rules. Numbered stage 03 slots into the deploy checklist between
          02 SIGNAL and 04 TRADE. */}
      <SectionRule
        label="03 · PERMISSION"
        right={
          hasActiveGrant ? (
            <span
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.08em",
                color: "var(--bull)",
              }}
            >
              ● ACTIVE
            </span>
          ) : (
            <span
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 10,
                letterSpacing: "0.08em",
                color: "var(--ghost)",
              }}
            >
              ○ IDLE
            </span>
          )
        }
      />

      {!expanded && !hasActiveGrant ? (
        <>
          <p
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              color: "var(--dim)",
              marginBottom: 12,
              lineHeight: 1.6,
            }}
          >
            Let Atlas auto-fire trades within a daily USDC cap. ERC-7715 spend
            permission on Base Smart Wallet.
          </p>
          <button
            onClick={() => setExpanded(true)}
            style={{
              width: "100%",
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              padding: "8px 14px",
              borderRadius: 4,
              border: "1px solid var(--brand)",
              background: "transparent",
              color: "var(--brand)",
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            Enable auto-execute
          </button>
        </>
      ) : hasActiveGrant ? (
        <div className="flex flex-col gap-2">
          {loadingGrants ? (
            <p
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 11,
                color: "var(--ghost)",
              }}
            >
              Loading grants…
            </p>
          ) : (
            activeGrants.map((g) => (
              <ActiveGrantRow
                key={g.id}
                grant={g}
                onRevoke={() => onRevoke(g.id)}
              />
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 10,
                color: "var(--ghost)",
                letterSpacing: "0.08em",
                display: "block",
                marginBottom: 6,
              }}
            >
              DAILY CAP · USDC
            </label>
            <div className="flex items-center gap-3">
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
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink)",
                  minWidth: 56,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                ${capUsdc}
              </span>
            </div>
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: "90px minmax(0, 1fr)",
              rowGap: 6,
              columnGap: 12,
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              paddingTop: 8,
              borderTop: "1px dashed var(--line)",
            }}
          >
            <span
              style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}
            >
              CAP
            </span>
            <span style={{ color: "var(--ink)", textAlign: "right" }}>
              ${capUsdc}/day
            </span>
            <span
              style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}
            >
              SCOPE
            </span>
            <span style={{ color: "var(--ink)", textAlign: "right" }}>
              gTrade only
            </span>
            <span
              style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}
            >
              EXPIRY
            </span>
            <span style={{ color: "var(--ink)", textAlign: "right" }}>
              {PERIOD_DAYS} days
            </span>
            {spenderAddress && (
              <>
                <span
                  style={{
                    color: "var(--ghost)",
                    letterSpacing: "0.06em",
                  }}
                >
                  SPENDER
                </span>
                <span
                  style={{ color: "var(--dim)", textAlign: "right" }}
                >
                  {spenderAddress.slice(0, 6)}…{spenderAddress.slice(-4)}
                </span>
              </>
            )}
          </div>

          <button
            onClick={onGrant}
            disabled={granting || loadingSpender}
            style={{
              width: "100%",
              fontFamily: "var(--font-jb)",
              fontSize: 13,
              fontWeight: 600,
              padding: "10px 14px",
              borderRadius: 4,
              border: `1px solid ${granting || loadingSpender ? "var(--line)" : "var(--brand)"}`,
              background:
                granting || loadingSpender
                  ? "var(--elevated)"
                  : "var(--brand)",
              color:
                granting || loadingSpender ? "var(--ghost)" : "#fff",
              cursor:
                granting || loadingSpender ? "not-allowed" : "pointer",
              letterSpacing: "0.06em",
            }}
          >
            {granting
              ? "Awaiting wallet…"
              : loadingSpender
                ? "Loading spender…"
                : "Grant permission"}
          </button>

          <button
            onClick={() => setExpanded(false)}
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 10,
              color: "var(--ghost)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              letterSpacing: "0.06em",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--bear)",
            marginTop: 8,
            lineHeight: 1.5,
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

// Sprint 115: same SectionRule idiom as the rest of the app.
function SectionRule({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-3"
      style={{
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.14em",
          color: "var(--ink)",
        }}
      >
        {label}
      </span>
      <span aria-hidden style={{ flex: 1 }} />
      {right}
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
      className="grid"
      style={{
        gridTemplateColumns: "90px minmax(0, 1fr)",
        rowGap: 6,
        columnGap: 12,
        fontFamily: "var(--font-jb)",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}>
        DAILY CAP
      </span>
      <span
        style={{
          color: "var(--ink)",
          fontWeight: 600,
          textAlign: "right",
        }}
      >
        ${capUsdc.toFixed(2)}
      </span>

      <span style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}>
        EXPIRES
      </span>
      <span style={{ color: "var(--ink)", textAlign: "right" }}>
        {expiresLabel}
      </span>

      <span style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}>
        SPENDER
      </span>
      <span style={{ color: "var(--dim)", textAlign: "right" }}>
        {grant.spender_address.slice(0, 6)}…{grant.spender_address.slice(-4)}
      </span>

      <button
        onClick={onRevoke}
        style={{
          gridColumn: "1 / -1",
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          padding: "6px 10px",
          borderRadius: 3,
          border: "1px solid var(--bear)",
          background: "transparent",
          color: "var(--bear)",
          cursor: "pointer",
          letterSpacing: "0.04em",
          marginTop: 4,
        }}
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
