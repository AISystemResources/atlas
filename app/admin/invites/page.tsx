"use client";

/**
 * /admin/invites — Sprint 075c.
 *
 * Founder mints invite codes and sees redemption stats. Each row carries
 * a copyable link (atlas-broker.vercel.app/invite/<code>).
 */

import { useEffect, useState, useCallback } from "react";
import { fetchWithAuth } from "@/lib/api";

interface InviteRow {
  code: string;
  label: string | null;
  trial_days: number;
  max_uses: number | null;
  expires_at: string | null;
  created_at: string;
  redemption_count: number;
}

function inviteUrl(code: string): string {
  if (typeof window === "undefined") return `/invite/${code}`;
  return `${window.location.origin}/invite/${code}`;
}

export default function InvitesAdminPage() {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [trialDays, setTrialDays] = useState(14);
  const [maxUses, setMaxUses] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/v1/admin/invites");
      if (res?.ok) {
        const body = await res.json();
        setInvites(body.invites ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onMint() {
    setCreating(true);
    setMsg(null);
    try {
      const res = await fetchWithAuth("/v1/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || undefined,
          trial_days: trialDays,
          max_uses: maxUses ? Number(maxUses) : undefined,
        }),
      });
      const body = await res?.json();
      if (!res?.ok) throw new Error(body?.error ?? `HTTP ${res?.status}`);
      setMsg(`Minted ${body.code}`);
      setLabel("");
      setMaxUses("");
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
      setTimeout(() => setMsg(null), 3000);
    }
  }

  async function onCopy(code: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard denied */
    }
  }

  return (
    <div style={{ padding: "20px 28px", maxWidth: 980 }}>
      <h1 className="font-display font-bold" style={{ fontSize: 22, color: "var(--ink)", marginBottom: 6 }}>
        Invites
      </h1>
      <p style={{ color: "var(--ghost)", fontSize: 13, marginBottom: 24 }}>
        Mint a link to hand to a friend. They click → cookie marker set → sign up → get N days of Pro automatically.
      </p>

      {/* Mint form */}
      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          padding: "16px 18px",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <Field label="Label (optional)">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Mom, college friends"
              style={inputStyle}
            />
          </Field>
          <Field label="Trial days">
            <input
              type="number"
              min={1}
              max={365}
              value={trialDays}
              onChange={(e) => setTrialDays(Number(e.target.value) || 14)}
              style={{ ...inputStyle, width: 90 }}
            />
          </Field>
          <Field label="Max uses (blank = unlimited)">
            <input
              type="number"
              min={1}
              max={1000}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="∞"
              style={{ ...inputStyle, width: 110 }}
            />
          </Field>
          <button
            onClick={onMint}
            disabled={creating}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              background: "var(--brand)",
              color: "#fff",
              border: "none",
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              fontWeight: 600,
              cursor: creating ? "default" : "pointer",
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating ? "Minting…" : "+ Mint invite"}
          </button>
        </div>
        {msg && (
          <p style={{ fontSize: 12, color: "var(--brand)", marginTop: 10, fontFamily: "var(--font-jb)" }}>
            {msg}
          </p>
        )}
      </section>

      {/* List */}
      <section>
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr 0.8fr 0.8fr 0.6fr 0.6fr",
              padding: "10px 14px",
              fontSize: 9,
              fontFamily: "var(--font-jb)",
              color: "var(--ghost)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span>Code</span>
            <span>Label</span>
            <span>Trial</span>
            <span>Uses</span>
            <span>Created</span>
            <span></span>
          </div>

          {loading ? (
            <div style={{ padding: 16, fontSize: 13, color: "var(--ghost)" }}>Loading…</div>
          ) : invites.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: "var(--ghost)" }}>
              No invites yet. Mint one above.
            </div>
          ) : (
            invites.map((inv) => (
              <div
                key={inv.code}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 0.8fr 0.8fr 0.6fr 0.6fr",
                  padding: "10px 14px",
                  fontSize: 12,
                  color: "var(--ink)",
                  borderBottom: "1px solid var(--line)",
                  alignItems: "center",
                }}
              >
                <span className="font-mono" style={{ color: "var(--brand)" }}>{inv.code}</span>
                <span style={{ color: "var(--dim)" }}>{inv.label ?? "—"}</span>
                <span className="font-mono">{inv.trial_days}d</span>
                <span className="font-mono">
                  {inv.redemption_count}
                  {inv.max_uses != null ? ` / ${inv.max_uses}` : ""}
                </span>
                <span style={{ fontSize: 11, color: "var(--ghost)" }}>
                  {new Date(inv.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => onCopy(inv.code)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--line)",
                    borderRadius: 4,
                    color: copied === inv.code ? "var(--bull)" : "var(--ghost)",
                    fontSize: 11,
                    fontFamily: "var(--font-jb)",
                    padding: "4px 10px",
                    cursor: "pointer",
                  }}
                >
                  {copied === inv.code ? "Copied" : "Copy link"}
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 10px",
  fontFamily: "var(--font-jb)",
  fontSize: 12,
  color: "var(--ink)",
  outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, color: "var(--ghost)", fontFamily: "var(--font-jb)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
