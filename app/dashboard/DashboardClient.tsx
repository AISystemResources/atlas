"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { AtlasMcpConnectorCard } from "./AtlasMcpConnectorCard";
import { DjiHero } from "./portfolio/DjiHero";
import type { StrategyHealth } from "./portfolio/page";

const API_URL = "/api";


// ─── Tab: Dashboard (strategy-centric) ───────────────────────────────────────

export function PortfolioTab({
  strategies,
  pendingCount,
}: {
  tier: "free" | "pro";
  strategies: StrategyHealth[];
  pendingCount: number;
}) {
  return (
    <div className="flex flex-col pb-6" style={{ gap: 0 }}>
      {/* Sprint 110: monomaniac hero — one instrument, sized like a scoreboard. */}
      <DjiHero />

      <div style={{ height: 1, background: "var(--line)", margin: "6px 0 20px 0" }} />

      <BenchAggregate strategies={strategies} />

      <div style={{ height: 20 }} />

      <StrategyBench strategies={strategies} pendingCount={pendingCount} />
    </div>
  );
}

// ─── BenchAggregate ──────────────────────────────────────────────────────────
// Roll-up metrics across the active bench. Reads latest backtest per strategy.

function BenchAggregate({ strategies }: { strategies: StrategyHealth[] }) {
  const withBt = strategies.filter((s) => s.latestBacktest != null);
  const totalPts = withBt.reduce(
    (a, s) => a + (s.latestBacktest?.total_pnl_points ?? 0),
    0,
  );
  const totalTrades = withBt.reduce(
    (a, s) => a + (s.latestBacktest?.total_trades ?? 0),
    0,
  );
  const wrSum = withBt.reduce(
    (a, s) => a + (s.latestBacktest?.win_rate ?? 0),
    0,
  );
  const avgWr = withBt.length > 0 ? wrSum / withBt.length : null;
  const winners = withBt.filter(
    (s) => (s.latestBacktest?.total_pnl_points ?? 0) > 0,
  ).length;
  const losers = withBt.length - winners;
  const best = withBt.reduce<StrategyHealth | null>((best, s) => {
    const p = s.latestBacktest?.total_pnl_points ?? -Infinity;
    const bp = best?.latestBacktest?.total_pnl_points ?? -Infinity;
    return p > bp ? s : best;
  }, null);

  const ptsColor =
    totalPts > 0 ? "var(--bull)" : totalPts < 0 ? "var(--bear)" : "var(--ink)";

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 24,
        padding: "14px 0",
        borderTop: "1px solid var(--line)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <AggregateCell
        label="NET PTS"
        value={
          totalPts !== 0
            ? `${totalPts > 0 ? "+" : ""}${totalPts.toFixed(1)}`
            : "—"
        }
        valueColor={ptsColor}
        sub={`${withBt.length} strategies tested`}
      />
      <AggregateCell
        label="AVG WR"
        value={avgWr != null ? `${(avgWr * 100).toFixed(0)}%` : "—"}
        sub={`${totalTrades} trades total`}
      />
      <AggregateCell
        label="WIN / LOSE"
        value={`${winners} / ${losers}`}
        valueColor={
          winners > losers
            ? "var(--bull)"
            : winners < losers
              ? "var(--bear)"
              : "var(--ink)"
        }
        sub="by strategy PnL"
      />
      <AggregateCell
        label="TOP STRATEGY"
        value={best?.name ?? "—"}
        valueSmall
        sub={
          best?.latestBacktest?.total_pnl_points != null
            ? `+${best.latestBacktest.total_pnl_points.toFixed(1)} pts · v${best.version}`
            : "—"
        }
      />
    </div>
  );
}

function AggregateCell({
  label,
  value,
  valueColor,
  valueSmall,
  sub,
}: {
  label: string;
  value: string;
  valueColor?: string;
  valueSmall?: boolean;
  sub: string;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 4, minWidth: 0 }}>
      <span
        style={{
          fontSize: 10,
          fontFamily: "var(--font-jb)",
          letterSpacing: "0.08em",
          color: "var(--ghost)",
        }}
      >
        {label}
      </span>
      <span
        className="font-display num"
        style={{
          fontSize: valueSmall ? 15 : 22,
          fontWeight: 700,
          color: valueColor ?? "var(--ink)",
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 10,
          fontFamily: "var(--font-jb)",
          color: "var(--ghost)",
        }}
      >
        {sub}
      </span>
    </div>
  );
}

