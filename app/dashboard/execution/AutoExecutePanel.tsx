"use client";

import { useCallback, useEffect, useState } from "react";
import { connectSmartWallet, createSubAccount } from "@/lib/execution/smart-wallet";

// Sprint 118: Coinbase Smart Sub-Accounts. Replaces the dead ERC-7715 path
// (Sprint 109 Phase 2). The flow is:
//   1. User clicks "Enable auto-execute"
//   2. Atlas ensures a server-side spender key exists (Sprint 109b infra)
//   3. Atlas calls wallet_addSubAccount registering the spender key as the
//      initial signer — creates a nested smart account under the user's
//      Smart Wallet
//   4. UI shows the sub-account address; user tops it up with USDC
//   5. When a signal fires, the dispatcher (Sprint 119) signs a
//      UserOperation from the sub-account and submits via a bundler
//
// Trust: the sub-account holds its OWN funds. Blast radius if the server
// is compromised = whatever's in the sub-account. User controls exposure
// by controlling top-ups.

interface SubAccount {
  address: string;
  spender_address: string;
  factory: string | null;
  factory_data: string | null;
  created_at: string;
}

// Sprint 117 error surfacing. Wallet providers throw plain objects like
//   { code: 4001, message: "user rejected" }
// which fail `instanceof Error`, so we pull message/code out ourselves.
function describeSubAccountError(err: unknown, stage: string): string {
  if (typeof err === "string") return `${stage}: ${err}`;
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; code?: unknown };
    const message = typeof e.message === "string" ? e.message : null;
    const code =
      typeof e.code === "number" || typeof e.code === "string" ? `code=${e.code}` : null;
    if (e.code === 4001) return "You cancelled the wallet prompt.";
    if (e.code === 4200 || e.code === -32601) {
      return `${stage}: wallet does not support wallet_addSubAccount (${e.code}). Update your Coinbase Wallet.`;
    }
    const parts = [stage, message, code].filter(Boolean);
    if (parts.length > 1) return parts.join(" · ");
  }
  if (err instanceof Error && err.message) return `${stage}: ${err.message}`;
  return `${stage}: unknown error (check console)`;
}

