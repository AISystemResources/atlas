"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/api";

type Scope = "read" | "write" | "read_write";

type PAT = {
  id: string;
  name: string;
  scope: Scope;
  last_used_at: string | null;
  created_at: string;
  expires_at: string | null;
};

const SCOPE_LABEL: Record<Scope, string> = {
  read: "Read",
  write: "Write",
  read_write: "Read + Write",
};

const SCOPE_COLOR: Record<Scope, string> = {
  read: "var(--brand)",
  write: "var(--bear)",
  read_write: "var(--bull)",
};

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function ClaudeConnectorSection() {
  const [pats, setPats] = useState<PAT[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/v1/pats")
      .then((r) => r?.json())
      .then((data) => { if (Array.isArray(data)) setPats(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleRevoke(id: string) {
    setRevoking(id);
    try {
      await fetchWithAuth(`/api/v1/pats/${id}`, { method: "DELETE" });
      setPats((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // non-fatal
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div>
      <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 10, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>
        Claude Connector
      </div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", boxShadow: "var(--card-shadow)" }}>
        {/* Header — informational only */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontSize: 13, fontFamily: "var(--font-nunito)", color: "var(--dim)", lineHeight: 1.5 }}>
            Connect Atlas to Claude Desktop or ChatGPT via MCP. When prompted by the AI app, approve the
            authorization request to link your account. Active connections appear below; revoke anytime.
          </div>
        </div>

        {/* Active OAuth + PAT records */}
        {loading ? (
          <div style={{ padding: "14px 16px", color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-jb)" }}>
            Loading…
          </div>
        ) : pats.length === 0 ? (
          <div style={{ padding: "14px 16px", color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-nunito)" }}>
            No active connections. Install the Atlas MCP server in your AI app, then authorize when prompted.
          </div>
        ) : (
          pats.map((pat) => (
            <div key={pat.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontFamily: "var(--font-nunito)", fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {pat.name}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <span style={{
                    fontSize: 9, fontFamily: "var(--font-jb)", fontWeight: 700,
                    color: SCOPE_COLOR[pat.scope], border: `1px solid ${SCOPE_COLOR[pat.scope]}30`,
                    padding: "1px 5px", borderRadius: 3, textTransform: "uppercase" as const, letterSpacing: "0.05em",
                  }}>
                    {SCOPE_LABEL[pat.scope]}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}>
                    {pat.last_used_at ? `Used ${formatRelative(pat.last_used_at)}` : "Never used"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleRevoke(pat.id)}
                disabled={revoking === pat.id}
                style={{
                  flexShrink: 0, padding: "4px 10px", borderRadius: 6,
                  border: "1px solid var(--line)", background: "transparent",
                  color: revoking === pat.id ? "var(--ghost)" : "var(--bear)",
                  fontSize: 11, fontFamily: "var(--font-jb)", cursor: revoking === pat.id ? "default" : "pointer",
                }}
              >
                {revoking === pat.id ? "…" : "Revoke"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
