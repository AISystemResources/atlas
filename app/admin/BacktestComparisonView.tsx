"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";

const API = "";

// ── Types ─────────────────────────────────────────────────────────────────────

type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type ExperimentType = "philosophy" | "threshold" | "mode" | "single" | "multi";

type BacktestJob = {
  id: string;
  status: JobStatus;
  tickers: string[];
  start_date: string;
  end_date: string;
  ebc_mode: string;
  philosophy_mode?: string | null;
  confidence_threshold?: number | null;
  experiment_id?: string | null;
  progress: number;
  total_return: number | null;
  sharpe_ratio: number | null;
  max_drawdown: number | null;
  win_rate: number | null;
  total_trades: number | null;
  signal_to_execution_rate: number | null;
  directional_accuracy?: number | null;
  created_at: string;
  completed_at: string | null;
  error_message?: string | null;
  results?: BacktestResults;
};

type BacktestResults = {
  daily_runs: DailyRun[];
  equity_curve: { date: string; value: number; cash?: number }[];
  metrics: Record<string, unknown>;
};

type DailyRun = {
  date: string;
  ticker: string;
  action: string;
  confidence: number | null;
  reasoning?: string;
  executed: boolean;
  simulated_price: number | null;
  pnl: number | null;
  skipped_reason: string | null;
  trace_id: string | null;
  error?: string;
};

// Experiment from backend API
type BackendExperiment = {
  id: string;
  name: string;
  experiment_type: ExperimentType;
  tickers: string[];
  start_date: string;
  end_date: string;
  ebc_mode: string;
  created_at: string;
  jobs: BacktestJob[];
};

// Client-side experiment (for orphan jobs or as display wrapper)
type Experiment = {
  id: string;
  type: ExperimentType;
  label: string;
  jobs: BacktestJob[];
  createdAt: Date;
  isBackendBacked: boolean;   // true = came from /v1/experiments
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PHILOSOPHIES = ["lynch", "soros", "buffett", "balanced"] as const;
const THRESHOLDS   = [0.50, 0.65, 0.80, 0.95] as const;
const EBC_MODES    = ["advisory", "autonomous"] as const;

const DEFAULT_START   = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
const DEFAULT_END     = new Date(Date.now() - 3  * 86400000).toISOString().slice(0, 10);
const DEFAULT_TICKERS = "AAPL, MSFT, TSLA, NVDA, META";

const STALE_MS = 24 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined, dec = 2) =>
  n == null || isNaN(n as number) ? "—" : (n as number).toFixed(dec);

const pct = (n: number | null | undefined) =>
  n == null || isNaN(n as number) ? "—" : `${((n as number) * 100).toFixed(2)}%`;

const conf = (n: number | null | undefined) =>
  n == null || isNaN(n as number) ? "—" : `${Math.round((n as number) * 100)}%`;

const statusColor: Record<JobStatus, string> = {
  queued:    "var(--dim)",
  running:   "var(--hold)",
  completed: "var(--bull)",
  failed:    "var(--bear)",
  cancelled: "var(--dim)",
};

const modeColor: Record<string, string> = {
  advisory:             "var(--dim)",
  conditional:          "var(--hold)",
  autonomous_guardrail: "var(--brand)",
  autonomous:           "var(--bull)",
};

const philosophyColors: Record<string, string> = {
  lynch:    "#6366f1",
  soros:    "#f59e0b",
  buffett:  "#10b981",
  balanced: "var(--brand)",
};

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function tradingDayEst(start: string, end: string) {
  if (!start || !end) return 0;
  let days = 0;
  const cur = new Date(start);
  const e = new Date(end);
  while (cur <= e) { if (cur.getDay() !== 0 && cur.getDay() !== 6) days++; cur.setDate(cur.getDate() + 1); }
  return days;
}

// ── Orphan-job grouping (for jobs without experiment_id) ──────────────────────

function groupOrphanJobs(jobs: BacktestJob[]): Experiment[] {
  const sorted = [...jobs].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const byBase = new Map<string, BacktestJob[]>();
  for (const job of sorted) {
    const key = [...job.tickers].sort().join(",") + "|" + job.start_date + "|" + job.end_date;
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key)!.push(job);
  }

  const experiments: Experiment[] = [];
  let idx = 0;

  for (const baseJobs of byBase.values()) {
    const timeGroups: BacktestJob[][] = [];
    let cur: BacktestJob[] = [];
    for (const job of baseJobs) {
      if (cur.length === 0) {
        cur.push(job);
      } else {
        const gap = new Date(job.created_at).getTime() - new Date(cur[cur.length - 1].created_at).getTime();
        if (gap < 15 * 60 * 1000) { cur.push(job); } else { timeGroups.push(cur); cur = [job]; }
      }
    }
    if (cur.length > 0) timeGroups.push(cur);

    for (const tg of timeGroups) {
      const createdAt = new Date(Math.max(...tg.map((j) => new Date(j.created_at).getTime())));
      experiments.push({
        id: `orphan-${idx++}`,
        type: "multi",
        label: "Unknown",
        jobs: tg,
        createdAt,
        isBackendBacked: false,
      });
    }
  }

  return experiments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function backendToExperiment(be: BackendExperiment): Experiment {
  return {
    id: be.id,
    type: be.experiment_type,
    label: be.name,
    jobs: be.jobs,
    createdAt: new Date(be.created_at),
    isBackendBacked: true,
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const COMP_STYLES = `
@keyframes bcv-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes bcv-pulse-ring {
  0%   { opacity: 0.7; transform: scale(1); }
  70%  { opacity: 0;   transform: scale(2.2); }
  100% { opacity: 0;   transform: scale(2.2); }
}
@keyframes bcv-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.bcv-fade-in { animation: bcv-fade-in 0.25s ease both; }
.bcv-shimmer-bar {
  background: linear-gradient(90deg, var(--hold) 0%, #f5c542 40%, var(--hold) 100%);
  background-size: 200% 100%;
  animation: bcv-shimmer 1.8s linear infinite;
}
.bcv-job-card { transition: box-shadow 0.15s, border-color 0.15s; cursor: pointer; }
.bcv-job-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.08); border-color: var(--brand) !important; }
`;

function StyleInjector() {
  const ref = useRef(false);
  useEffect(() => {
    if (ref.current) return; ref.current = true;
    const el = document.createElement("style");
    el.textContent = COMP_STYLES;
    document.head.appendChild(el);
  }, []);
  return null;
}

// ── Atoms ─────────────────────────────────────────────────────────────────────

function PulsingDot({ color = "var(--hold)" }: { color?: string }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 10, height: 10 }}>
      <span style={{ position: "absolute", width: 10, height: 10, borderRadius: "50%", background: color, opacity: 0.4, animation: "bcv-pulse-ring 1.4s ease-out infinite" }} />
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, position: "relative" }} />
    </span>
  );
}

