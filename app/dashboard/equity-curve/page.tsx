// frontend/app/dashboard/equity-curve/page.tsx
"use client";

import { Suspense, useEffect, useRef, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { fetchEquityCurve, fetchWithAuth, type EquityCurvePoint } from "@/lib/api";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

const API_URL = "/api";
const BASE_CAPITAL = 100_000;

// ─── Types ──────────────────────────────────────────────────────────────────

type Position = {
  ticker: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  pnl: number;
};

type Portfolio = {
  total_value: number;
  cash: number;
  pnl_today: number;
  pnl_total: number;
  positions: Position[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return "$" + n.toFixed(0);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Chart component ────────────────────────────────────────────────────────

function EquityChart({ points, positive }: { points: EquityCurvePoint[]; positive: boolean }) {
  const chartRef = useRef<ChartJS<"line">>(null);

  const lineColor = positive ? "#16a34a" : "#dc2626";
  const fillColor = positive ? "rgba(22, 163, 74, 0.08)" : "rgba(220, 38, 38, 0.06)";

  const data = useMemo(() => ({
    labels: points.map((p) => formatDate(p.date)),
    datasets: [
      {
        data: points.map((p) => p.value),
        borderColor: lineColor,
        backgroundColor: fillColor,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 20,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: lineColor,
        pointHoverBorderColor: "#fff",
        pointHoverBorderWidth: 2,
        borderWidth: 2,
      },
    ],
  }), [points, lineColor, fillColor]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index" as const,
      intersect: false,
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        titleFont: { family: "'JetBrains Mono', monospace", size: 11 },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 12, weight: "bold" as const },
        padding: { top: 8, bottom: 8, left: 12, right: 12 },
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          title: (items: { label: string }[]) => items[0]?.label ?? "",
          label: (item: { raw: unknown }) =>
            "$" + (item.raw as number).toLocaleString("en-US", { maximumFractionDigits: 0 }),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { family: "'JetBrains Mono', monospace", size: 10 },
          color: "rgba(148, 163, 184, 0.6)",
          maxTicksLimit: 6,
          maxRotation: 0,
        },
        border: { display: false },
      },
      y: {
        min: 0,
        grid: {
          color: "rgba(148, 163, 184, 0.08)",
          drawTicks: false,
        },
        ticks: {
          font: { family: "'JetBrains Mono', monospace", size: 10 },
          color: "rgba(148, 163, 184, 0.6)",
          padding: 8,
          callback: (value: string | number) => fmtCompact(Number(value)),
          maxTicksLimit: 5,
        },
        border: { display: false },
      },
    },
    layout: {
      padding: { top: 4, right: 4, bottom: 0, left: 0 },
    },
  }), []);

  return (
    <div style={{ height: 220, position: "relative" }}>
      <Line ref={chartRef} data={data} options={options} />
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

function EquityCurveContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rangeParam = searchParams.get("range") ?? "all";
  const [points, setPoints] = useState<EquityCurvePoint[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchEquityCurve(),
      fetchWithAuth(`${API_URL}/v1/portfolio`).then((r) => r?.json() ?? null),
    ]).then(([curveData, portData]) => {
      setPoints(curveData);
      setPortfolio(portData);
      setLoading(false);
    });
  }, []);

  // Append today's live portfolio value to the chart so it reflects the current state
  const chartPoints = useMemo(() => {
    if (!portfolio || points.length === 0) return points;
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = points[points.length - 1].date.slice(0, 10);
    if (lastDate === today) {
      // Replace today's stale snapshot with live value
      return [...points.slice(0, -1), { date: today, value: portfolio.total_value }];
    }
    return [...points, { date: today, value: portfolio.total_value }];
  }, [points, portfolio]);

  const first = chartPoints.find((p) => p.value > 0) ?? chartPoints[0];
  const currentValue = portfolio?.total_value ?? chartPoints[chartPoints.length - 1]?.value ?? 0;
  const totalReturn = first && first.value > 0
    ? ((currentValue - first.value) / first.value) * 100
    : 0;
  const positive = totalReturn >= 0;
  const pnlTotal = portfolio?.pnl_total ?? (currentValue - BASE_CAPITAL);
  const peakValue = Math.max(...chartPoints.map((p) => p.value));

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <header style={{
        background: "var(--header-bg)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--line)", padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 20,
      }}>
        <button onClick={() => router.back()} style={{
          background: "transparent", border: "none", cursor: "pointer",
          color: "var(--ghost)", fontSize: 20, padding: 0, lineHeight: 1,
        }}>
          ←
        </button>
        <span className="font-display font-bold" style={{ fontSize: 17, color: "var(--ink)" }}>
          {rangeParam === "1d" ? "Today" : "All-Time"} Equity Curve
        </span>
      </header>

      <main style={{ padding: "20px" }}>
        {loading ? (
          <div style={{ color: "var(--ghost)", fontSize: 13, textAlign: "center", paddingTop: 48 }}>
            Loading...
          </div>
        ) : points.length === 0 ? (
          <div style={{ color: "var(--ghost)", fontSize: 13, textAlign: "center", paddingTop: 48 }}>
            No equity data yet.
          </div>
        ) : (
          <>
            {/* Portfolio value + return */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)",
                letterSpacing: "0.1em", textTransform: "uppercase" as const, marginBottom: 6,
              }}>
                Portfolio Value
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span className="num font-display font-bold" style={{
                  fontSize: 32, color: "var(--ink)", letterSpacing: "-0.02em",
                }}>
                  {fmt(currentValue)}
                </span>
                <span style={{
                  fontSize: 14, fontFamily: "var(--font-jb)", fontWeight: 700,
                  color: positive ? "var(--bull)" : "var(--bear)",
                }}>
                  {positive ? "+" : ""}{totalReturn.toFixed(2)}%
                </span>
              </div>
              <div style={{
                fontSize: 12, fontFamily: "var(--font-jb)", color: "var(--ghost)", marginTop: 2,
              }}>
                PnL {pnlTotal >= 0 ? "+" : ""}{fmt(pnlTotal)}
              </div>
            </div>

            {/* Chart */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: 12, padding: "16px 12px 12px", marginBottom: 20,
              boxShadow: "var(--card-shadow)",
            }}>
              <EquityChart points={chartPoints} positive={positive} />
            </div>

            {/* Key stats row */}
            <div style={{
              display: "flex", gap: 8, marginBottom: 20,
            }}>
              {[
                { label: "Start", value: fmt(BASE_CAPITAL) },
                { label: "Peak", value: fmt(peakValue) },
                { label: "Days", value: String(chartPoints.length) },
              ].map((s) => (
                <div key={s.label} style={{
                  flex: 1, background: "var(--surface)", border: "1px solid var(--line)",
                  borderRadius: 10, padding: "12px 10px", textAlign: "center",
                  boxShadow: "var(--card-shadow)",
                }}>
                  <div style={{
                    fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)",
                    letterSpacing: "0.08em", textTransform: "uppercase" as const, marginBottom: 4,
                  }}>
                    {s.label}
                  </div>
                  <div className="num" style={{
                    fontSize: 13, fontFamily: "var(--font-jb)", fontWeight: 700, color: "var(--ink)",
                  }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Current holdings */}
            {portfolio && (
              <div style={{
                background: "var(--surface)", border: "1px solid var(--line)",
                borderRadius: 12, overflow: "hidden", boxShadow: "var(--card-shadow)",
              }}>
                <div style={{
                  padding: "14px 16px 10px",
                  fontSize: 9, fontFamily: "var(--font-jb)", color: "var(--ghost)",
                  letterSpacing: "0.1em", textTransform: "uppercase" as const,
                }}>
                  Current Holdings
                </div>

                {/* Positions */}
                {portfolio.positions.map((pos) => {
                  const mktValue = pos.shares * pos.current_price;
                  const pnlPct = pos.avg_cost > 0
                    ? ((pos.current_price - pos.avg_cost) / pos.avg_cost) * 100
                    : 0;
                  const posPositive = pos.pnl >= 0;

                  return (
                    <div key={pos.ticker} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 16px", borderTop: "1px solid var(--line)",
                    }}>
                      <div>
                        <div style={{
                          fontSize: 14, fontFamily: "var(--font-jb)", fontWeight: 700,
                          color: "var(--ink)",
                        }}>
                          {pos.ticker}
                        </div>
                        <div style={{
                          fontSize: 10, fontFamily: "var(--font-jb)", color: "var(--ghost)",
                        }}>
                          {pos.shares % 1 === 0 ? pos.shares : pos.shares.toFixed(2)} sh @ {fmt(pos.avg_cost)}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" as const }}>
                        <div className="num" style={{
                          fontSize: 13, fontFamily: "var(--font-jb)", fontWeight: 700,
                          color: "var(--ink)",
                        }}>
                          {fmt(mktValue)}
                        </div>
                        <div className="num" style={{
                          fontSize: 10, fontFamily: "var(--font-jb)", fontWeight: 600,
                          color: posPositive ? "var(--bull)" : "var(--bear)",
                        }}>
                          {posPositive ? "+" : ""}{fmt(pos.pnl)} ({posPositive ? "+" : ""}{pnlPct.toFixed(1)}%)
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Cash row */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 16px", borderTop: "1px solid var(--line)",
                }}>
                  <div style={{
                    fontSize: 14, fontFamily: "var(--font-jb)", fontWeight: 700,
                    color: "var(--ink)",
                  }}>
                    Cash
                  </div>
                  <div className="num" style={{
                    fontSize: 13, fontFamily: "var(--font-jb)", fontWeight: 700,
                    color: "var(--ink)",
                  }}>
                    {fmt(portfolio.cash)}
                  </div>
                </div>

                {/* Total row */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 16px", borderTop: "1px solid var(--line)",
                  background: "var(--elevated)",
                }}>
                  <div style={{
                    fontSize: 11, fontFamily: "var(--font-jb)", fontWeight: 700,
                    color: "var(--dim)", letterSpacing: "0.04em",
                  }}>
                    TOTAL
                  </div>
                  <div className="num" style={{
                    fontSize: 15, fontFamily: "var(--font-jb)", fontWeight: 700,
                    color: "var(--ink)",
                  }}>
                    {fmt(portfolio.total_value)}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function EquityCurvePage() {
  return (
    <Suspense fallback={null}>
      <EquityCurveContent />
    </Suspense>
  );
}
