"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { PortfolioTab } from "../DashboardClient";
import type { Portfolio } from "../DashboardClient";

const API_URL = "/api";

export function PortfolioPageClient({
  tier,
  philosophy,
  boundaryMode,
  hasPendingConditional,
  pendingTicker,
}: {
  tier: "free" | "pro" | "max";
  philosophy: string;
  boundaryMode: string;
  hasPendingConditional: boolean;
  pendingTicker: string | null;
}) {
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);

  useEffect(() => {
    fetchWithAuth(`${API_URL}/v1/portfolio`)
      .then((r) => r?.json())
      .then((data) => { if (data) setPortfolio(data); })
      .catch(console.error);
  }, []);

  return (
    <div className="flex flex-col gap-3 pb-6">
      {hasPendingConditional && pendingTicker && (
        <div
          className="rounded-lg px-4 py-2.5 flex items-center justify-between"
          style={{ background: "var(--hold-bg)", border: "1px solid var(--hold)30" }}
        >
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--hold)", fontSize: 13, fontFamily: "var(--font-jb)" }}>!</span>
            <span style={{ color: "var(--hold)", fontSize: 12, fontFamily: "var(--font-nunito)" }}>
              {pendingTicker} signal awaiting your approval
            </span>
          </div>
          <button
            onClick={() => router.push("/dashboard/agents")}
            style={{
              color: "var(--hold)", fontSize: 11, fontFamily: "var(--font-jb)",
              background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline",
            }}
          >
            Review →
          </button>
        </div>
      )}

      <PortfolioTab
        portfolio={portfolio}
        tier={tier}
        philosophy={philosophy}
        boundaryMode={boundaryMode}
        onPositionClick={(ticker) => router.push(`/dashboard/stock/${ticker}`)}
        onGoToSettings={() => router.push("/dashboard/settings")}
      />
    </div>
  );
}
