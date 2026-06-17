"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";

interface AutonomyProfile {
  ai_intervenes_open?: boolean;
  ai_intervenes_close?: boolean;
}

type Posture = "auto" | "manual" | "optimal" | "high-risk";

function derivePosture(o: boolean, c: boolean): Posture {
  if (o && c) return "auto";
  if (!o && !c) return "manual";
  if (!o && c) return "optimal";
  return "high-risk"; // o=true, c=false
}

interface PostureMeta {
  label: string;
  detail: string;
  bg: string;
  border: string;
  fg: string;
  icon: string;
}

function postureMeta(p: Posture): PostureMeta {
  switch (p) {
    case "auto":
      return {
        label: "Autonomous",
        detail: "AI manages opens + closes (EBC active)",
        bg: "rgba(0,200,150,0.08)",
        border: "rgba(0,200,150,0.25)",
        fg: "var(--bull)",
        icon: "●",
      };
    case "manual":
      return {
        label: "Manual",
        detail: "You manage opens + closes — AI advises only",
        bg: "var(--elevated)",
        border: "var(--line)",
        fg: "var(--ghost)",
        icon: "○",
      };
    case "optimal":
      return {
        label: "Asymmetric",
        detail: "You gate entries · AI handles exits (recommended)",
        bg: "rgba(64,140,255,0.08)",
        border: "rgba(64,140,255,0.25)",
        fg: "rgb(64,140,255)",
        icon: "◐",
      };
    case "high-risk":
      return {
        label: "High-risk asymmetric",
        detail: "AI opens · you must close — positions can pile up",
        bg: "rgba(255,140,0,0.10)",
        border: "rgba(255,140,0,0.35)",
        fg: "rgb(255,140,0)",
        icon: "⚠",
      };
  }
}

/**
 * Autonomy posture indicator — shows the 4-cell asymmetric autonomy state at a glance.
 * Clicking takes the user to Settings to reconfigure.
 *
 * One of:
 *  - Autonomous (AI both): green dot, default Atlas behavior
 *  - Manual (neither): grey, you control everything
 *  - Asymmetric · optimal (AI close only): blue, "recommended"
 *  - High-risk asymmetric (AI open only): amber, warning
 */
export function AutonomyBadge() {
  const router = useRouter();
  const [profile, setProfile] = useState<AutonomyProfile | null>(null);

  useEffect(() => {
    let active = true;
    fetchWithAuth("/api/v1/user/settings")
      .then((r) => r?.json())
      .then((data: AutonomyProfile | null) => {
        if (active && data) setProfile(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!profile) return null;

  const open = profile.ai_intervenes_open !== false; // default to true
  const close = profile.ai_intervenes_close !== false;
  const posture = derivePosture(open, close);
  const meta = postureMeta(posture);

  return (
    <button
      onClick={() => router.push("/dashboard/settings")}
      style={{
        width: "100%",
        background: meta.bg,
        border: `1px solid ${meta.border}`,
        borderRadius: 8,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        textAlign: "left",
        cursor: "pointer",
        transition: "border-color 120ms ease, transform 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span
          style={{
            color: meta.fg,
            fontSize: 12,
            fontFamily: "var(--font-jb)",
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          {meta.icon} {meta.label.toUpperCase()}
        </span>
        <span
          className="hidden md:inline"
          style={{
            color: "var(--ghost)",
            fontSize: 11,
            fontFamily: "var(--font-nunito)",
          }}
        >
          {meta.detail}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Pill label="OPEN" on={open} />
        <Pill label="CLOSE" on={close} />
        <span
          style={{
            marginLeft: 6,
            color: "var(--ghost)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
          }}
        >
          EDIT →
        </span>
      </div>
    </button>
  );
}

function Pill({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      style={{
        background: on ? "var(--ink)" : "transparent",
        color: on ? "var(--bg)" : "var(--ghost)",
        border: `1px solid ${on ? "var(--ink)" : "var(--line)"}`,
        borderRadius: 4,
        padding: "2px 7px",
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.08em",
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}
