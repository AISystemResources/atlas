"use client";

import { useEffect, useMemo, useState } from "react";
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
import { fetchWithAuth } from "@/lib/api";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BarsResponse {
  ticker: string;
  days: number;
  bars: Bar[];
}

const RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
] as const;

type RangeKey = (typeof RANGES)[number]["label"];

export function PriceChart({ ticker }: { ticker: string }) {
  const [range, setRange] = useState<RangeKey>("3M");
  const [bars, setBars] = useState<Bar[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const days = RANGES.find((r) => r.label === range)?.days ?? 90;

    fetchWithAuth(`/api/v1/market/bars?ticker=${ticker}&days=${days}`)
      .then((r) => r?.json() as Promise<BarsResponse | null>)
      .then((data) => {
        if (!active) return;
        setBars(data?.bars ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [ticker, range]);

  const { labels, prices, latest, change, changePct, positive } = useMemo(() => {
    if (bars.length === 0) {
      return { labels: [], prices: [], latest: 0, change: 0, changePct: 0, positive: true };
    }
    const labels = bars.map((b) => b.date);
    const prices = bars.map((b) => b.close);
    const first = prices[0];
    const last = prices[prices.length - 1];
    const change = last - first;
    const positive = change >= 0;
    const changePct = first !== 0 ? (change / first) * 100 : 0;
    return { labels, prices, latest: last, change, changePct, positive };
  }, [bars]);

  const lineColor = positive ? "rgb(0, 200, 150)" : "rgb(255, 45, 85)";
  const fillColor = positive ? "rgba(0, 200, 150, 0.08)" : "rgba(255, 45, 85, 0.08)";

  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: prices,
          borderColor: lineColor,
          backgroundColor: fillColor,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.25,
        },
      ],
    }),
    [labels, prices, lineColor, fillColor],
  );

  const options = useMemo(
    () => ({
      maintainAspectRatio: false,
      responsive: true,
      animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "index" as const,
          intersect: false,
          backgroundColor: "rgba(20,20,20,0.95)",
          padding: 10,
          titleFont: { family: "JetBrains Mono", size: 11 },
          bodyFont: { family: "JetBrains Mono", size: 12 },
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: (ctx: any) =>
              `${ticker}  $${Number(ctx.parsed.y).toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          display: true,
          ticks: {
            color: "rgba(140,140,140,0.6)",
            font: { family: "JetBrains Mono", size: 9 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
          },
          grid: { display: false },
        },
        y: {
          display: true,
          position: "right" as const,
          ticks: {
            color: "rgba(140,140,140,0.6)",
            font: { family: "JetBrains Mono", size: 9 },
            callback: (v: string | number) => `$${Number(v).toFixed(0)}`,
          },
          grid: { color: "rgba(140,140,140,0.06)" },
        },
      },
    }),
    [ticker],
  );

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "18px 18px 12px",
        boxShadow: "var(--card-shadow)",
        marginBottom: 16,
      }}
    >
      <header className="flex items-start justify-between gap-3 flex-wrap" style={{ marginBottom: 12 }}>
        <div>
          <div
            style={{
              color: "var(--ghost)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              marginBottom: 4,
            }}
          >
            PRICE
          </div>
          {bars.length > 0 ? (
            <div className="flex items-baseline gap-3 flex-wrap">
              <span
                className="num"
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: "var(--ink)",
                  fontFamily: "var(--font-jb)",
                  letterSpacing: "-0.01em",
                }}
              >
                ${latest.toFixed(2)}
              </span>
              <span
                className="num"
                style={{
                  fontSize: 13,
                  fontFamily: "var(--font-jb)",
                  color: positive ? "var(--bull)" : "var(--bear)",
                  fontWeight: 600,
                }}
              >
                {positive ? "+" : ""}${change.toFixed(2)} ({positive ? "+" : ""}
                {changePct.toFixed(2)}%)
              </span>
            </div>
          ) : (
            <span style={{ color: "var(--ghost)", fontSize: 14 }}>
              {loaded ? "No data" : "Loading…"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.label)}
              style={{
                background: range === r.label ? "var(--ink)" : "transparent",
                color: range === r.label ? "var(--bg)" : "var(--ghost)",
                border: `1px solid ${range === r.label ? "var(--ink)" : "var(--line)"}`,
                fontSize: 10,
                fontFamily: "var(--font-jb)",
                padding: "4px 10px",
                borderRadius: 5,
                cursor: "pointer",
                letterSpacing: "0.04em",
                fontWeight: 600,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      <div style={{ height: 220, position: "relative" }}>
        {bars.length === 0 ? null : <Line data={data} options={options} />}
      </div>
    </section>
  );
}
