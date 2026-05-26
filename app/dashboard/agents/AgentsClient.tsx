"use client";

import { AgentTab } from "../AgentTab";
import { useAssetClass } from "../AssetClassProvider";
import type { Signal } from "../DashboardClient";

/**
 * Client-side switch for the Agents tab so the futures mode shows a
 * Phase 2 placeholder instead of equity signals filtered to zero.
 *
 * Once Phase 2 ships, the futures branch will render a futures-specific
 * agent log instead.
 */
export function AgentsClient({ signals }: { signals: Signal[] }) {
  const { assetClass } = useAssetClass();

  if (assetClass === "futures") {
    return <FuturesAgentsPlaceholder />;
  }

  return <AgentTab signals={signals} loading={false} />;
}

function FuturesAgentsPlaceholder() {
  return (
    <div className="flex flex-col gap-3 pb-6">
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: "28px 20px",
          textAlign: "center",
          boxShadow: "var(--card-shadow)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontFamily: "var(--font-jb)",
            letterSpacing: "0.1em",
            color: "var(--ghost)",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          Futures agents
        </div>
        <div
          className="font-display font-bold"
          style={{ fontSize: 18, color: "var(--ink)", marginBottom: 8 }}
        >
          MYM signals coming in Phase 2
        </div>
        <p
          style={{
            fontSize: 13,
            fontFamily: "var(--font-nunito)",
            color: "var(--dim)",
            maxWidth: 380,
            margin: "0 auto",
            lineHeight: 1.6,
          }}
        >
          The futures pipeline graph needs a macro analyst (FOMC, CPI, NFP) instead of
          the equity fundamental analyst. Wiring that, plus the paper simulator broker
          for MYM, is the next sprint.
        </p>
      </div>
    </div>
  );
}
