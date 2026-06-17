"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/api";

type Posture = "auto" | "manual" | "optimal" | "high-risk";

function derivePosture(o: boolean, c: boolean): Posture {
  if (o && c) return "auto";
  if (!o && !c) return "manual";
  if (!o && c) return "optimal";
  return "high-risk";
}

interface PostureMeta {
  label: string;
  detail: string;
  warning: string | null;
  level: "neutral" | "good" | "caution";
}

function postureMeta(p: Posture): PostureMeta {
  switch (p) {
    case "auto":
      return {
        label: "Autonomous",
        detail: "AI executes both entries and exits autonomously, gated by the EBC circuit breaker.",
        warning: null,
        level: "neutral",
      };
    case "manual":
      return {
        label: "Manual",
        detail: "AI signals are advisory. You manually approve every entry and every exit.",
        warning: null,
        level: "neutral",
      };
    case "optimal":
      return {
        label: "Asymmetric — recommended",
        detail: "You decide when to open positions; AI handles exits mechanically. The combination most resistant to disposition-effect losses.",
        warning: null,
        level: "good",
      };
    case "high-risk":
      return {
        label: "Asymmetric — high risk",
        detail: "AI opens positions autonomously, but you must close each one manually.",
        warning:
          "This is the highest-risk configuration. AI can accumulate positions faster than you can manage exits, and unrealized losses can compound. Consider 'Autonomous' or 'Asymmetric — recommended' instead.",
        level: "caution",
      };
  }
}

export function AutonomySection() {
  const [loading, setLoading] = useState(true);
  const [persistedOpen, setPersistedOpen] = useState<boolean | null>(null);
  const [persistedClose, setPersistedClose] = useState<boolean | null>(null);
  const [stagedOpen, setStagedOpen] = useState<boolean>(true);
  const [stagedClose, setStagedClose] = useState<boolean>(true);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchWithAuth("/api/v1/user/settings")
      .then((r) => r?.json())
      .then((data: { ai_intervenes_open?: boolean; ai_intervenes_close?: boolean } | null) => {
        if (!active) return;
        const o = data?.ai_intervenes_open !== false;
        const c = data?.ai_intervenes_close !== false;
        setPersistedOpen(o);
        setPersistedClose(c);
        setStagedOpen(o);
        setStagedClose(c);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const dirty =
    persistedOpen !== null &&
    persistedClose !== null &&
    (stagedOpen !== persistedOpen || stagedClose !== persistedClose);

  const stagedPosture = derivePosture(stagedOpen, stagedClose);
  const meta = postureMeta(stagedPosture);

  async function persist() {
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/v1/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_intervenes_open: stagedOpen,
          ai_intervenes_close: stagedClose,
        }),
      });
      if (res?.ok) {
        setPersistedOpen(stagedOpen);
        setPersistedClose(stagedClose);
        setSavedNote("Saved.");
        setTimeout(() => setSavedNote(null), 2200);
      }
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }

  if (loading) return null;

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "20px 22px",
        marginBottom: 16,
        boxShadow: "var(--card-shadow)",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <div
          style={{
            color: "var(--ghost)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            marginBottom: 6,
          }}
        >
          AI INTERVENTION
        </div>
        <h2
          className="font-display font-bold"
          style={{ fontSize: 18, color: "var(--ink)", letterSpacing: "-0.01em", marginBottom: 4 }}
        >
          Where AI manages your trades
        </h2>
        <p
          style={{
            color: "var(--ghost)",
            fontSize: 13,
            fontFamily: "var(--font-nunito)",
            lineHeight: 1.55,
            maxWidth: 580,
          }}
        >
          Independently choose whether AI handles the OPEN of a trade, the CLOSE, both, or neither.
          Atlas changes its execution behavior based on these toggles.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginBottom: 18 }}>
        <ToggleCard
          label="Open trades"
          description="AI executes BUY signals above the confidence gate without your approval."
          on={stagedOpen}
          onChange={setStagedOpen}
        />
        <ToggleCard
          label="Close trades"
          description="AI executes SELL signals — exits, stop-losses, target hits — without your approval."
          on={stagedClose}
          onChange={setStagedClose}
        />
      </div>

      <PostureSummary meta={meta} />

      <div className="flex items-center justify-end gap-3" style={{ marginTop: 18 }}>
        {savedNote && (
          <span
            style={{
              color: "var(--bull)",
              fontSize: 11,
              fontFamily: "var(--font-jb)",
              letterSpacing: "0.04em",
            }}
          >
            ✓ {savedNote}
          </span>
        )}
        <button
          onClick={() => {
            if (persistedOpen !== null && persistedClose !== null) {
              setStagedOpen(persistedOpen);
              setStagedClose(persistedClose);
            }
          }}
          disabled={!dirty || saving}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            color: "var(--ghost)",
            fontSize: 12,
            fontFamily: "var(--font-jb)",
            padding: "6px 14px",
            borderRadius: 6,
            cursor: !dirty || saving ? "default" : "pointer",
            opacity: !dirty || saving ? 0.4 : 1,
          }}
        >
          Reset
        </button>
        <button
          onClick={() => {
            if (stagedPosture === "high-risk") setConfirming(true);
            else void persist();
          }}
          disabled={!dirty || saving}
          style={{
            background: dirty && !saving ? "var(--ink)" : "var(--line)",
            color: dirty && !saving ? "var(--bg)" : "var(--ghost)",
            border: "none",
            fontSize: 12,
            fontFamily: "var(--font-jb)",
            padding: "8px 18px",
            borderRadius: 6,
            cursor: dirty && !saving ? "pointer" : "default",
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          {saving ? "SAVING…" : "SAVE"}
        </button>
      </div>

      {confirming && (
        <HighRiskConfirmation
          onCancel={() => setConfirming(false)}
          onConfirm={persist}
          saving={saving}
        />
      )}
    </section>
  );
}

