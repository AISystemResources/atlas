"use client";

/**
 * Single-job equity chart.
 *
 * X axis = all business days in [startDate, endDate].
 * The line is drawn only for days that appear in `curve`.
 * Days after the last data point are left empty, giving a correct
 * "completed so far" view for stale / in-progress jobs.
 */

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
import { businessDays } from "@/lib/bdays";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

type CurvePoint = { date: string; value: number };

export function EquityChart({
  curve,
  startDate,
  endDate,
  initialCapital,
  accent,
}: {
  curve: CurvePoint[];
  startDate: string;
  endDate: string;
  initialCapital: number;
  accent: string;
}) {
  if (curve.length === 0) return null;

  const labels = businessDays(startDate, endDate);
  const byDate = new Map(curve.map((p) => [p.date, p.value]));

  // Build dataset: null for days without data (stops the line there)
  const firstDataIdx = labels.findIndex((d) => byDate.has(d));
  const data = labels.map((d, i) => {
    const v = byDate.get(d);
    if (v != null) return v;
    return i >= firstDataIdx ? null : null; // null before first point too — line starts at first available day
  });

  const finalVal = curve[curve.length - 1].value;
  const pnlPct   = ((finalVal - initialCapital) / initialCapital) * 100;
  const lineColor = pnlPct >= 0 ? "#10b981" : "#ef4444";
  const areaColor = pnlPct >= 0 ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)";

  const fmtVal = (v: number) =>
    v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M`
    : v >= 1_000   ? `$${(v / 1_000).toFixed(1)}K`
    : `$${v.toFixed(0)}`;

  return (
    <div style={{ background: "var(--elevated)", borderRadius: 8, padding: "14px 16px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--font-jb)", fontSize: 10, color: "var(--ghost)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Portfolio Value
        </span>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-jb)", fontSize: 11, color: "var(--ghost)" }}>
            Start {fmtVal(initialCapital)}
          </span>
          <span style={{ fontFamily: "var(--font-jb)", fontSize: 12, fontWeight: 700, color: lineColor }}>
            {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}% · {fmtVal(finalVal)}
          </span>
        </div>
      </div>

      <Line
        data={{
          labels,
          datasets: [
            {
              data,
              borderColor: accent,
              backgroundColor: areaColor,
              fill: true,
              borderWidth: 1.5,
              pointRadius: 0,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: accent,
              spanGaps: false,
              tension: 0.2,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 5,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: "index",
              intersect: false,
              callbacks: {
                title: (items) => items[0]?.label ?? "",
                label: (item) =>
                  item.raw != null ? fmtVal(item.raw as number) : "",
              },
              backgroundColor: "rgba(15,15,20,0.9)",
              titleFont: { family: "monospace", size: 11 },
              bodyFont: { family: "monospace", size: 12 },
              padding: 8,
              borderColor: "rgba(255,255,255,0.1)",
              borderWidth: 1,
            },
          },
          scales: {
            x: {
              ticks: {
                maxTicksLimit: 6,
                color: "rgba(150,150,160,0.8)",
                font: { family: "monospace", size: 9 },
                maxRotation: 0,
              },
              grid: { color: "rgba(255,255,255,0.04)" },
            },
            y: {
              min: 0,
              suggestedMax: initialCapital * 1.1,
              ticks: {
                color: "rgba(150,150,160,0.8)",
                font: { family: "monospace", size: 9 },
                callback: (v) => fmtVal(v as number),
                maxTicksLimit: 5,
              },
              grid: { color: "rgba(255,255,255,0.04)" },
            },
          },
        }}
      />
    </div>
  );
}
