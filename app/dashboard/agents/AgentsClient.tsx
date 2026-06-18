"use client";

import { AgentTab } from "../AgentTab";
import type { Signal } from "../DashboardClient";

export function AgentsClient({ signals }: { signals: Signal[] }) {
  return (
    <div className="flex flex-col gap-4">
      <ArchivedBanner />
      <AgentTab signals={signals} loading={false} />
    </div>
  );
}

function ArchivedBanner() {
  return (
    <section
      style={{
        background: "var(--elevated)",
        border: "1px solid var(--line)",
        borderLeft: "3px solid rgb(255,140,0)",
        borderRadius: 8,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          color: "rgb(255,140,0)",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.08em",
          marginBottom: 6,
        }}
      >
        ARCHIVED · 2026-06-18
      </div>
      <p
        style={{
          color: "var(--ink)",
          fontSize: 13,
          fontFamily: "var(--font-nunito)",
          lineHeight: 1.55,
          maxWidth: 720,
        }}
      >
        The multi-agent swing pipeline (Fetch → Technical / Fundamental / Sentiment / Review →
        Synthesis → Risk → Portfolio) is no longer firing. Cost / quality post-mortem found the
        per-trade LLM expense unjustified for the marginal signal quality. Historical signals are
        preserved here for reference.
      </p>
      <p
        style={{
          color: "var(--ghost)",
          fontSize: 12,
          fontFamily: "var(--font-nunito)",
          lineHeight: 1.55,
          marginTop: 8,
          maxWidth: 720,
        }}
      >
        Phase 2 architecture: deterministic Ticket Logic (Sandy S1 + bracket orders) for execution
        plus AI-collaborator strategy refinement via Daily Distillation (
        <a
          href="/dashboard/insights"
          style={{ color: "var(--ink)", textDecoration: "underline" }}
        >
          Insights →
        </a>
        ).
      </p>
    </section>
  );
}
