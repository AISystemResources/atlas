"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchWithAuth } from "@/lib/api";
import { Card, SectionLabel, StatCard, relTime, type AdminStats } from "./admin-shared";

const API = "";

const PLACEHOLDER_RUNS = [
  { ticker: "AAPL",  action: "BUY",  status: "ok",    ts: "2026-03-20T08:14:00Z", duration: "3.2s" },
  { ticker: "NVDA",  action: "HOLD", status: "ok",    ts: "2026-03-20T08:12:00Z", duration: "2.9s" },
  { ticker: "TSLA",  action: "SELL", status: "error", ts: "2026-03-20T08:10:00Z", duration: "1.1s" },
  { ticker: "MSFT",  action: "BUY",  status: "ok",    ts: "2026-03-19T16:05:00Z", duration: "3.5s" },
  { ticker: "GOOGL", action: "BUY",  status: "ok",    ts: "2026-03-19T16:03:00Z", duration: "3.1s" },
];

export default function OverviewPage() {
  const [stats, setStats]               = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API}/v1/admin/stats`);
      if (res?.ok) setStats(await res.json());
    } catch { /* non-fatal */ } finally { setStatsLoading(false); }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const sparkline = [12, 18, 15, 22, 19, 27, stats?.total_users ?? 30];

  return (
    <div className="flex flex-col gap-8">
      {/* Stat cards */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        <StatCard label="Total Users" value={statsLoading ? "…" : stats?.total_users ?? 0} sub="all time" sparkline={sparkline} />
        <StatCard label="Tier Breakdown" value={statsLoading ? "…" : `${stats?.free_count ?? 0} / ${stats?.pro_count ?? 0} / ${stats?.max_count ?? 0}`} sub="Free / Pro / Max" />
        <StatCard label="Signals Today" value={statsLoading ? "…" : stats?.signals_today ?? 0} sub="pipeline outputs" />
        <StatCard label="Auto Executions" value={statsLoading ? "…" : stats?.executions_today ?? 0} sub="autonomous trades today" />
      </div>

      {/* 2-column below */}
      <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {/* Recent pipeline runs */}
        <div>
          <SectionLabel>Recent Pipeline Runs</SectionLabel>
          <Card>
            {PLACEHOLDER_RUNS.map((r, i) => (
              <div key={i} className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: i < PLACEHOLDER_RUNS.length - 1 ? "1px solid var(--line)" : "none" }}>
                <div className="flex items-center gap-3">
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: r.status === "ok" ? "var(--bull)" : "var(--bear)", flexShrink: 0 }} />
                  <span className="font-display font-bold" style={{ color: "var(--ink)", fontSize: 13 }}>{r.ticker}</span>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-jb)", color: r.action === "BUY" ? "var(--bull)" : r.action === "SELL" ? "var(--bear)" : "var(--hold)", background: r.action === "BUY" ? "var(--bull-bg)" : r.action === "SELL" ? "var(--bear-bg)" : "var(--hold-bg)", padding: "1px 6px", borderRadius: 3 }}>
                    {r.action}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)" }}>{r.duration}</span>
                  <span style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)" }}>{relTime(r.ts)}</span>
                </div>
              </div>
            ))}
          </Card>
        </div>

      </div>
    </div>
  );
}
