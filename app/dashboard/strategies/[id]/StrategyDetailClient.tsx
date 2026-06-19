"use client";

/**
 * Strategy detail — Sprint 061C.
 *
 * Sections:
 *   - Header with name, version, lineage, visibility chip, action buttons
 *   - Description (AI-authored eventually)
 *   - Structured rule blocks: 📍 SIGNAL BAR / 🎯 ENTRY / 🛑 STOP LOSS /
 *     💰 TAKE PROFIT / ⏰ TIME STOP
 *   - Indicators list
 *   - Tunable parameters table
 *   - Recent backtests (links to backtest detail)
 *   - Version navigator chevrons
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RenderedSections } from "@/lib/strategies/render-rules";
import type { TunableParameter } from "@/lib/strategies/types";

export interface VersionFamilyEntry {
  id: string;
  version: number;
  status: string;
  created_at: string;
  is_current: boolean;
}

export interface BacktestListEntry {
  id: string;
  ticker: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_trades: number;
  win_rate: number | null;
  total_pnl_dollars: number | null;
  created_at: string;
}

export interface StrategyDetail {
  id: string;
  name: string;
  version: number;
  description: string;
  status: "draft" | "active" | "archived";
  visibility: "private" | "unlisted" | "public";
  is_mine: boolean;
  owner_label: string;
  forked_from_id: string | null;
  forked_from_label: string | null;
  parent_version_id: string | null;
  is_my_scalper: boolean;
  created_at: string;
  rendered: RenderedSections;
  tunable_parameters: TunableParameter[];
  timeframe: string;
  direction: string;
}

export function StrategyDetailClient({
  detail,
  family,
  backtests,
}: {
  detail: StrategyDetail;
  family: VersionFamilyEntry[];
  backtests: BacktestListEntry[];
}) {
  const router = useRouter();
  const [forkBusy, setForkBusy] = useState(false);
  const [scalperBusy, setScalperBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const myIdx = family.findIndex((f) => f.is_current);
  const prev = myIdx > 0 ? family[myIdx - 1] : null;
  const next = myIdx >= 0 && myIdx < family.length - 1 ? family[myIdx + 1] : null;

  async function onFork() {
    setForkBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/v1/ticket-logics/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_logic_id: detail.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.push(`/dashboard/strategies/${body.id}`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
      setForkBusy(false);
    }
  }

  async function onUseAsScalper() {
    setScalperBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/v1/user/scalper-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: detail.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.refresh();
      setActionMsg("This strategy is now driving your scalper.");
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setScalperBusy(false);
    }
  }

  return (
    <div className="mx-auto p-6" style={{ maxWidth: 1100, color: "var(--ink)" }}>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href="/dashboard/strategies"
          className="text-xs"
          style={{ color: "var(--ghost)" }}
        >
          ← All strategies
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-2xl font-mono font-bold">{detail.name}</h1>
            <VersionNav
              prev={prev}
              next={next}
              current={detail.version}
              strategyName={detail.name}
            />
            {detail.is_my_scalper && (
              <span
                className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded uppercase"
                style={{ background: "var(--bull-bg)", color: "var(--bull)" }}
              >
                My scalper
              </span>
            )}
            <VisibilityChip vis={detail.visibility} />
            <StatusChip status={detail.status} />
          </div>
          <p className="text-xs" style={{ color: "var(--ghost)" }}>
            by {detail.owner_label}
            {detail.forked_from_label && <> · forked from {detail.forked_from_label}</>}
            {detail.parent_version_id && <> · promoted from earlier version</>}
            <> · {detail.timeframe} · {detail.direction}-only</>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!detail.is_mine && detail.visibility !== "private" && (
            <button
              onClick={onFork}
              disabled={forkBusy}
              className="px-3 py-1.5 text-sm font-medium rounded disabled:opacity-50"
              style={{ background: "var(--brand)", color: "#fff" }}
            >
              {forkBusy ? "Forking…" : "Fork to my library"}
            </button>
          )}
          {detail.is_mine && !detail.is_my_scalper && (
            <button
              onClick={onUseAsScalper}
              disabled={scalperBusy}
              className="px-3 py-1.5 text-sm font-medium rounded disabled:opacity-50"
              style={{ background: "var(--bull)", color: "#fff" }}
            >
              {scalperBusy ? "Setting…" : "Use as my scalper"}
            </button>
          )}
        </div>
      </div>

      {actionMsg && (
        <p
          className="text-xs mb-3"
          style={{ color: "var(--bull)" }}
        >
          {actionMsg}
        </p>
      )}

      {/* Description */}
      {detail.description && (
        <p
          className="text-sm leading-relaxed mb-6"
          style={{ color: "var(--dim)" }}
        >
          {detail.description}
        </p>
      )}

      {/* Structured rule blocks */}
      <div className="space-y-3 mb-8">
        <RuleBlock
          icon="📍"
          title="Signal Bar — what qualifies"
          lines={detail.rendered.signalBar}
          accent="var(--brand)"
        />
        <RuleBlock
          icon="🎯"
          title="Entry — when and at what price"
          lines={detail.rendered.entry}
          accent="var(--brand)"
        />
        <RuleBlock
          icon="🛑"
          title="Stop Loss"
          lines={[detail.rendered.stopLoss]}
          accent="var(--bear)"
        />
        <RuleBlock
          icon="💰"
          title="Take Profit (Limit Order)"
          lines={[detail.rendered.takeProfit]}
          accent="var(--bull)"
        />
        {detail.rendered.timeStop && (
          <RuleBlock
            icon="⏰"
            title="Time Stop"
            lines={[detail.rendered.timeStop]}
            accent="var(--hold)"
          />
        )}
      </div>

      {/* Indicators */}
      <Section title="Indicators used">
        <div className="flex flex-wrap gap-2">
          {detail.rendered.indicators.map((ind) => (
            <span
              key={ind.id}
              className="inline-flex items-center px-2 py-1 text-xs rounded border"
              style={{
                background: "var(--elevated)",
                borderColor: "var(--line)",
                color: "var(--dim)",
              }}
            >
              <span
                className="font-mono mr-1.5"
                style={{ color: "var(--ghost)" }}
              >
                {ind.id}
              </span>
              {ind.label}
            </span>
          ))}
        </div>
      </Section>

      {/* Tunables */}
      {detail.tunable_parameters.length > 0 && (
        <Section title="Tunable parameters">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left text-xs uppercase border-b"
                style={{ color: "var(--ghost)", borderColor: "var(--line)" }}
              >
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">Range</th>
                <th className="py-2 pr-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {detail.tunable_parameters.map((t) => (
                <tr
                  key={t.name}
                  className="border-b"
                  style={{ borderColor: "var(--line)" }}
                >
                  <td className="py-2 pr-2 font-mono text-xs">{t.name}</td>
                  <td className="py-2 pr-2 text-xs" style={{ color: "var(--dim)" }}>
                    {t.min ?? "—"} … {t.max ?? "—"}
                  </td>
                  <td className="py-2 pr-2 text-xs" style={{ color: "var(--dim)" }}>
                    {t.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Backtests */}
      <Section title={`Recent backtests (${backtests.length})`}>
        {backtests.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--ghost)" }}>
            No backtests of this version yet.{" "}
            <Link
              href="/dashboard/backtests"
              className="underline"
              style={{ color: "var(--brand)" }}
            >
              Run one →
            </Link>
          </p>
        ) : (
          <div className="space-y-1">
            {backtests.map((b) => {
              const pnl = b.total_pnl_dollars ?? 0;
              return (
                <Link
                  key={b.id}
                  href={`/dashboard/backtests/${b.id}`}
                  className="flex items-center justify-between p-2.5 rounded hover:bg-[var(--elevated)] text-xs"
                  style={{ color: "var(--dim)" }}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono" style={{ color: "var(--ink)" }}>
                      {b.ticker}
                    </span>
                    <span>{b.timeframe}</span>
                    <span>
                      {b.start_date} → {b.end_date}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span>{b.total_trades} trades</span>
                    {b.win_rate != null && (
                      <span>{(b.win_rate * 100).toFixed(1)}%</span>
                    )}
                    <span
                      className="font-mono"
                      style={{
                        color:
                          pnl > 0
                            ? "var(--bull)"
                            : pnl < 0
                              ? "var(--bear)"
                              : "var(--dim)",
                      }}
                    >
                      ${pnl.toFixed(2)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Small primitives ─────────────────────────────────────────────────────────

function RuleBlock({
  icon,
  title,
  lines,
  accent,
}: {
  icon: string;
  title: string;
  lines: string[];
  accent: string;
}) {
  return (
    <div
      className="p-4 rounded-lg border"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line)",
        borderLeftWidth: 3,
        borderLeftColor: accent,
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <h3
          className="text-xs uppercase tracking-wide font-semibold"
          style={{ color: accent }}
        >
          {title}
        </h3>
      </div>
      <ul className="space-y-1">
        {lines.map((l, i) => (
          <li
            key={i}
            className="text-sm leading-relaxed"
            style={{ color: "var(--ink)" }}
          >
            <span style={{ color: "var(--ghost)" }}>•</span> {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3
        className="text-xs uppercase tracking-wide font-semibold mb-3"
        style={{ color: "var(--ghost)" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function VersionNav({
  prev,
  next,
  current,
  strategyName,
}: {
  prev: VersionFamilyEntry | null;
  next: VersionFamilyEntry | null;
  current: number;
  strategyName: string;
}) {
  return (
    <div className="flex items-center gap-1 text-xs font-mono">
      {prev ? (
        <Link
          href={`/dashboard/strategies/${prev.id}`}
          className="px-1.5 py-0.5 rounded hover:bg-[var(--elevated)]"
          style={{ color: "var(--dim)" }}
          title={`${strategyName} v${prev.version}`}
        >
          ◀ v{prev.version}
        </Link>
      ) : (
        <span className="px-1.5 py-0.5" style={{ color: "var(--ghost)", opacity: 0.4 }}>
          ◀
        </span>
      )}
      <span
        className="px-1.5 py-0.5 font-semibold"
        style={{ color: "var(--ink)" }}
      >
        v{current}
      </span>
      {next ? (
        <Link
          href={`/dashboard/strategies/${next.id}`}
          className="px-1.5 py-0.5 rounded hover:bg-[var(--elevated)]"
          style={{ color: "var(--dim)" }}
          title={`${strategyName} v${next.version}`}
        >
          v{next.version} ▶
        </Link>
      ) : (
        <span className="px-1.5 py-0.5" style={{ color: "var(--ghost)", opacity: 0.4 }}>
          ▶
        </span>
      )}
    </div>
  );
}

function VisibilityChip({ vis }: { vis: "private" | "unlisted" | "public" }) {
  const styles: Record<typeof vis, { bg: string; color: string; label: string }> = {
    private: { bg: "var(--elevated)", color: "var(--dim)", label: "Private" },
    unlisted: { bg: "var(--hold-bg)", color: "var(--hold)", label: "Unlisted" },
    public: { bg: "var(--bull-bg)", color: "var(--bull)", label: "Public" },
  };
  const s = styles[vis];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded uppercase"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function StatusChip({ status }: { status: "draft" | "active" | "archived" }) {
  if (status === "active") return null; // baseline, no chip
  const styles: Record<"draft" | "archived", { bg: string; color: string }> = {
    draft: { bg: "var(--hold-bg)", color: "var(--hold)" },
    archived: { bg: "var(--elevated)", color: "var(--dim)" },
  };
  const s = styles[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded uppercase"
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  );
}
