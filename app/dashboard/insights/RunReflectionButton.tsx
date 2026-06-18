"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";

interface DistillationResult {
  user_id?: string;
  trading_date?: string;
  skipped?: boolean;
  reason?: string;
  trade_count?: number;
  error?: string;
}

export function RunReflectionButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "info" | "ok" | "warn" | "err"; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg({ kind: "info", text: "Running reflection — this may take 10–30s for Groq to respond..." });
    try {
      const res = await fetchWithAuth("/api/v1/insights/run-distillation", { method: "POST" });
      const data = (await res?.json()) as DistillationResult | null;

      if (!data) {
        setMsg({ kind: "err", text: "No response from the server." });
        return;
      }
      if (data.error) {
        setMsg({ kind: "err", text: data.error });
        return;
      }
      if (data.skipped) {
        const reason = data.reason ?? "skipped";
        const friendly =
          reason === "no_trades"
            ? `No trades for ${data.trading_date} yet — nothing to reflect on.`
            : reason === "mcp_entry_exists"
              ? `An MCP-driven reflection already exists for ${data.trading_date}. Groq skipped per priority rules.`
              : reason === "invalid_llm_output"
                ? "Groq returned malformed output. Try again."
                : reason.startsWith("parse_error")
                  ? "Groq returned non-JSON. Try again."
                  : `Skipped: ${reason}`;
        setMsg({ kind: "warn", text: friendly });
        return;
      }
      setMsg({
        kind: "ok",
        text: `Reflection saved for ${data.trading_date} (${data.trade_count} trade${data.trade_count === 1 ? "" : "s"} analysed).`,
      });
      // Reload server-rendered list so the new entry appears.
      router.refresh();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Network error." });
    } finally {
      setBusy(false);
    }
  }

  const tone = (() => {
    switch (msg?.kind) {
      case "ok":
        return { bg: "rgba(0,200,150,0.08)", border: "rgba(0,200,150,0.3)", fg: "var(--bull)" };
      case "warn":
        return { bg: "rgba(255,140,0,0.08)", border: "rgba(255,140,0,0.35)", fg: "rgb(255,140,0)" };
      case "err":
        return { bg: "rgba(255,45,85,0.08)", border: "rgba(255,45,85,0.3)", fg: "var(--bear)" };
      case "info":
        return { bg: "var(--elevated)", border: "var(--line)", fg: "var(--ghost)" };
      default:
        return null;
    }
  })();

  return (
    <div className="flex flex-col gap-2" style={{ marginBottom: 16 }}>
      <button
        onClick={run}
        disabled={busy}
        style={{
          alignSelf: "flex-start",
          background: busy ? "var(--line)" : "var(--ink)",
          color: busy ? "var(--ghost)" : "var(--bg)",
          border: "none",
          fontSize: 12,
          fontFamily: "var(--font-jb)",
          padding: "8px 16px",
          borderRadius: 6,
          cursor: busy ? "default" : "pointer",
          fontWeight: 700,
          letterSpacing: "0.04em",
        }}
      >
        {busy ? "RUNNING…" : "RUN REFLECTION"}
      </button>
      {msg && tone && (
        <div
          style={{
            background: tone.bg,
            border: `1px solid ${tone.border}`,
            color: tone.fg,
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 12,
            fontFamily: "var(--font-nunito)",
            lineHeight: 1.5,
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
