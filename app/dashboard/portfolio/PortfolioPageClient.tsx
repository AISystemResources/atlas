"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { PortfolioTab } from "../DashboardClient";
import type { Portfolio } from "../DashboardClient";

const API_URL = "/api";

export function PortfolioPageClient({
  tier,
  boundaryMode,
  needsScalperStrategy = false,
}: {
  tier: "free" | "pro" | "max";
  boundaryMode: string;
  needsScalperStrategy?: boolean;
}) {
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [trialNote, setTrialNote] = useState<string | null>(null);

  // Sprint 075c: redeem invite cookie if present. Idempotent server-side.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!document.cookie.includes("atlas_invite_code=")) return;

    fetch(`${API_URL}/v1/redeem-invite`, { method: "POST" })
      .then((r) => r.ok ? r.json() : null)
      .then((body) => {
        if (body?.ok && body.granted_trial_days) {
          setTrialNote(
            `You've been granted ${body.granted_trial_days} days of Atlas Pro.`,
          );
        }
      })
      .catch(() => {});
  }, []);

  // Initial fetch + per-minute refresh so KPI cards (Total Value, Today, Cash,
  // Total P&L) reflect the live portfolio state. Refresh pauses when the tab is
  // hidden to avoid burning Alpaca quota on inactive sessions.
  useEffect(() => {
    let active = true;

    async function pullPortfolio() {
      try {
        const res = await fetchWithAuth(`${API_URL}/v1/portfolio`);
        const data = await res?.json();
        if (active && data) setPortfolio(data);
      } catch (err) {
        console.error(err);
      }
    }

    pullPortfolio();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") pullPortfolio();
    }, 60_000);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex flex-col gap-3 pb-6">
      {/* Sprint 075c: trial-grant confirmation. Renders only after a
          successful invite redemption on this page load. */}
      {trialNote && (
        <div
          className="rounded-lg px-4 py-2.5 flex items-center justify-between"
          style={{ background: "var(--bull-bg)", border: "1px solid var(--bull)" }}
        >
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--bull)", fontSize: 13, fontFamily: "var(--font-jb)" }}>★</span>
            <span style={{ color: "var(--bull)", fontSize: 12, fontFamily: "var(--font-nunito)" }}>
              {trialNote} You now have access to AI strategy authoring via Claude / ChatGPT.
            </span>
          </div>
        </div>
      )}

      {/* Sprint 065: first-run banner — only shows when the user has no
          scalper strategy configured. Hidden the moment they pick one. */}
      {needsScalperStrategy && (
        <div
          className="rounded-lg px-4 py-2.5 flex items-center justify-between"
          style={{ background: "var(--brand)10", border: "1px solid var(--brand)40" }}
        >
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--brand)", fontSize: 13, fontFamily: "var(--font-jb)" }}>★</span>
            <span style={{ color: "var(--brand)", fontSize: 12, fontFamily: "var(--font-nunito)" }}>
              Pick a strategy from the Library to start your scalper.
            </span>
          </div>
          <button
            onClick={() => router.push("/dashboard/strategies")}
            style={{
              color: "var(--brand)", fontSize: 11, fontFamily: "var(--font-jb)",
              background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline",
            }}
          >
            Browse →
          </button>
        </div>
      )}

      <PortfolioTab
        portfolio={portfolio}
        tier={tier}
        boundaryMode={boundaryMode}
        onPositionClick={() => { /* per-position stock detail page removed in 078B */ }}
        onGoToSettings={() => router.push("/dashboard/settings")}
      />
    </div>
  );
}