function ProgressBar({ progress, running }: { progress: number; running: boolean }) {
  return (
    <div style={{ background: "var(--elevated)", borderRadius: 4, height: 4, overflow: "hidden" }}>
      <div
        className={running ? "bcv-shimmer-bar" : ""}
        style={{ width: `${progress}%`, height: "100%", borderRadius: 4, background: running ? undefined : "var(--bull)", transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }}
      />
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const [color, bg] =
    action === "BUY"   ? ["var(--bull)", "var(--bull-bg)"] :
    action === "SELL"  ? ["var(--bear)", "var(--bear-bg)"] :
    action === "ERROR" ? ["var(--bear)", "var(--bear-bg)"] :
    ["var(--hold)", "var(--hold-bg)"];
  return (
    <span style={{ fontFamily: "var(--font-jb)", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, color, background: bg, flexShrink: 0 }}>
      {action}
    </span>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span style={{
      fontSize: 9, fontFamily: "var(--font-jb)", color: statusColor[status],
      padding: "1px 6px", borderRadius: 3,
      background: `${statusColor[status]}15`,
      border: `1px solid ${statusColor[status]}30`,
    }}>
      {status}
    </span>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontFamily: "var(--font-jb)", color, background: `${color}18`, padding: "2px 8px", borderRadius: 4, border: `1px solid ${color}30` }}>
      {label}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--surface)",
  color: "var(--ink)", fontFamily: "var(--font-nunito)", fontSize: 13,
  boxSizing: "border-box",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--ghost)", marginBottom: 6 }}>
        {label}{hint && <span style={{ marginLeft: 8, opacity: 0.6 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Job label / color within an experiment ────────────────────────────────────

function jobLabel(job: BacktestJob, expType: ExperimentType): string {
  if (expType === "philosophy" && job.philosophy_mode) {
    return job.philosophy_mode.charAt(0).toUpperCase() + job.philosophy_mode.slice(1);
  }
  if (expType === "threshold" && job.confidence_threshold != null) {
    return `${(job.confidence_threshold * 100).toFixed(0)}% threshold`;
  }
  if (expType === "mode") return job.ebc_mode;
  // For multi/unknown: show philosophy + threshold if available
  const parts: string[] = [];
  if (job.philosophy_mode) parts.push(job.philosophy_mode.charAt(0).toUpperCase() + job.philosophy_mode.slice(1));
  if (job.confidence_threshold != null) parts.push(`${(job.confidence_threshold * 100).toFixed(0)}%`);
  return parts.length > 0 ? parts.join(" · ") : job.tickers.join(", ");
}

function jobAccentColor(job: BacktestJob, expType: ExperimentType): string {
  if (expType === "philosophy" && job.philosophy_mode) {
    return philosophyColors[job.philosophy_mode] ?? "var(--brand)";
  }
  return modeColor[job.ebc_mode] ?? "var(--brand)";
}

// ── Daily logs panel ──────────────────────────────────────────────────────────

function JobLogsPanel({ job, onClose }: { job: BacktestJob; onClose: () => void }) {
  const [fullJob, setFullJob] = useState<BacktestJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  useEffect(() => {
    fetchWithAuth(`${API}/v1/backtest/${job.id}`)
      .then(async (res) => { if (res?.ok) setFullJob(await res.json()); })
      .finally(() => setLoading(false));
  }, [job.id]);

  const runs = fullJob?.results?.daily_runs ?? [];
  const errorCount    = runs.filter((r) => r.action === "ERROR").length;
  const executedCount = runs.filter((r) => r.executed).length;

  function exportCSV() {
    const header = "date,ticker,action,confidence,executed,price,pnl,reason\n";
    const rows = runs.map((r) =>
      [r.date, r.ticker, r.action, r.confidence ?? "", r.executed, r.simulated_price ?? "", r.pnl ?? "",
       `"${(r.skipped_reason ?? r.reasoning ?? "").replace(/"/g, "'")}"`].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `backtest-${job.id.slice(0, 8)}-runs.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bcv-fade-in" style={{ background: "var(--deep)", border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "var(--font-jb)", fontSize: 11, color: "var(--ghost)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>
            Daily Runs — {job.id.slice(0, 8)}
          </div>
          {!loading && runs.length > 0 && (
            <div style={{ display: "flex", gap: 12, fontSize: 11, fontFamily: "var(--font-nunito)", color: "var(--dim)" }}>
              <span><span style={{ fontFamily: "var(--font-jb)", fontWeight: 700, color: "var(--bull)" }}>{executedCount}</span> executed</span>
              {errorCount > 0 && <span><span style={{ fontFamily: "var(--font-jb)", fontWeight: 700, color: "var(--bear)" }}>{errorCount}</span> errors</span>}
              <span>{runs.length} total signals</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {runs.length > 0 && (
            <button onClick={exportCSV} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 5, padding: "4px 10px", color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", cursor: "pointer" }}>
              ↓ CSV
            </button>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ghost)", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
      </div>

      {loading && <div style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-jb)", textAlign: "center", padding: "16px 0" }}>Loading…</div>}
      {!loading && runs.length === 0 && (
        <div style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-nunito)", textAlign: "center", padding: "16px 0" }}>No daily runs recorded yet.</div>
      )}

      {!loading && runs.length > 0 && (
        <div style={{ maxHeight: 360, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "var(--font-jb)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--deep)" }}>
                {["Date", "Ticker", "Action", "Conf.", "Executed", "Price", "PnL", ""].map((h) => (
                  <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "var(--ghost)", fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((dr, i) => (
                <React.Fragment key={i}>
                  <tr
                    onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                    style={{ borderBottom: expandedRow === i ? "none" : "1px solid var(--line)", opacity: dr.action === "ERROR" ? 0.5 : dr.executed ? 1 : 0.65, cursor: "pointer" }}
                  >
                    <td style={{ padding: "7px 10px", color: "var(--dim)", whiteSpace: "nowrap" }}>{dr.date}</td>
                    <td style={{ padding: "7px 10px", color: "var(--ink)", fontWeight: 700 }}>{dr.ticker}</td>
                    <td style={{ padding: "7px 10px" }}><ActionBadge action={dr.action} /></td>
                    <td style={{ padding: "7px 10px", color: "var(--dim)" }}>{conf(dr.confidence)}</td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ color: dr.executed ? "var(--bull)" : "var(--ghost)", fontSize: 11 }}>{dr.executed ? "✓ exec" : "—"}</span>
                    </td>
                    <td style={{ padding: "7px 10px", color: "var(--dim)" }}>
                      {dr.simulated_price != null ? `$${dr.simulated_price.toFixed(2)}` : "—"}
                    </td>
                    <td style={{ padding: "7px 10px", color: dr.pnl == null ? "var(--ghost)" : dr.pnl >= 0 ? "var(--bull)" : "var(--bear)" }}>
                      {dr.pnl == null ? "—" : `${dr.pnl >= 0 ? "+" : ""}$${dr.pnl.toFixed(2)}`}
                    </td>
                    <td style={{ padding: "7px 10px", color: "var(--ghost)", fontSize: 9 }}>{dr.reasoning || dr.skipped_reason ? "▸" : ""}</td>
                  </tr>
                  {expandedRow === i && (dr.reasoning || dr.skipped_reason || dr.error) && (
                    <tr style={{ borderBottom: "1px solid var(--line)", background: "var(--elevated)" }}>
                      <td colSpan={8} style={{ padding: "8px 10px 10px 38px" }}>
                        {dr.error && <div style={{ color: "var(--bear)", fontSize: 11, fontFamily: "var(--font-nunito)", marginBottom: dr.reasoning ? 6 : 0 }}>Error: {dr.error}</div>}
                        {dr.skipped_reason && !dr.executed && <div style={{ color: "var(--dim)", fontSize: 11, fontFamily: "var(--font-nunito)", marginBottom: dr.reasoning ? 6 : 0 }}>Skipped: {dr.skipped_reason}</div>}
                        {dr.reasoning && <div style={{ color: "var(--dim)", fontSize: 11, fontFamily: "var(--font-nunito)", lineHeight: 1.5 }}>{dr.reasoning}</div>}
                        {dr.trace_id && <div style={{ marginTop: 6, fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}>trace {dr.trace_id.slice(0, 16)}…</div>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Job card ──────────────────────────────────────────────────────────────────

function JobCard({ job, expType, onCancel, onResume }: {
  job: BacktestJob;
  expType: ExperimentType;
  onCancel: () => void;
  onResume: () => void;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const isActive = job.status === "running" || job.status === "queued";
  // eslint-disable-next-line react-hooks/purity
  const isStale  = isActive && (Date.now() - new Date(job.created_at).getTime()) > STALE_MS;
  const accent   = jobAccentColor(job, expType);
  const label    = jobLabel(job, expType);

  return (
    <div>
      <div
        className="bcv-job-card"
        onClick={() => setShowLogs((v) => !v)}
        style={{
          background: "var(--surface)",
          borderTop:    `1px solid ${showLogs ? "var(--brand)50" : isActive ? "var(--hold)40" : "var(--line)"}`,
          borderRight:  `1px solid ${showLogs ? "var(--brand)50" : isActive ? "var(--hold)40" : "var(--line)"}`,
          borderBottom: `1px solid ${showLogs ? "var(--brand)50" : isActive ? "var(--hold)40" : "var(--line)"}`,
          borderLeft:   `3px solid ${accent}`,
          borderRadius: 8,
          padding: "12px 14px",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontFamily: "var(--font-jb)", fontWeight: 700, fontSize: 12, color: accent }}>{label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isActive && <PulsingDot />}
            <StatusBadge status={isStale ? "failed" : job.status} />
            {isStale && <span style={{ fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--bear)" }}>stale</span>}
          </div>
        </div>

        {isActive && (
          <div>
            <ProgressBar progress={job.progress} running={job.status === "running"} />
            <div style={{ marginTop: 4, fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)" }}>
              {job.progress}% — {job.status}
            </div>
          </div>
        )}

        {job.status === "completed" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 4 }}>
            {[
              { k: "RETURN", v: pct(job.total_return), pos: (job.total_return ?? 0) >= 0 },
              { k: "SHARPE", v: fmt(job.sharpe_ratio), pos: (job.sharpe_ratio ?? 0) >= 1 },
              { k: "MAX DD", v: pct(job.max_drawdown), pos: false },
            ].map((m) => (
              <div key={m.k} style={{ textAlign: "center" }}>
                <div style={{ color: "var(--ghost)", fontSize: 8, fontFamily: "var(--font-jb)", marginBottom: 1 }}>{m.k}</div>
                <div style={{ fontSize: 12, fontFamily: "var(--font-jb)", fontWeight: 700, color: m.k === "MAX DD" ? "var(--bear)" : m.pos ? "var(--bull)" : "var(--bear)" }}>
                  {m.v}
                </div>
              </div>
            ))}
          </div>
        )}

        {job.status === "failed" && (
          <div style={{ fontSize: 10, color: "var(--bear)", fontFamily: "var(--font-nunito)", marginTop: 4 }}>
            {job.error_message ?? "Pipeline failed"}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {(isActive || isStale) && (
            <button onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ fontSize: 10, fontFamily: "var(--font-jb)", background: "none", border: "1px solid var(--bear)40", color: "var(--bear)", padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}>
              cancel
            </button>
          )}
          {(job.status === "failed" || job.status === "cancelled") && (
            <button onClick={(e) => { e.stopPropagation(); onResume(); }} style={{ fontSize: 10, fontFamily: "var(--font-jb)", background: "none", border: "1px solid var(--brand)40", color: "var(--brand)", padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}>
              resume
            </button>
          )}
          {!isActive && (
            <span style={{ fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)", marginLeft: "auto", opacity: 0.6 }}>
              {showLogs ? "hide logs ▴" : "view logs ▾"}
            </span>
          )}
          {isActive && (
            <span style={{ fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)", marginLeft: "auto", opacity: 0.6 }}>
              {showLogs ? "hide ▴" : "view partial ▾"}
            </span>
          )}
        </div>
      </div>

      {showLogs && <JobLogsPanel job={job} onClose={() => setShowLogs(false)} />}
    </div>
  );
}

// ── Comparison table ───────────────────────────────────────────────────────────

function ComparisonTable({ experiment }: { experiment: Experiment }) {
  const completed = experiment.jobs.filter((j) => j.status === "completed");
  if (completed.length < 2) return null;

  const sorted  = [...completed].sort((a, b) => (b.sharpe_ratio ?? -Infinity) - (a.sharpe_ratio ?? -Infinity));
  const bestId  = sorted[0]?.id;
  const worstId = sorted[sorted.length - 1]?.id;

  function exportCSV() {
    const header = "label,total_return,sharpe,max_drawdown,win_rate,trades,sig_exec\n";
    const rows = sorted.map((j) =>
      [jobLabel(j, experiment.type), j.total_return ?? "", j.sharpe_ratio ?? "", j.max_drawdown ?? "", j.win_rate ?? "", j.total_trades ?? "", j.signal_to_execution_rate ?? ""].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url;
    a.download = `experiment-comparison-${experiment.jobs[0].start_date}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--ghost)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Comparison — ranked by Sharpe ↓
        </span>
        <button onClick={exportCSV} style={{ fontSize: 10, fontFamily: "var(--font-jb)", background: "none", border: "1px solid var(--line)", color: "var(--ghost)", padding: "3px 10px", borderRadius: 4, cursor: "pointer" }}>
          ↓ Export CSV
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "var(--font-jb)" }}>
          <thead>
            <tr style={{ background: "var(--elevated)", borderBottom: "1px solid var(--line)" }}>
              {[experiment.type === "philosophy" ? "Philosophy" : experiment.type === "threshold" ? "Threshold" : "Variant",
                "Cum. Return", "Sharpe", "Max Drawdown", "Win Rate", "Trades", "Signal→Exec"].map((h) => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "var(--ghost)", fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((job) => {
              const isBest  = job.id === bestId;
              const isWorst = job.id === worstId && sorted.length > 1;
              const accent  = jobAccentColor(job, experiment.type);
              const rowBg   = isBest ? "color-mix(in srgb, var(--bull) 6%, transparent)" :
                              isWorst ? "color-mix(in srgb, var(--bear) 6%, transparent)" : "transparent";
              return (
                <tr key={job.id} style={{ borderBottom: "1px solid var(--line)", background: rowBg }}>
                  <td style={{ padding: "9px 12px", fontWeight: 700, whiteSpace: "nowrap", borderLeft: `3px solid ${accent}` }}>
                    {isBest  && <span style={{ color: "var(--bull)", marginRight: 5, fontSize: 9 }}>▲</span>}
                    {isWorst && <span style={{ color: "var(--bear)", marginRight: 5, fontSize: 9 }}>▼</span>}
                    <span style={{ color: accent }}>{jobLabel(job, experiment.type)}</span>
                  </td>
                  <td style={{ padding: "9px 12px", color: (job.total_return ?? 0) >= 0 ? "var(--bull)" : "var(--bear)" }}>{pct(job.total_return)}</td>
                  <td style={{ padding: "9px 12px", color: (job.sharpe_ratio ?? 0) >= 1 ? "var(--bull)" : "var(--dim)" }}>{fmt(job.sharpe_ratio)}</td>
                  <td style={{ padding: "9px 12px", color: "var(--bear)" }}>{pct(job.max_drawdown)}</td>
                  <td style={{ padding: "9px 12px", color: "var(--dim)" }}>{pct(job.win_rate)}</td>
                  <td style={{ padding: "9px 12px", color: "var(--dim)" }}>{job.total_trades ?? "—"}</td>
                  <td style={{ padding: "9px 12px", color: "var(--dim)" }}>{pct(job.signal_to_execution_rate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Experiment card (expandable accordion) ────────────────────────────────────

function ExperimentCard({ experiment, defaultOpen, onJobsChanged }: {
  experiment: Experiment;
  defaultOpen?: boolean;
  onJobsChanged: () => void;
}) {
  const router = useRouter();

  const activeCount    = experiment.jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const completedCount = experiment.jobs.filter((j) => j.status === "completed").length;
  const errorCount     = experiment.jobs.filter((j) => j.status === "failed" || j.status === "cancelled").length;
  const allDone        = experiment.jobs.every((j) => ["completed", "failed", "cancelled"].includes(j.status));
  const hasStale       = experiment.jobs.some(
    // eslint-disable-next-line react-hooks/purity
    (j) => (j.status === "running" || j.status === "queued") && Date.now() - new Date(j.created_at).getTime() > STALE_MS
  );

  // Must be declared before any early return to satisfy rules of hooks
  const [adopting, setAdopting] = useState(false);

  const typeColor: Record<ExperimentType, string> = {
    philosophy: philosophyColors.lynch,
    threshold:  "#f59e0b",
    mode:       "var(--brand)",
    single:     "var(--dim)",
    multi:      "var(--dim)",
  };
  const accent = typeColor[experiment.type];

  // Backend-backed experiments navigate to their own detail page
  if (experiment.isBackendBacked) {
    return (
      <div
        onClick={() => router.push(`/admin/experiments/${experiment.id}`)}
        style={{
          background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10,
          overflow: "hidden", cursor: "pointer", transition: "border-color 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--brand)40"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.07)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--line)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px" }}>
          <div style={{ width: 3, height: 36, borderRadius: 2, background: accent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ fontFamily: "var(--font-jb)", fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{experiment.label}</span>
              <Pill label={`${experiment.jobs.length} runs`} color={accent} />
              {activeCount > 0 && <PulsingDot color="var(--hold)" />}
              {allDone && completedCount > 0 && <Pill label="complete" color="var(--bull)" />}
              {hasStale && <Pill label="stale" color="var(--bear)" />}
            </div>
            <div style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--ghost)" }}>
              {experiment.jobs[0]?.tickers.join(" · ")} · {experiment.jobs[0]?.start_date} → {experiment.jobs[0]?.end_date} · {relTime(experiment.createdAt.toISOString())}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {completedCount > 0 && <span style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--bull)" }}>{completedCount} done</span>}
            {errorCount > 0 && <span style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--bear)" }}>{errorCount} failed</span>}
            {activeCount > 0 && <span style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--hold)" }}>{activeCount} running</span>}
            <span style={{ fontFamily: "var(--font-jb)", fontSize: 12, color: "var(--ghost)" }}>→</span>
          </div>
        </div>
      </div>
    );
  }

  // Legacy/orphan experiments: adopt on click then navigate
  async function handleOrphanClick() {
    setAdopting(true);
    const res = await fetchWithAuth(`${API}/v1/experiments/adopt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_ids: experiment.jobs.map((j) => j.id) }),
    });
    if (res?.ok) {
      const { experiment_id } = await res.json();
      router.push(`/admin/experiments/${experiment_id}`);
    } else {
      setAdopting(false);
    }
  }

  return (
    <div
      onClick={handleOrphanClick}
      style={{
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10,
        overflow: "hidden", cursor: adopting ? "wait" : "pointer", transition: "border-color 0.15s, box-shadow 0.15s", opacity: adopting ? 0.6 : 1,
      }}
      onMouseEnter={(e) => { if (!adopting) { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--line)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"; } }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px" }}>
        <div style={{ width: 3, height: 36, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ fontFamily: "var(--font-jb)", fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{adopting ? "Opening…" : experiment.label}</span>
            <Pill label={`${experiment.jobs.length} runs`} color={accent} />
            <Pill label="legacy" color="var(--dim)" />
            {activeCount > 0 && <PulsingDot color="var(--hold)" />}
            {hasStale && <Pill label="stale" color="var(--bear)" />}
          </div>
          <div style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--ghost)" }}>
            {experiment.jobs[0]?.tickers.join(" · ")} · {experiment.jobs[0]?.start_date} → {experiment.jobs[0]?.end_date} · {relTime(experiment.createdAt.toISOString())}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {activeCount > 0 && <span style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--hold)" }}>{activeCount} running</span>}
          {completedCount > 0 && <span style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--bull)" }}>{completedCount} done</span>}
          {errorCount > 0 && <span style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--bear)" }}>{errorCount} failed</span>}
          <span style={{ fontFamily: "var(--font-jb)", fontSize: 12, color: "var(--ghost)" }}>→</span>
        </div>
      </div>
    </div>
  );

}

// ── New experiment creation ────────────────────────────────────────────────────

function CreateExperimentSection({ type, title, subtitle, onCreated }: {
  type: "philosophy" | "threshold" | "single";
  title: string;
  subtitle: string;
  onCreated: () => void;
}) {
  const [open, setOpen]               = useState(false);
  const [startDate, setStartDate]     = useState(DEFAULT_START);
  const [endDate, setEndDate]         = useState(DEFAULT_END);
  const [tickers, setTickers]         = useState(DEFAULT_TICKERS);
  const [ebcMode, setEbcMode]         = useState("autonomous");
  const [confThreshold, setConf]      = useState(0.65);
  const [philosophy, setPhilosophy]   = useState("balanced");
  const [initialCapital, setInitialCapital] = useState(100_000);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState(false);

  const tickerList = tickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const days = tradingDayEst(startDate, endDate);
  const variantCount = type === "philosophy" ? PHILOSOPHIES.length : type === "threshold" ? THRESHOLDS.length : 1;
  const calls = days * tickerList.length * variantCount;

  // Friendly name auto-generated
  const autoName =
    type === "philosophy"
      ? `Philosophy Comparison · ${tickerList.join(",")} · ${startDate}–${endDate}`
      : type === "threshold"
      ? `Threshold Comparison · ${tickerList.join(",")} · ${startDate}–${endDate}`
      : `Single Run · ${tickerList.join(",")} · ${startDate}–${endDate}`;

  async function handleSubmit() {
    setSubmitting(true); setError(null);

    const body = {
      experiment_type: type,
      name: autoName,
      tickers: tickerList,
      start_date: startDate,
      end_date: endDate,
      ebc_mode: ebcMode,
      philosophy_mode: philosophy,
      confidence_threshold: type === "philosophy" ? confThreshold : type === "single" ? confThreshold : null,
      initial_capital: initialCapital,
    };

    const res = await fetchWithAuth(`${API}/v1/experiments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res?.ok) {
      const detail = await res?.json().catch(() => ({}));
      setError(detail?.detail ?? "Failed to launch experiment.");
    } else {
      setSuccess(true);
      setTimeout(() => { setSuccess(false); setOpen(false); onCreated(); }, 1500);
    }
    setSubmitting(false);
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
      >
        <div>
          <div style={{ fontFamily: "var(--font-jb)", fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 2 }}>+ {title}</div>
          <div style={{ fontFamily: "var(--font-nunito)", fontSize: 12, color: "var(--ghost)" }}>{subtitle}</div>
        </div>
        <span style={{ fontFamily: "var(--font-jb)", fontSize: 12, color: "var(--ghost)" }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{ padding: "4px 18px 20px", borderTop: "1px solid var(--line)" }} className="bcv-fade-in">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, paddingTop: 18, marginBottom: 16 }}>
            <Field label="TICKERS" hint="comma-separated">
              <input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder="AAPL, MSFT, TSLA" style={inputStyle} />
            </Field>
            <Field label="START DATE">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="END DATE">
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="EBC MODE">
              <div style={{ display: "flex", gap: 6 }}>
                {EBC_MODES.map((m) => (
                  <button key={m} type="button" onClick={() => setEbcMode(m)} style={{
                    flex: 1, padding: "7px 8px", borderRadius: 6, fontFamily: "var(--font-nunito)", fontSize: 12, fontWeight: ebcMode === m ? 700 : 400,
                    border: `1px solid ${ebcMode === m ? modeColor[m] : "var(--line)"}`, color: ebcMode === m ? modeColor[m] : "var(--ghost)",
                    background: ebcMode === m ? `${modeColor[m]}12` : "transparent", cursor: "pointer",
                  }}>{m}</button>
                ))}
              </div>
            </Field>

            <Field label="STARTING CAPITAL">
              <input
                type="number"
                min={1000}
                step={1000}
                value={initialCapital}
                onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 100_000)}
                style={inputStyle}
              />
            </Field>

            {/* Philosophy fixed param — show for threshold + single experiments */}
            {(type === "threshold" || type === "single") && (
              <Field label="PHILOSOPHY">
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {PHILOSOPHIES.map((p) => (
                    <button key={p} type="button" onClick={() => setPhilosophy(p)} style={{
                      flex: "1 1 auto", padding: "7px 4px", borderRadius: 6, fontFamily: "var(--font-jb)", fontSize: 11, fontWeight: philosophy === p ? 700 : 400,
                      border: `1px solid ${philosophy === p ? (philosophyColors[p] ?? "var(--brand)") : "var(--line)"}`,
                      color: philosophy === p ? (philosophyColors[p] ?? "var(--brand)") : "var(--ghost)",
                      background: philosophy === p ? `${philosophyColors[p] ?? "var(--brand)"}12` : "transparent", cursor: "pointer",
                    }}>{p.charAt(0).toUpperCase() + p.slice(1)}</button>
                  ))}
                </div>
              </Field>
            )}

            {/* Confidence threshold fixed param — show for philosophy + single experiments */}
            {(type === "philosophy" || type === "single") && (
              <Field label={type === "philosophy" ? "CONFIDENCE THRESHOLD (fixed)" : "CONFIDENCE THRESHOLD"}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {THRESHOLDS.map((t) => (
                    <button key={t} type="button" onClick={() => setConf(t)} style={{
                      flex: "1 1 auto", padding: "7px 4px", borderRadius: 6, fontFamily: "var(--font-jb)", fontSize: 11, fontWeight: confThreshold === t ? 700 : 400,
                      border: `1px solid ${confThreshold === t ? "var(--brand)" : "var(--line)"}`,
                      color: confThreshold === t ? "var(--brand)" : "var(--ghost)",
                      background: confThreshold === t ? "var(--brand-bg)" : "transparent", cursor: "pointer",
                    }}>{(t * 100).toFixed(0)}%</button>
                  ))}
                </div>
              </Field>
            )}
          </div>

          <div style={{ background: "var(--elevated)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontFamily: "var(--font-nunito)", color: "var(--dim)", marginBottom: 14 }}>
            {variantCount} variant{variantCount > 1 ? "s" : ""} × {days} days × {tickerList.length} tickers = ~{calls} AI calls
          </div>

          {error && (
            <div style={{ color: "var(--bear)", fontSize: 12, fontFamily: "var(--font-nunito)", background: "var(--bear-bg)", border: "1px solid var(--bear)", borderRadius: 6, padding: "8px 12px", marginBottom: 10 }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || success}
            style={{
              background: success ? "var(--bull)" : submitting ? "var(--line)" : "var(--brand)", color: "#fff",
              fontFamily: "var(--font-nunito)", fontWeight: 700, fontSize: 14,
              padding: "11px 0", borderRadius: 8, border: "none", width: "100%",
              cursor: submitting || success ? "not-allowed" : "pointer", transition: "background 0.2s",
            }}
          >
            {success ? "✓ Launched" : submitting ? "Launching…" : `Run ${title} (${variantCount} backtest${variantCount > 1 ? "s" : ""})`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── New Experiment Modal ──────────────────────────────────────────────────────

type VariantRow = { id: number; philosophy: string; threshold: number | null };

let _variantId = 0;
function makeVariant(philosophy = "balanced", threshold: number | null = 0.65): VariantRow {
  return { id: ++_variantId, philosophy, threshold };
}

const PHILOSOPHY_TEMPLATE: VariantRow[] = [
  makeVariant("lynch", 0.65),
  makeVariant("soros", 0.65),
  makeVariant("buffett", 0.65),
  makeVariant("balanced", 0.65),
];

const THRESHOLD_TEMPLATE: VariantRow[] = [
  makeVariant("balanced", 0.50),
  makeVariant("balanced", 0.65),
  makeVariant("balanced", 0.80),
  makeVariant("balanced", 0.95),
];

function NewExperimentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [tickers, setTickers]         = useState(DEFAULT_TICKERS);
  const [startDate, setStartDate]     = useState(DEFAULT_START);
  const [endDate, setEndDate]         = useState(DEFAULT_END);
  const [ebcMode, setEbcMode]         = useState("autonomous");
  const [initialCapital, setInitialCapital] = useState(100_000);
  const [variants, setVariants]       = useState<VariantRow[]>([]);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const tickerList = tickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const days = tradingDayEst(startDate, endDate);
  const calls = days * tickerList.length * (variants.length || 1);

  function applyTemplate(rows: VariantRow[]) {
    setVariants(rows.map((r) => makeVariant(r.philosophy, r.threshold)));
  }

  function addVariant() {
    setVariants((prev) => [...prev, makeVariant()]);
  }

  function removeVariant(id: number) {
    setVariants((prev) => prev.filter((v) => v.id !== id));
  }

  function updateVariant(id: number, field: "philosophy" | "threshold", value: string | number | null) {
    setVariants((prev) => prev.map((v) => v.id === id ? { ...v, [field]: value } : v));
  }

  async function handleLaunch() {
    if (variants.length === 0) { setError("Add at least one job variant."); return; }
    setSubmitting(true); setError(null);

    const expType = (() => {
      const philosophies = new Set(variants.map((v) => v.philosophy));
      const thresholds   = new Set(variants.map((v) => v.threshold));
      if (philosophies.size > 1 && thresholds.size <= 1) return "philosophy";
      if (thresholds.size > 1 && philosophies.size <= 1) return "threshold";
      return "custom";
    })();

    const autoName = expType === "philosophy"
      ? `Philosophy Comparison · ${tickerList.join(",")} · ${startDate}–${endDate}`
      : expType === "threshold"
      ? `Threshold Comparison · ${tickerList.join(",")} · ${startDate}–${endDate}`
      : `Custom Experiment · ${tickerList.join(",")} · ${startDate}–${endDate}`;

    const body = {
      experiment_type: expType,
      name: autoName,
      tickers: tickerList,
      start_date: startDate,
      end_date: endDate,
      ebc_mode: ebcMode,
      initial_capital: initialCapital,
      custom_variants: variants.map((v) => ({ philosophy_mode: v.philosophy, confidence_threshold: v.threshold })),
    };

    const res = await fetchWithAuth(`${API}/v1/experiments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res?.ok) {
      const detail = await res?.json().catch(() => ({}));
      setError(detail?.detail ?? "Failed to launch experiment.");
      setSubmitting(false);
    } else {
      onCreated();
      onClose();
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, width: "100%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.2)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ fontFamily: "var(--font-jb)", fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>New Experiment</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ghost)", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Shared settings */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="TICKERS" hint="comma-separated">
                <input value={tickers} onChange={(e) => setTickers(e.target.value)} style={inputStyle} />
              </Field>
            </div>
            <Field label="START DATE">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="END DATE">
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="EBC MODE">
              <div style={{ display: "flex", gap: 6, height: 38, alignItems: "center" }}>
                {EBC_MODES.map((m) => (
                  <button key={m} onClick={() => setEbcMode(m)} style={{
                    flex: 1, height: "100%", borderRadius: 6, fontFamily: "var(--font-nunito)", fontSize: 12, fontWeight: ebcMode === m ? 700 : 400,
                    border: `1px solid ${ebcMode === m ? modeColor[m] : "var(--line)"}`, color: ebcMode === m ? modeColor[m] : "var(--ghost)",
                    background: ebcMode === m ? `${modeColor[m]}12` : "transparent", cursor: "pointer",
                  }}>{m}</button>
                ))}
              </div>
            </Field>
            <Field label="STARTING CAPITAL">
              <input
                type="number"
                min={1000}
                step={1000}
                value={initialCapital}
                onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 100_000)}
                style={inputStyle}
              />
            </Field>
          </div>

          {/* Templates */}
          <div>
            <div style={{ fontFamily: "var(--font-jb)", fontSize: 9, color: "var(--ghost)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Quick Templates</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Philosophy Comparison", desc: "Lynch · Soros · Buffett · Balanced", rows: PHILOSOPHY_TEMPLATE },
                { label: "Confidence Threshold", desc: "50% · 65% · 80% · 95%", rows: THRESHOLD_TEMPLATE },
              ].map((t) => (
                <button
                  key={t.label}
                  onClick={() => applyTemplate(t.rows)}
                  style={{
                    background: "var(--elevated)", border: "1px solid var(--line)", borderRadius: 8,
                    padding: "10px 14px", cursor: "pointer", textAlign: "left", transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--brand)50")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line)")}
                >
                  <div style={{ fontFamily: "var(--font-jb)", fontWeight: 700, fontSize: 11, color: "var(--ink)", marginBottom: 3 }}>{t.label}</div>
                  <div style={{ fontFamily: "var(--font-nunito)", fontSize: 11, color: "var(--ghost)" }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Variant builder */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontFamily: "var(--font-jb)", fontSize: 9, color: "var(--ghost)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Jobs{variants.length > 0 ? ` (${variants.length})` : ""}
              </div>
              <button onClick={addVariant} style={{ fontFamily: "var(--font-jb)", fontSize: 10, background: "none", border: "1px solid var(--line)", color: "var(--brand)", padding: "3px 10px", borderRadius: 5, cursor: "pointer" }}>
                + Add job
              </button>
            </div>

            {variants.length === 0 && (
              <div style={{ textAlign: "center", padding: "16px 0", color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-nunito)", border: "1px dashed var(--line)", borderRadius: 8 }}>
                Select a template above or add jobs manually
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {variants.map((v, i) => (
                <div key={v.id} style={{ display: "flex", gap: 8, alignItems: "center", background: "var(--elevated)", borderRadius: 7, padding: "8px 10px" }}>
                  <span style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--ghost)", minWidth: 18 }}>#{i + 1}</span>

                  {/* Philosophy select */}
                  <select
                    value={v.philosophy}
                    onChange={(e) => updateVariant(v.id, "philosophy", e.target.value)}
                    style={{ ...inputStyle, padding: "5px 8px", fontSize: 11, flex: 1 }}
                  >
                    {PHILOSOPHIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                  </select>

                  {/* Threshold select */}
                  <select
                    value={v.threshold ?? ""}
                    onChange={(e) => updateVariant(v.id, "threshold", e.target.value === "" ? null : parseFloat(e.target.value))}
                    style={{ ...inputStyle, padding: "5px 8px", fontSize: 11, flex: 1 }}
                  >
                    <option value="">No threshold</option>
                    {THRESHOLDS.map((t) => <option key={t} value={t}>{(t * 100).toFixed(0)}% confidence</option>)}
                  </select>

                  <button onClick={() => removeVariant(v.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ghost)", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>×</button>
                </div>
              ))}
            </div>
          </div>

          {/* Cost estimate */}
          {variants.length > 0 && (
            <div style={{ background: "var(--elevated)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontFamily: "var(--font-nunito)", color: "var(--dim)" }}>
              {variants.length} job{variants.length > 1 ? "s" : ""} × {days} trading days × {tickerList.length} tickers = ~{calls} AI calls
            </div>
          )}

          {error && (
            <div style={{ color: "var(--bear)", fontSize: 12, fontFamily: "var(--font-nunito)", background: "var(--bear-bg)", border: "1px solid var(--bear)", borderRadius: 6, padding: "8px 12px" }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{ flex: 1, padding: "11px 0", background: "none", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ghost)", fontFamily: "var(--font-nunito)", fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
            <button
              onClick={handleLaunch}
              disabled={submitting || variants.length === 0}
              style={{
                flex: 2, padding: "11px 0", background: submitting ? "var(--line)" : "var(--brand)", color: "#fff",
                border: "none", borderRadius: 8, fontFamily: "var(--font-nunito)", fontWeight: 700, fontSize: 13,
                cursor: submitting || variants.length === 0 ? "not-allowed" : "pointer", opacity: variants.length === 0 ? 0.5 : 1,
              }}
            >
              {submitting ? "Launching…" : `Launch Experiment (${variants.length} run${variants.length !== 1 ? "s" : ""})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BacktestComparisonView() {
  const [allJobs, setAllJobs]                 = useState<BacktestJob[]>([]);
  const [experiments, setExperiments]         = useState<Experiment[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [cancellingStale, setCancellingStale] = useState(false);
  const [showModal, setShowModal]             = useState(false);

  const loadAll = useCallback(async () => {
    // Fetch backend experiments + all jobs in parallel
    const [expRes, jobsRes] = await Promise.all([
      fetchWithAuth(`${API}/v1/experiments`),
      fetchWithAuth(`${API}/v1/backtest`),
    ]);

    const backendExps: BackendExperiment[] = expRes?.ok ? await expRes.json() : [];
    const jobs: BacktestJob[]              = jobsRes?.ok ? await jobsRes.json() : [];

    setAllJobs(jobs);

    // Convert backend experiments to display format
    const backedIds = new Set(backendExps.map((e) => e.id));
    const beDisplayed = backendExps.map(backendToExperiment);

    // Group orphan jobs (no experiment_id, or experiment_id not in backend list)
    const orphanJobs = jobs.filter((j) => !j.experiment_id || !backedIds.has(j.experiment_id));
    const orphanGroups = groupOrphanJobs(orphanJobs);

    // Merge: backend experiments first (newest), then orphan groups
    setExperiments([...beDisplayed, ...orphanGroups].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  }, []);

  useEffect(() => {
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  // Poll every 5s while any active jobs exist
  useEffect(() => {
    const hasActive = allJobs.some((j) => j.status === "running" || j.status === "queued");
    if (!hasActive) return;
    const id = setInterval(loadAll, 5000);
    return () => clearInterval(id);
  }, [allJobs, loadAll]);

  // Cancel all stale jobs (running > 24h)
  async function cancelAllStale() {
    setCancellingStale(true);
    const stale = allJobs.filter(
      (j) => (j.status === "running" || j.status === "queued") && Date.now() - new Date(j.created_at).getTime() > STALE_MS
    );
    await Promise.allSettled(
      stale.map((j) => fetchWithAuth(`${API}/v1/backtest/${j.id}/cancel`, { method: "POST" }))
    );
    await loadAll();
    setCancellingStale(false);
  }

  const activeCount    = allJobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const completedCount = allJobs.filter((j) => j.status === "completed").length;
  const staleCount     = allJobs.filter(
    // eslint-disable-next-line react-hooks/purity
    (j) => (j.status === "running" || j.status === "queued") && Date.now() - new Date(j.created_at).getTime() > STALE_MS
  ).length;

  return (
    <>
      <StyleInjector />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 32 }}>

        {/* Header bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontFamily: "var(--font-jb)", fontSize: 11, color: "var(--ghost)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {experiments.length} group{experiments.length !== 1 ? "s" : ""} · {allJobs.length} total runs
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {staleCount > 0 && (
              <button
                onClick={cancelAllStale}
                disabled={cancellingStale}
                style={{ fontSize: 10, fontFamily: "var(--font-jb)", background: "var(--bear-bg)", border: "1px solid var(--bear)40", color: "var(--bear)", padding: "4px 10px", borderRadius: 5, cursor: "pointer" }}
              >
                {cancellingStale ? "Cancelling…" : `Cancel ${staleCount} stale`}
              </button>
            )}
            <div style={{ fontSize: 11, fontFamily: "var(--font-nunito)", color: "var(--dim)" }}>
              {activeCount > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginRight: 10 }}>
                  <PulsingDot /> <span style={{ color: "var(--hold)" }}>{activeCount} running</span>
                </span>
              )}
              {completedCount > 0 && <span><span style={{ color: "var(--bull)" }}>{completedCount}</span> done</span>}
            </div>
            <button
              onClick={loadAll}
              style={{ fontSize: 11, fontFamily: "var(--font-jb)", background: "none", border: "1px solid var(--line)", color: "var(--ghost)", padding: "4px 10px", borderRadius: 5, cursor: "pointer" }}
            >
              ↺ Refresh
            </button>
            <button
              onClick={() => setShowModal(true)}
              style={{ fontSize: 11, fontFamily: "var(--font-jb)", background: "var(--brand)", border: "none", color: "#fff", padding: "4px 12px", borderRadius: 5, cursor: "pointer", fontWeight: 700 }}
            >
              + New Experiment
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ color: "var(--ghost)", fontSize: 13, fontFamily: "var(--font-nunito)", textAlign: "center", padding: "32px 0" }}>
            Loading…
          </div>
        )}

        {/* Experiments */}
        {!loading && (
          <>
            {experiments.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 24px", color: "var(--ghost)", fontFamily: "var(--font-nunito)", fontSize: 13 }}>
                <div style={{ fontSize: 24, marginBottom: 10 }}>◈</div>
                <div style={{ fontWeight: 600, color: "var(--dim)", marginBottom: 6 }}>No experiments yet</div>
                <div>Click <strong>+ New Experiment</strong> to launch a philosophy or threshold comparison.</div>
              </div>
            ) : (
              experiments.map((exp, i) => (
                <ExperimentCard
                  key={exp.id}
                  experiment={exp}
                  defaultOpen={i === 0}
                  onJobsChanged={loadAll}
                />
              ))
            )}

          </>
        )}

      </div>

      {showModal && <NewExperimentModal onClose={() => setShowModal(false)} onCreated={loadAll} />}
    </>
  );
}