function ToggleCard({
  label,
  description,
  on,
  onChange,
}: {
  label: string;
  description: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        background: on ? "var(--elevated)" : "var(--surface)",
        border: `1px solid ${on ? "var(--ink)" : "var(--line)"}`,
        borderRadius: 10,
        padding: "16px 18px",
        textAlign: "left",
        cursor: "pointer",
        transition: "border-color 120ms ease, background 120ms ease",
      }}
    >
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 6 }}>
        <span
          className="font-display"
          style={{ fontSize: 14, color: "var(--ink)", fontWeight: 700, letterSpacing: "0.01em" }}
        >
          {label}
        </span>
        <SwitchVisual on={on} />
      </div>
      <p style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-nunito)", lineHeight: 1.5 }}>
        {description}
      </p>
    </button>
  );
}

function SwitchVisual({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? "var(--bull)" : "var(--line)",
        position: "relative",
        transition: "background 150ms ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg)",
          transition: "left 150ms ease",
        }}
      />
    </span>
  );
}

function PostureSummary({ meta }: { meta: PostureMeta }) {
  const bg =
    meta.level === "good"
      ? "rgba(0,200,150,0.06)"
      : meta.level === "caution"
        ? "rgba(255,140,0,0.08)"
        : "var(--elevated)";
  const border =
    meta.level === "good"
      ? "rgba(0,200,150,0.25)"
      : meta.level === "caution"
        ? "rgba(255,140,0,0.35)"
        : "var(--line)";
  const labelColor =
    meta.level === "good"
      ? "var(--bull)"
      : meta.level === "caution"
        ? "rgb(255,140,0)"
        : "var(--ink)";
  const labelIcon =
    meta.level === "good" ? "✓" : meta.level === "caution" ? "⚠" : "●";

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <span style={{ color: labelColor, fontSize: 12, fontFamily: "var(--font-jb)" }}>
          {labelIcon}
        </span>
        <span
          style={{
            color: labelColor,
            fontSize: 12,
            fontFamily: "var(--font-jb)",
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          {meta.label.toUpperCase()}
        </span>
      </div>
      <p
        style={{
          color: "var(--ink)",
          fontSize: 13,
          fontFamily: "var(--font-nunito)",
          lineHeight: 1.55,
        }}
      >
        {meta.detail}
      </p>
      {meta.warning && (
        <p
          style={{
            marginTop: 10,
            color: "rgb(255,140,0)",
            fontSize: 12,
            fontFamily: "var(--font-nunito)",
            lineHeight: 1.55,
            fontWeight: 600,
          }}
        >
          {meta.warning}
        </p>
      )}
    </div>
  );
}

function HighRiskConfirmation({
  onCancel,
  onConfirm,
  saving,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid rgba(255,140,0,0.35)",
          borderRadius: 14,
          padding: "22px 24px",
          maxWidth: 460,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
          <span style={{ color: "rgb(255,140,0)", fontSize: 16 }}>⚠</span>
          <h3
            className="font-display font-bold"
            style={{
              fontSize: 16,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            Confirm high-risk configuration
          </h3>
        </div>
        <p
          style={{
            color: "var(--ink)",
            fontSize: 13,
            fontFamily: "var(--font-nunito)",
            lineHeight: 1.55,
            marginBottom: 12,
          }}
        >
          You&apos;ve chosen for AI to open positions on your behalf but to handle all closes yourself.
        </p>
        <p
          style={{
            color: "var(--ghost)",
            fontSize: 12,
            fontFamily: "var(--font-nunito)",
            lineHeight: 1.55,
            marginBottom: 18,
          }}
        >
          This is the highest-risk configuration in Atlas. AI may accumulate more positions than you
          can actively manage, and unrealized losses can compound while waiting for your manual exit
          decisions. Most users get better outcomes from <strong>Autonomous</strong> or the
          <strong> Asymmetric — recommended</strong> configuration (Human-open + AI-close).
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={saving}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              color: "var(--ghost)",
              fontSize: 13,
              fontFamily: "var(--font-jb)",
              padding: "8px 16px",
              borderRadius: 6,
              cursor: saving ? "default" : "pointer",
              letterSpacing: "0.04em",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            style={{
              background: "rgb(255,140,0)",
              color: "#fff",
              border: "none",
              fontSize: 13,
              fontFamily: "var(--font-jb)",
              padding: "8px 18px",
              borderRadius: 6,
              cursor: saving ? "default" : "pointer",
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            {saving ? "SAVING…" : "I UNDERSTAND, SAVE"}
          </button>
        </div>
      </div>
    </div>
  );
}
