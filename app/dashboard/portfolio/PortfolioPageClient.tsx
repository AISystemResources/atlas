"use client";

import { useState, useEffect } from "react";
import { PortfolioTab } from "../DashboardClient";
import { FreeDashboard, type PublicStrategyPreview } from "./FreeDashboard";
import type { StrategyHealth } from "./page";

const API_URL = "/api";

type Props =
  | {
      tier: "free";
      topPicks: PublicStrategyPreview[];
    }
  | {
      tier: "pro";
      strategies: StrategyHealth[];
    };

export function PortfolioPageClient(props: Props) {
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

  return (
    <div className="flex flex-col gap-3 pb-6">
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

      {props.tier === "free" ? (
        <FreeDashboard topPicks={props.topPicks} />
      ) : (
        <PortfolioTab
          tier={props.tier}
          strategies={props.strategies}
        />
      )}
    </div>
  );
}
