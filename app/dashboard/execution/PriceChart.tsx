"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
} from "lightweight-charts";

export interface ChartBar {
  time: number; // UNIX seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PriceOverlay {
  entry: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  direction: "long" | "short" | null;
}

// Sprint 107: standalone candlestick chart for the Execution page. Renders
// the last N 5m bars returned by the evaluate route and overlays the
// strategy's entry / TP / SL levels as horizontal price lines when a
// signal is active.
export function PriceChart({
  bars,
  overlay,
  ticker,
  timeframe,
}: {
  bars: ChartBar[];
  overlay: PriceOverlay;
  ticker: string;
  timeframe: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlayLinesRef = useRef<IPriceLine[]>([]);

  // Create chart once — reused across re-renders. The library manages its
  // own DOM inside the container; we just push new data at it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { color: "transparent" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.15)",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.15)",
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      overlayLinesRef.current = [];
    };
  }, []);

  // Push new bar data whenever the bars prop changes.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || bars.length === 0) return;

    // lightweight-charts wants strictly ascending, unique timestamps.
    const seen = new Set<number>();
    const clean = bars
      .filter((b) => {
        if (seen.has(b.time)) return false;
        seen.add(b.time);
        return true;
      })
      .sort((a, b) => a.time - b.time)
      .map((b) => ({
        time: b.time as unknown as import("lightweight-charts").UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));

    series.setData(clean);
    chart.timeScale().fitContent();
  }, [bars]);

  // Overlay entry / TP / SL lines when a signal is live. Clear and redraw
  // on every overlay change — three lines max, cheap.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of overlayLinesRef.current) {
      series.removePriceLine(line);
    }
    overlayLinesRef.current = [];

    if (!overlay.direction) return;

    const dirLabel = overlay.direction === "long" ? "LONG" : "SHORT";
    if (overlay.entry != null) {
      overlayLinesRef.current.push(
        series.createPriceLine({
          price: overlay.entry,
          color: "#3b82f6",
          lineWidth: 1,
          lineStyle: 2, // dashed
          axisLabelVisible: true,
          title: `${dirLabel} entry`,
        }),
      );
    }
    if (overlay.takeProfit != null) {
      overlayLinesRef.current.push(
        series.createPriceLine({
          price: overlay.takeProfit,
          color: "#10b981",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "TP",
        }),
      );
    }
    if (overlay.stopLoss != null) {
      overlayLinesRef.current.push(
        series.createPriceLine({
          price: overlay.stopLoss,
          color: "#ef4444",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "SL",
        }),
      );
    }
  }, [overlay]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--ghost)" }}>
        <span className="font-mono">{ticker} · {timeframe}</span>
        <span>{bars.length} bar{bars.length === 1 ? "" : "s"}</span>
      </div>
      <div
        ref={containerRef}
        style={{ width: "100%", height: 260, minHeight: 240 }}
      />
    </div>
  );
}