// ─── StrategyBench ───────────────────────────────────────────────────────────
// Compressed rows with a left-edge PnL stripe. Color is the *datum*, not the
// decoration — reading down the column gives a stripe-graph of profitability.

function StrategyBench({
  strategies,
  pendingCount,
}: {
  strategies: StrategyHealth[];
  pendingCount: number;
}) {
  const router = useRouter();
  const activeCount = strategies.length;

  return (
    <div>
      <SectionHeader
        label={`STRATEGY BENCH · ${activeCount} ACTIVE`}
        right={
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <span
                style={{
                  fontSize: 10, fontFamily: "var(--font-jb)", letterSpacing: "0.04em",
                  color: "var(--brand)", background: "rgba(200,16,46,0.08)",
                  border: "1px solid rgba(200,16,46,0.25)", borderRadius: 4,
                  padding: "2px 7px",
                }}
              >
                {pendingCount} pending
              </span>
            )}
            <button
              onClick={() => router.push("/dashboard/strategies")}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)",
                letterSpacing: "0.04em", textDecoration: "underline",
              }}
            >
              All →
            </button>
          </div>
        }
      />

      {activeCount === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-nunito)", fontSize: 13,
            color: "var(--ghost)", padding: "24px 0",
          }}
        >
          No active strategies.{" "}
          <button
            onClick={() => router.push("/dashboard/strategies")}
            style={{
              background: "none", border: "none", color: "var(--brand)",
              cursor: "pointer", fontSize: 13, fontFamily: "var(--font-nunito)",
              textDecoration: "underline",
            }}
          >
            Browse the library →
          </button>
        </div>
      ) : (
        <div className="flex flex-col">
          {strategies.map((s) => (
            <StrategyRow
              key={s.id}
              strategy={s}
              onClick={() => router.push(`/dashboard/strategies/${s.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StrategyRow({
  strategy,
  onClick,
}: {
  strategy: StrategyHealth;
  onClick: () => void;
}) {
  const wr = strategy.latestBacktest?.win_rate;
  const pnl = strategy.latestBacktest?.total_pnl_points;
  const trades = strategy.latestBacktest?.total_trades ?? 0;
  const pnlPos = (pnl ?? 0) >= 0;
  const stripeColor =
    pnl == null ? "var(--line2)" : pnlPos ? "var(--bull)" : "var(--bear)";

  return (
    <button
      onClick={onClick}
      className="text-left"
      style={{
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--line)",
        padding: "14px 0 14px 14px",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "3px 1fr",
        gap: 14,
        alignItems: "center",
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--elevated)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {/* left-edge PnL stripe */}
      <span
        aria-hidden
        style={{
          alignSelf: "stretch",
          width: 3,
          background: stripeColor,
          borderRadius: 1,
        }}
      />

      <div className="flex flex-col" style={{ gap: 4, minWidth: 0 }}>
        <div className="flex items-baseline gap-2" style={{ minWidth: 0 }}>
          <span
            className="font-display font-bold"
            style={{
              fontSize: 14,
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {strategy.name}
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-jb)",
              color: "var(--ghost)",
            }}
          >
            v{strategy.version}
          </span>
        </div>

        {strategy.latestBacktest ? (
          <div
            className="num flex items-baseline gap-3 flex-wrap"
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              color: "var(--dim)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span style={{ color: pnlPos ? "var(--bull)" : "var(--bear)", fontWeight: 600 }}>
              {pnl != null ? `${pnlPos ? "+" : ""}${pnl.toFixed(1)} pts` : "—"}
            </span>
            <span style={{ color: "var(--ghost)" }}>·</span>
            <span>{wr != null ? `${(wr * 100).toFixed(0)}% WR` : "—"}</span>
            <span style={{ color: "var(--ghost)" }}>·</span>
            <span>{trades}t</span>
          </div>
        ) : (
          <div
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              color: "var(--ghost)",
            }}
          >
            no backtest yet
          </div>
        )}
      </div>
    </button>
  );
}

function SectionHeader({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          letterSpacing: "0.08em",
          color: "var(--dim)",
        }}
      >
        {label}
      </span>
      {right}
    </div>
  );
}


// ─── Tab: Settings ────────────────────────────────────────────────────────────

function ManageBillingButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/v1/stripe/portal", { method: "POST" });
      const data = await res?.json() as { url?: string } | undefined;
      if (data?.url) window.location.href = data.url;
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        fontSize: 11, fontFamily: "var(--font-jb)",
        color: "var(--ghost)", background: "none",
        border: "1px solid var(--line)", borderRadius: 4,
        padding: "2px 8px", cursor: loading ? "default" : "pointer",
        letterSpacing: "0.04em",
      }}
    >
      {loading ? "Loading…" : "Manage billing"}
    </button>
  );
}

// Sprint 124: per-user PnL display ratio. Traders think in points, not
// fractional dollars. This card lets the user configure "1 point = $X" so
// the dollar echo on PnL surfaces (WHY panel, backtest detail, scoreboard)
// matches their instrument's contract size instead of Atlas's opaque default.
function DisplayPreferencesCard() {
  const PRESETS = [0.1, 0.5, 1, 5, 10] as const;
  const [value, setValue] = useState<number>(1);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [customInput, setCustomInput] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetchWithAuth("/api/v1/user/settings");
        if (!res || !alive) return;
        const json = (await res.json()) as { point_value_dollars?: number };
        const v = typeof json.point_value_dollars === "number"
          ? json.point_value_dollars
          : 1;
        setValue(v);
        setCustomInput(String(v));
      } catch {
        // fall through with default
      } finally {
        if (alive) setInitialLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  async function persist(next: number) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetchWithAuth("/api/v1/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ point_value_dollars: next }),
      });
      if (!res || !res.ok) {
        const body = res ? await res.json().catch(() => ({})) : {};
        setMsg((body as { error?: string }).error ?? "Save failed");
        return;
      }
      setMsg("Saved.");
      setTimeout(() => setMsg(null), 1800);
    } catch {
      setMsg("Network error");
    } finally {
      setSaving(false);
    }
  }

  function onPickPreset(preset: number) {
    setValue(preset);
    setCustomInput(String(preset));
    persist(preset);
  }

  function onCommitCustom() {
    const raw = Number(customInput);
    if (!Number.isFinite(raw) || raw <= 0) {
      setMsg("Enter a positive number.");
      return;
    }
    const clamped = Math.min(100, Math.max(0.01, raw));
    setValue(clamped);
    setCustomInput(String(clamped));
    persist(clamped);
  }

  const isPreset = PRESETS.includes(value as typeof PRESETS[number]);
  // Live example: a +100 pts win at the chosen ratio.
  const exampleDollars = (100 * value).toFixed(2);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "16px 18px",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div
        style={{
          color: "var(--ghost)",
          fontSize: 11,
          fontFamily: "var(--font-jb)",
          marginBottom: 4,
        }}
      >
        DISPLAY · POINT VALUE
      </div>
      <p
        style={{
          color: "var(--dim)",
          fontSize: 12,
          lineHeight: 1.55,
          marginBottom: 14,
        }}
      >
        PnL is shown in points. Set what 1 point is worth to you — the dollar
        echo on backtests, WHY panels, and the scoreboard multiplies by this.
      </p>

      <div className="flex flex-wrap gap-2" style={{ marginBottom: 12 }}>
        {PRESETS.map((p) => {
          const active = value === p;
          return (
            <button
              key={p}
              onClick={() => onPickPreset(p)}
              disabled={saving || !initialLoaded}
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 4,
                border: `1px solid ${active ? "var(--brand)" : "var(--line)"}`,
                background: active ? "var(--brand)" : "transparent",
                color: active ? "#fff" : "var(--ink)",
                cursor: saving ? "default" : "pointer",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              1pt = ${p.toFixed(p < 1 ? 2 : 0)}
            </button>
          );
        })}
        <div
          className="flex items-center gap-2"
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 12,
            padding: "4px 8px",
            border: `1px solid ${isPreset ? "var(--line)" : "var(--brand)"}`,
            borderRadius: 4,
            background: isPreset ? "transparent" : "rgba(200,16,46,0.06)",
          }}
        >
          <span style={{ color: "var(--ghost)", fontSize: 11 }}>custom $</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max="100"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onBlur={onCommitCustom}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={saving || !initialLoaded}
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              width: 68,
              padding: "4px 6px",
              background: "transparent",
              border: "1px solid var(--line)",
              borderRadius: 3,
              color: "var(--ink)",
              fontVariantNumeric: "tabular-nums",
            }}
          />
        </div>
      </div>

      <div
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          color: "var(--ghost)",
          letterSpacing: "0.02em",
        }}
      >
        Example: <span style={{ color: "var(--bull)" }}>+100.0 pts</span>
        {" "}(≈{" "}
        <span style={{ color: "var(--bull)" }}>+${exampleDollars}</span>
        {" "}at current setting). Max $100 per point.
      </div>

      {msg && (
        <div
          style={{
            marginTop: 8,
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: msg === "Saved." ? "var(--bull)" : "var(--bear)",
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

export function SettingsTab({ tier }: { tier: "free" | "pro" }) {
  const tierColor = tier === "pro" ? "var(--tier-pro)" : "var(--dim)";
  const isPro = tier === "pro";

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* Tier badge + billing management */}
      <div className="flex items-center justify-between gap-2">
        <span style={{
          fontSize: 10,
          fontFamily: "var(--font-jb)",
          color: tierColor,
          border: `1px solid ${tierColor}`,
          padding: "2px 8px",
          borderRadius: 4,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
        }}>
          {tier}
        </span>
        {isPro && <ManageBillingButton />}
      </div>

      {/* How Atlas works — the architecture story, not a list of dependencies. */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", boxShadow: "var(--card-shadow)" }}>
        <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 12 }}>
          HOW ATLAS WORKS
        </div>
        <ul className="flex flex-col gap-3" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <li className="flex gap-3">
            <span style={{ color: "var(--bull)", fontSize: 12, fontFamily: "var(--font-jb)", flexShrink: 0, marginTop: 2 }}>·</span>
            <span style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.5 }}>
              <strong>No server-side AI.</strong>{" "}
              <span style={{ color: "var(--dim)" }}>
                All reasoning happens in your connected MCP client (Claude / ChatGPT).
                The platform itself runs zero LLM calls.
              </span>
            </span>
          </li>
          <li className="flex gap-3">
            <span style={{ color: "var(--bull)", fontSize: 12, fontFamily: "var(--font-jb)", flexShrink: 0, marginTop: 2 }}>·</span>
            <span style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.5 }}>
              <strong>Backtests are deterministic.</strong>{" "}
              <span style={{ color: "var(--dim)" }}>
                Same strategy, same date range, same broker profile → same result every time.
                No randomness, no model temperature noise.
              </span>
            </span>
          </li>
          <li className="flex gap-3">
            <span style={{ color: "var(--bull)", fontSize: 12, fontFamily: "var(--font-jb)", flexShrink: 0, marginTop: 2 }}>·</span>
            <span style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.5 }}>
              <strong>Your wallet signs every trade.</strong>{" "}
              <span style={{ color: "var(--dim)" }}>
                Atlas holds no keys, signs no transactions. The EBC matrix lives at execution
                only — backtest is deterministic and not modelled by it.
              </span>
            </span>
          </li>
        </ul>
      </div>

      {/* Data sources — what the platform actually uses, factually. */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", boxShadow: "var(--card-shadow)" }}>
        <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 12 }}>
          DATA SOURCES
        </div>
        <div className="flex flex-col gap-2">
          {[
            ["OHLCV bars", "Yahoo Finance · per-day cache"],
            ["Research papers", "arXiv q-fin.TR · daily fetch"],
            ["Live signal evaluation", "deterministic, on-demand"],
            ["Execution venue", "Base mainnet · gTrade DIA pair"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span style={{ color: "var(--ghost)", fontSize: 12, fontFamily: "var(--font-jb)" }}>{k}</span>
              <span style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-jb)" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sprint 124: Display preferences — point-to-dollar ratio for PnL. */}
      <DisplayPreferencesCard />

      {/* MCP connector — Pro only. Free tier sees a CTA. */}
      <div style={{ marginBottom: 32 }}>
        {isPro ? (
          <AtlasMcpConnectorCard />
        ) : (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "20px 22px",
              boxShadow: "var(--card-shadow)",
            }}
          >
            <div style={{ color: "var(--ghost)", fontSize: 11, fontFamily: "var(--font-jb)", marginBottom: 10 }}>
              CONNECT MCP CLIENT · PRO
            </div>
            <p style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
              Atlas exposes <strong>17 MCP tools</strong> (10 read-only, 7 writes — zero destructive)
              that let you author and improve strategies using your own LLM via Claude Desktop or ChatGPT.
              You bring the model; Atlas stays deterministic.
            </p>
            <a
              href="/pricing"
              style={{
                display: "inline-block",
                background: "var(--brand)",
                color: "#fff",
                fontSize: 12,
                fontFamily: "var(--font-jb)",
                padding: "8px 16px",
                borderRadius: 6,
                textDecoration: "none",
                letterSpacing: "0.04em",
              }}
            >
              Upgrade to Pro
            </a>
          </div>
        )}
      </div>
    </div>
  );
}