export function AutoExecutePanel() {
  const [subAccount, setSubAccount] = useState<SubAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/sub-accounts");
      if (res.ok) {
        const j = (await res.json()) as { sub_account: SubAccount | null };
        setSubAccount(j.sub_account);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function ensureSpender(): Promise<string | null> {
    setError("");
    try {
      const res = await fetch("/api/v1/spender-key");
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { spender_address: string };
      return j.spender_address;
    } catch (err) {
      setError(describeSubAccountError(err, "spender"));
      return null;
    }
  }

  async function onCreate() {
    setError("");
    const spender = await ensureSpender();
    if (!spender) return;
    setCreating(true);
    let stage: "connect" | "create" | "record" = "connect";
    try {
      stage = "connect";
      const { provider } = await connectSmartWallet();

      stage = "create";
      const info = await createSubAccount({ provider, spenderAddress: spender });

      stage = "record";
      const recordRes = await fetch("/api/v1/sub-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sub_account_address: info.address,
          spender_address: spender,
          factory: info.factory ?? null,
          factory_data: info.factoryData ?? null,
        }),
      });
      if (!recordRes.ok) {
        const j = (await recordRes.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${recordRes.status}`);
      }

      await load();
      setExpanded(false);
    } catch (err) {
      setError(describeSubAccountError(err, stage));
      console.error(`[auto-execute] sub-account create failed at stage=${stage}:`, err);
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke() {
    if (
      !confirm(
        "Revoke this sub-account? Atlas will stop auto-executing until you create a new one. Funds you already deposited remain in the sub-account.",
      )
    ) {
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/v1/sub-accounts", { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(describeSubAccountError(err, "revoke"));
    }
  }

  async function onCopyAddress() {
    if (!subAccount) return;
    await navigator.clipboard.writeText(subAccount.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div>
      <SectionRule
        label="03 · PERMISSION"
        right={
          subAccount ? (
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

      {loading && !subAccount && !expanded ? (
        <p
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--ghost)",
          }}
        >
          Loading…
        </p>
      ) : subAccount ? (
        <ActiveSubAccountView
          subAccount={subAccount}
          onCopy={onCopyAddress}
          copied={copied}
          onRevoke={onRevoke}
        />
      ) : !expanded ? (
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
            Let Atlas auto-fire trades from a nested Smart Wallet sub-account
            that you top up with USDC. Server holds a scoped signer; sub-account
            holds its own funds.
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
      ) : (
        <CreateSubAccountForm
          creating={creating}
          onCreate={onCreate}
          onCancel={() => setExpanded(false)}
        />
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

// ── ActiveSubAccountView ─────────────────────────────────────────────────────
// Shown when the user has a sub-account. Address + copy button + funding
// coaching + revoke.

function ActiveSubAccountView({
  subAccount,
  onCopy,
  copied,
  onRevoke,
}: {
  subAccount: SubAccount;
  onCopy: () => void;
  copied: boolean;
  onRevoke: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
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
          SUB-ACCOUNT
        </span>
        <span
          style={{
            color: "var(--ink)",
            textAlign: "right",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={subAccount.address}
        >
          {subAccount.address.slice(0, 6)}…{subAccount.address.slice(-4)}
        </span>

        <span style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}>
          SIGNER
        </span>
        <span
          style={{
            color: "var(--dim)",
            textAlign: "right",
          }}
        >
          {subAccount.spender_address.slice(0, 6)}…
          {subAccount.spender_address.slice(-4)}
        </span>

        <span style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}>
          SCOPE
        </span>
        <span style={{ color: "var(--ink)", textAlign: "right" }}>gTrade DIA</span>
      </div>

      <button
        onClick={onCopy}
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          padding: "6px 10px",
          borderRadius: 3,
          border: "1px solid var(--line)",
          background: "var(--surface)",
          color: "var(--ink)",
          cursor: "pointer",
          letterSpacing: "0.02em",
        }}
      >
        {copied ? "Copied ✓" : "Copy full address"}
      </button>

      <p
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 10,
          color: "var(--ghost)",
          lineHeight: 1.6,
          paddingTop: 6,
          borderTop: "1px dashed var(--line)",
        }}
      >
        Fund this address with USDC on Base. When a signal fires, Atlas
        signs a trade from the sub-account. Only what you deposited can be
        spent — the sub-account can never touch your main wallet.
      </p>

      <button
        onClick={onRevoke}
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          padding: "6px 10px",
          borderRadius: 3,
          border: "1px solid var(--bear)",
          background: "transparent",
          color: "var(--bear)",
          cursor: "pointer",
          letterSpacing: "0.04em",
        }}
      >
        Revoke
      </button>
    </div>
  );
}

// ── CreateSubAccountForm ─────────────────────────────────────────────────────

function CreateSubAccountForm({
  creating,
  onCreate,
  onCancel,
}: {
  creating: boolean;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className="grid"
        style={{
          gridTemplateColumns: "90px minmax(0, 1fr)",
          rowGap: 6,
          columnGap: 12,
          fontFamily: "var(--font-jb)",
          fontSize: 11,
        }}
      >
        <span style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}>
          FUNDING
        </span>
        <span style={{ color: "var(--ink)", textAlign: "right" }}>
          You top up · USDC
        </span>
        <span style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}>
          SCOPE
        </span>
        <span style={{ color: "var(--ink)", textAlign: "right" }}>
          gTrade DIA only
        </span>
        <span style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}>
          REVOCABLE
        </span>
        <span style={{ color: "var(--ink)", textAlign: "right" }}>
          Anytime
        </span>
      </div>

      <p
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 10,
          color: "var(--ghost)",
          lineHeight: 1.6,
          paddingTop: 6,
          borderTop: "1px dashed var(--line)",
        }}
      >
        Creates a nested Smart Wallet sub-account. The Atlas server acts as
        a delegated signer. Your main wallet stays untouched — auto-execute
        can only spend what you deposit into the sub-account.
      </p>

      <button
        onClick={onCreate}
        disabled={creating}
        style={{
          width: "100%",
          fontFamily: "var(--font-jb)",
          fontSize: 13,
          fontWeight: 600,
          padding: "10px 14px",
          borderRadius: 4,
          border: `1px solid ${creating ? "var(--line)" : "var(--brand)"}`,
          background: creating ? "var(--elevated)" : "var(--brand)",
          color: creating ? "var(--ghost)" : "#fff",
          cursor: creating ? "not-allowed" : "pointer",
          letterSpacing: "0.06em",
        }}
      >
        {creating ? "Awaiting wallet…" : "Create sub-account"}
      </button>

      <button
        onClick={onCancel}
        disabled={creating}
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 10,
          color: "var(--ghost)",
          background: "transparent",
          border: "none",
          cursor: creating ? "not-allowed" : "pointer",
          letterSpacing: "0.06em",
        }}
      >
        Cancel
      </button>
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
