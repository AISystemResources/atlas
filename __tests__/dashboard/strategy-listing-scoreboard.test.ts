/**
 * Sprint 121: recency helper on the strategy listing. Guards the buckets that
 * drive the recency-chip colour tone (fresh / aged / stale) so a UI refactor
 * doesn't silently flip a v4 from-yesterday into a "stale" red.
 */

import { recencyLabel } from "@/app/dashboard/strategies/StrategiesClient";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

describe("recencyLabel", () => {
  it("labels today / 1d / a-few-days as fresh", () => {
    expect(recencyLabel(isoDaysAgo(0))).toEqual({ label: "today", tone: "fresh" });
    expect(recencyLabel(isoDaysAgo(1))).toEqual({ label: "1d ago", tone: "fresh" });
    expect(recencyLabel(isoDaysAgo(3))).toEqual({ label: "3d ago", tone: "fresh" });
    expect(recencyLabel(isoDaysAgo(6))).toEqual({ label: "6d ago", tone: "fresh" });
  });

  it("labels 1–4 weeks as aged", () => {
    expect(recencyLabel(isoDaysAgo(7))).toEqual({ label: "7d ago", tone: "aged" });
    expect(recencyLabel(isoDaysAgo(15))).toEqual({ label: "15d ago", tone: "aged" });
    expect(recencyLabel(isoDaysAgo(29))).toEqual({ label: "29d ago", tone: "aged" });
  });

  it("labels 30–89 days as stale (days form)", () => {
    expect(recencyLabel(isoDaysAgo(30))).toEqual({ label: "30d ago", tone: "stale" });
    expect(recencyLabel(isoDaysAgo(60))).toEqual({ label: "60d ago", tone: "stale" });
    expect(recencyLabel(isoDaysAgo(89))).toEqual({ label: "89d ago", tone: "stale" });
  });

  it("labels 90+ days as stale (months form)", () => {
    expect(recencyLabel(isoDaysAgo(90))).toEqual({ label: "3mo ago", tone: "stale" });
    expect(recencyLabel(isoDaysAgo(180))).toEqual({ label: "6mo ago", tone: "stale" });
  });
});
