"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export type PublicStrategyPreview = {
  id: string;
  name: string;
  version: number;
  ticker: string | null;
  description: string;
  win_rate: number | null;
  total_pnl_points: number | null;
  total_trades: number;
  backtest_count: number;
  paper_extracted: boolean;
};

// Sprint 103: free-user dashboard. This is a consumer landing — not an
// analytics view. The single question it should answer in five seconds:
// "what's a trustworthy strategy I could run today?"
//
// The same verdict rule lives in StrategiesClient (Sprint 102) — kept in
// sync by hand. If you change one, change both.
type Verdict = "trustworthy" | "healthy" | "needs-work" | "untested";

function computeVerdict(s: PublicStrategyPreview): Verdict {
  if (s.backtest_count === 0) return "untested";
  const pnl = s.total_pnl_points ?? 0;
  const trades = s.total_trades;
  if (pnl > 0 && trades >= 30 && s.backtest_count >= 3) return "trustworthy";
  if (pnl > 0 && trades >= 10) return "healthy";
  return "needs-work";
}

function verdictMeta(v: Verdict) {
  switch (v) {
    case "trustworthy":
      return { label: "Trustworthy", icon: "✓", bg: "var(--bull-bg)", color: "var(--bull)" };
    case "healthy":
      return { label: "Healthy", icon: "●", bg: "rgba(59,130,246,0.10)", color: "#3b82f6" };
    case "needs-work":
      return { label: "Needs work", icon: "!", bg: "rgba(239,68,68,0.10)", color: "var(--bear)" };
    case "untested":
      return { label: "Untested", icon: "○", bg: "var(--elevated)", color: "var(--ghost)" };
  }
}

export function FreeDashboard({ topPicks }: { topPicks: PublicStrategyPreview[] }) {
  return (
    <div className="flex flex-col gap-4 pb-6">
      <Welcome />
      <TopPicks topPicks={topPicks} />
      <HowItWorks />
    </div>
  );
}

function Welcome() {
  return (
    <div
      className="rounded-lg p-5"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <h1
        className="font-display font-bold mb-2"
        style={{ fontSize: 22, color: "var(--ink)" }}
      >
        Welcome to Atlas
      </h1>
      <p
        className="leading-relaxed"
        style={{ fontSize: 14, color: "var(--dim)", maxWidth: 640 }}
      >
        Atlas is a marketplace of <strong style={{ color: "var(--ink)" }}>verifiable trading strategies</strong>{" "}
        authored by Pro users from arXiv research and AI discussion. Every strategy carries a
        backtest record and a verdict. Pick one, connect a Base wallet, execute on-chain.
      </p>
    </div>
  );
}

function TopPicks({ topPicks }: { topPicks: PublicStrategyPreview[] }) {
  const router = useRouter();
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <span
          style={{
            color: "var(--ghost)",
            fontSize: 11,
            fontFamily: "var(--font-jb)",
            letterSpacing: "0.06em",
          }}
        >
          TOP STRATEGIES BY NET POINTS
        </span>
        <Link
          href="/dashboard/strategies?view=table"
          className="hover:underline"
          style={{
            color: "var(--brand)",
            fontSize: 11,
            fontFamily: "var(--font-jb)",
            letterSpacing: "0.04em",
            textDecoration: "underline",
          }}
        >
          See full leaderboard →
        </Link>
      </div>

      {topPicks.length === 0 ? (
        <div
          className="rounded-lg p-8 text-center"
          style={{
            background: "var(--surface)",
            border: "1px dashed var(--line)",
            color: "var(--ghost)",
            fontSize: 13,
          }}
        >
          No public strategies yet. Check back soon, or upgrade to Pro to author your own.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {topPicks.map((p) => (
            <PickRow
              key={p.id}
              pick={p}
              onClick={() => router.push(`/dashboard/strategies/${p.id}`)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PickRow({
  pick,
  onClick,
}: {
  pick: PublicStrategyPreview;
  onClick: () => void;
}) {
  const verdict = computeVerdict(pick);
  const m = verdictMeta(verdict);
  const winPct = pick.win_rate != null ? `${(pick.win_rate * 100).toFixed(0)}%` : "—";
  const winPos = pick.win_rate != null ? pick.win_rate >= 0.5 : null;
  const pnl = pick.total_pnl_points;
  const pnlStr = pnl != null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}` : "—";
  const pnlPos = pnl != null ? pnl >= 0 : null;

  return (
    <button
      onClick={onClick}
      className="rounded-lg text-left transition-colors"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        padding: "12px 16px",
        boxShadow: "var(--card-shadow)",
        cursor: "pointer",
        width: "100%",
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
          style={{
            background: m.bg,
            color: m.color,
            fontSize: 10,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          <span className="font-mono">{m.icon}</span>
          <span>{m.label}</span>
        </span>

        <div className="min-w-0" style={{ flex: 1 }}>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className="font-mono font-semibold"
              style={{ color: "var(--ink)", fontSize: 14 }}
            >
              {pick.name}
            </span>
            <span
              className="font-mono"
              style={{ color: "var(--ghost)", fontSize: 11 }}
            >
              v{pick.version}
            </span>
            {pick.ticker && (
              <span
                className="font-mono"
                style={{ color: "var(--dim)", fontSize: 11 }}
              >
                · {pick.ticker}
              </span>
            )}
            {pick.paper_extracted && (
              <span
                className="inline-flex items-center px-1.5 py-0 rounded uppercase"
                style={{
                  background: "var(--elevated)",
                  color: "var(--dim)",
                  fontSize: 9,
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                }}
              >
                arXiv
              </span>
            )}
          </div>
        </div>

        <PickStat label="WIN" value={winPct} positive={winPos} />
        <PickStat label="NET" value={pnlStr} positive={pnlPos} />
        <PickStat label="TRADES" value={String(pick.total_trades)} positive={null} />
      </div>
    </button>
  );
}

function PickStat({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive: boolean | null;
}) {
  const color =
    positive === true
      ? "var(--bull)"
      : positive === false
        ? "var(--bear)"
        : "var(--ink)";
  return (
    <div style={{ textAlign: "right", minWidth: 56 }}>
      <div
        style={{
          color: "var(--ghost)",
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        className="num font-display font-bold tabular-nums"
        style={{ fontSize: 14, color, fontFamily: "var(--font-mono)" }}
      >
        {value}
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "1",
      title: "Pick",
      body: "Browse the leaderboard for a strategy with a verdict you trust.",
    },
    {
      n: "2",
      title: "Connect",
      body: "Connect MetaMask or Coinbase Wallet on Base — no key handover.",
    },
    {
      n: "3",
      title: "Approve",
      body: "When the signal fires, approve the on-chain trade. Atlas signs nothing.",
    },
  ];
  return (
    <section>
      <div className="mb-3">
        <span
          style={{
            color: "var(--ghost)",
            fontSize: 11,
            fontFamily: "var(--font-jb)",
            letterSpacing: "0.06em",
          }}
        >
          HOW IT WORKS · 3 STEPS
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.n}
            className="rounded-lg"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              padding: "14px 16px",
              boxShadow: "var(--card-shadow)",
            }}
          >
            <div className="flex items-baseline gap-2 mb-1">
              <span
                className="font-mono font-bold"
                style={{ color: "var(--brand)", fontSize: 18 }}
              >
                {s.n}
              </span>
              <span
                className="font-display font-semibold"
                style={{ color: "var(--ink)", fontSize: 14 }}
              >
                {s.title}
              </span>
            </div>
            <p style={{ color: "var(--dim)", fontSize: 12, lineHeight: 1.55 }}>{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
