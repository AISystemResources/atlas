"use client";

/**
 * Strategy detail (Sprint 113 rewrite).
 *
 * The page reads as a trader's cheat-sheet, not a marketing page. Vertical order
 * is honest to how a trader decides "should I run this?":
 *   1. Identity strip — name, ticker, timeframe, direction, actions
 *   2. Pending proposals (owner-only, action-required)
 *   3. PROOF — recent backtests hoisted from the bottom, with mini bars
 *   4. PLAYBOOK — 6 numbered stages in trade-lifecycle order
 *   5. TUNABLE — compact parameter table
 *   6. PROVENANCE — origin verb + lineage + tags
 *   7. SHARE (owner-only)
 *
 * The AI-authored description prose is gone; the playbook IS the summary.
 * Emoji card headers are gone. Coloured decorative borders are gone.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { RenderedSections } from "@/lib/strategies/render-rules";
import type { TunableParameter } from "@/lib/strategies/types";

// Sprint 148: server-resolved current value of the tunable (walked from body
// at build time). Kept optional at type-level for legacy call sites.
export type TunableWithValue = TunableParameter & {
  current_value?: number | string | null;
};

export interface VersionFamilyEntry {
  id: string;
  version: number;
  status: string;
  created_at: string;
  is_current: boolean;
  /** Sprint 120: latest backtest PnL for this version's dot on the timeline. */
  latest_pnl_points: number | null;
}

// Sprint 120: the WHY panel — the insight that promoted the parent into
// this version. v1 has no promotionInsight (origin story is handled from
// paper/fork metadata already on the detail).
export interface PromotionInsightChange {
  name: string;
  current_value: number;
  applied_value: number;
  original_proposed_value: number;
  was_clamped: boolean;
  reason: string;
}

export interface PromotionInsight {
  insight_id: string;
  backtest_id: string;
  model: string;
  rationale: string | null;
  winning_pattern: string | null;
  losing_pattern: string | null;
  created_at: string;
  changes: PromotionInsightChange[];
  // Sprint 120b: HONEST delta from the server-run forward A/B on the same
  // bars. Replaces the misleading raw v(n-1)-bt vs v(n)-bt delta that Sprint
  // 120 shipped, which mixed windows and units. Null when no A/B was run
  // (e.g., recommendation was 'keep' with no proposed_changes).
  ab_status: "ok" | "no_changes" | "insufficient_forward_data" | null;
  ab_delta_dollars: number | null;
  /** Sprint 124: points-first display. treatment.total_pnl_points − control.total_pnl_points. */
  ab_delta_points: number | null;
  ab_window: { start_date: string; end_date: string } | null;
  // Sprint 120b: every JSON path where the current version's body differs
  // from the parent's. Used to expand PLAYBOOK stage tinting so
  // SESSION/weekday/entry-condition edits are visible, not just the tunable
  // parameters the LLM declared as proposed_changes.
  body_change_paths: string[][];
}

// Sprint 137: structural-promotion "why" view.
// promote_with_body_change stamps changes_summary + rationale into the new
// row's description (no ticket_backtest_insights row is created). We parse
// that description server-side and hand the pieces here so the WHY panel
// can render the same "what changed and why" story it does for ratchet
// promotions.
export interface StructuralPromotionView {
  change_summary: string | null;
  rationale: string | null;
  model: string | null;
  created_at: string;
  body_change_paths: string[][];
}

export interface BacktestListEntry {
  id: string;
  ticker: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_trades: number;
  win_rate: number | null;
  total_pnl_points: number | null;
  created_at: string;
}

export interface StrategyShareEntry {
  email: string;
  granted_at: string;
}

export interface StrategyDetail {
  id: string;
  name: string;
  version: number;
  description: string;
  status: "draft" | "active" | "archived";
  visibility: "private" | "unlisted" | "public";
  is_mine: boolean;
  is_shared_with_me: boolean;
  owner_label: string;
  forked_from_id: string | null;
  forked_from_label: string | null;
  parent_version_id: string | null;
  is_my_scalper: boolean;
  created_at: string;
  rendered: RenderedSections;
  tunable_parameters: TunableWithValue[];
  timeframe: string;
  direction: string;
  ticker: string | null;
  tags: string[];
  paper_extracted: boolean;
  paper_source_url: string | null;
  // Sprint 122: N:N paper links. Origin paper first, then convergent
  // inspirations added later via link_paper_to_strategy.
  linked_papers: Array<{
    paper_id: string;
    title: string;
    source_url: string | null;
    inspiration_note: string | null;
    added_by_model: string | null;
    is_origin: boolean;
  }>;
  shares: StrategyShareEntry[];
  // Sprint 109 Phase 3: is this strategy in the caller's watched_strategies?
  watched_by_me: boolean;
}

export function StrategyDetailClient({
  detail,
  family,
  backtests,
  promotionInsight,
  structuralPromotion,
  pointValue,
  prevRendered,
}: {
  detail: StrategyDetail;
  family: VersionFamilyEntry[];
  backtests: BacktestListEntry[];
  promotionInsight: PromotionInsight | null;
  /** Sprint 137: parsed from the description when a body-change promotion
      is the source of this version (no distillation-insight row exists). */
  structuralPromotion: StructuralPromotionView | null;
  /** Sprint 124: user's point-to-dollar ratio for the WHY panel's dollar echo. */
  pointValue: number;
  /** Sprint 150: parent-version rules rendered the same way. Enables inline
      old→new diffs on changed rule lines. Null for v1 or unreadable parents. */
  prevRendered?: RenderedSections | null;
}) {
  const router = useRouter();
  const [forkBusy, setForkBusy] = useState(false);
  const [scalperBusy, setScalperBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  // Sprint 109 Phase 3: watch toggle. Optimistic local state; server call
  // via /api/v1/watched-strategies.
  const [watched, setWatched] = useState(detail.watched_by_me);
  const [watchBusy, setWatchBusy] = useState(false);

  async function onToggleWatch() {
    setWatchBusy(true);
    setActionMsg(null);
    const prev = watched;
    setWatched(!prev);
    try {
      const res = await (prev
        ? fetch(
            `/api/v1/watched-strategies?strategy_id=${encodeURIComponent(detail.id)}`,
            { method: "DELETE" },
          )
        : fetch("/api/v1/watched-strategies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ strategy_id: detail.id }),
          }));
      if (!res.ok) {
        setWatched(prev); // revert
        const j = (await res.json()) as { error?: string };
        setActionMsg(j.error ?? "Watch toggle failed");
      }
    } catch {
      setWatched(prev);
      setActionMsg("Network error");
    } finally {
      setWatchBusy(false);
    }
  }


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
    <div className="mx-auto pb-12" style={{ maxWidth: 1100, color: "var(--ink)" }}>
      {/* Breadcrumb */}
      <div className="mb-5" style={{ paddingTop: 8 }}>
        <Link
          href="/dashboard/strategies"
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--ghost)",
            textDecoration: "none",
            letterSpacing: "0.04em",
          }}
        >
          ← All strategies
        </Link>
      </div>

      {/* Identity strip */}
      <IdentityStrip
        detail={detail}
        watched={watched}
        watchBusy={watchBusy}
        forkBusy={forkBusy}
        scalperBusy={scalperBusy}
        onToggleWatch={onToggleWatch}
        onFork={onFork}
        onUseAsScalper={onUseAsScalper}
      />

      {actionMsg && (
        <p
          className="mb-6"
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 12,
            color: "var(--bull)",
          }}
        >
          {actionMsg}
        </p>
      )}

      {/* Sprint 144: reordered — VERSIONS → PROOF (collapsed) → PENDING →
          WHY | PLAYBOOK (side-by-side) → TUNABLE (collapsed) → PROVENANCE →
          VISIBILITY/SHARE. Reasoning: proof is the buyer signal (put it high
          but tight); the WHY/PLAYBOOK pairing lets a reader see the rationale
          and the mechanics without scrolling; TUNABLE/INDICATORS are
          reference material and belong below the fold. */}
      {family.length > 1 && (
        <VersionTimeline family={family} />
      )}

      <ProofSection backtests={backtests} />

      {/* Sprint 147: PLAYBOOK | WHY side-by-side. Playbook is the anchor
          (v1 has no WHY), so it lives on the left and gets the wider column;
          WHY sits on the right when it exists. Playbook stages tint on
          changed rows so WHY doesn't need its own what-changed column. */}
      {(promotionInsight || structuralPromotion) ? (
        <div
          className="grid gap-8 mb-10"
          style={{ gridTemplateColumns: "minmax(0, 7fr) minmax(0, 5fr)" }}
        >
          <div className="min-w-0">
            <RulesSection
              rendered={detail.rendered}
              prevRendered={prevRendered ?? null}
              timeframe={detail.timeframe}
              direction={detail.direction}
              tunables={detail.tunable_parameters}
              changedStageNumbers={
                promotionInsight
                  ? computeChangedStageNumbers(
                      promotionInsight.changes,
                      detail.tunable_parameters,
                      promotionInsight.body_change_paths,
                    )
                  : structuralPromotion
                    ? computeChangedStageNumbers(
                        [],
                        detail.tunable_parameters,
                        structuralPromotion.body_change_paths,
                      )
                    : new Set()
              }
            />
          </div>
          <div className="min-w-0">
            {promotionInsight ? (
              <WhyPanel
                insight={promotionInsight}
                currentVersion={detail.version}
                tunables={detail.tunable_parameters}
                pointValue={pointValue}
              />
            ) : structuralPromotion ? (
              <StructuralWhyPanel
                promotion={structuralPromotion}
                currentVersion={detail.version}
                compact
              />
            ) : null}
          </div>
        </div>
      ) : (
        <RulesSection
          rendered={detail.rendered}
          prevRendered={null}
          timeframe={detail.timeframe}
          direction={detail.direction}
          tunables={detail.tunable_parameters}
          changedStageNumbers={new Set()}
        />
      )}

    </div>
  );
}

/**
 * Sprint 129: publicize toggle. Three visibility states:
 *   - Private (default): only you can see it
 *   - Unlisted: anyone with the link can view; not in the public library
 *   - Public: appears on the Public tab and can be forked by anyone
 * PATCH /api/v1/ticket-logics/[id] persists the change.
 */
function VisibilityPanel({
  strategyId,
  initialVisibility,
}: {
  strategyId: string;
  initialVisibility: "private" | "unlisted" | "public";
}) {
  const [value, setValue] = useState<"private" | "unlisted" | "public">(
    initialVisibility,
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const options: {
    key: "private" | "unlisted" | "public";
    label: string;
    hint: string;
  }[] = [
    { key: "private", label: "Private", hint: "Only you" },
    { key: "unlisted", label: "Unlisted", hint: "Anyone with the link" },
    { key: "public", label: "Public", hint: "Listed on the Public tab · forkable" },
  ];

  async function onPick(next: "private" | "unlisted" | "public") {
    if (next === value) return;
    setBusy(true);
    setMsg(null);
    const prev = value;
    setValue(next);
    try {
      const res = await fetch(`/api/v1/ticket-logics/${strategyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) {
        setValue(prev);
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg(j.error ?? `HTTP ${res.status}`);
      } else {
        setMsg("Updated.");
        setTimeout(() => setMsg(null), 2000);
      }
    } catch {
      setValue(prev);
      setMsg("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2 flex-wrap" style={{ marginBottom: 8 }}>
        {options.map((o) => {
          const active = value === o.key;
          return (
            <button
              key={o.key}
              onClick={() => onPick(o.key)}
              disabled={busy}
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 4,
                border: `1px solid ${active ? "var(--brand)" : "var(--line)"}`,
                background: active ? "var(--brand)" : "transparent",
                color: active ? "#fff" : "var(--ink)",
                cursor: busy ? "default" : "pointer",
                letterSpacing: "0.02em",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          color: "var(--ghost)",
          letterSpacing: "0.02em",
        }}
      >
        {options.find((o) => o.key === value)?.hint}
      </div>
      {msg && (
        <div
          style={{
            marginTop: 6,
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: msg === "Updated." ? "var(--bull)" : "var(--bear)",
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}


/**
 * Sprint 079C.1: visual differentiator for the reviewer story.
 * Sprint 123: Groq/Llama/Gemini branches removed — Atlas is Claude/MCP only
 * post-Sprint 095. Legacy insights from those providers still exist in
 * ticket_backtest_insights but render without a distinctive chip; their
 * model string appears as neutral text so historical trace remains honest
 * without visually privileging a decommissioned provider.
 */
function ModelChip({ model }: { model: string }) {
  const lower = model.toLowerCase();
  if (lower.includes("claude")) {
    const m = lower.match(/claude-(opus|sonnet|haiku)-?[\d.]*/);
    const label = m ? `claude-${m[1]}` : "claude";
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide"
        style={{
          background: "var(--brand-bg, var(--elevated))",
          color: "var(--brand)",
        }}
        title={model}
      >
        {label}
      </span>
    );
  }
  // Legacy: any non-Claude insight renders as neutral text so it doesn't
  // compete for attention. Retained here (not hidden) so v2+ history that
  // was legitimately produced by a decommissioned engine still shows a
  // truthful attribution.
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide"
      style={{ background: "var(--elevated)", color: "var(--ghost)" }}
      title={`${model} · legacy provider (pre-Sprint 095)`}
    >
      legacy
    </span>
  );
}

// ── Sprint 120: version-diff navigator + WHY panel ──────────────────────────

/**
 * Map a tunable's path prefix to a playbook stage number (01–06). The playbook
 * has 6 numbered stages in trade-lifecycle order:
 *   01 SESSION, 02 SIGNAL BAR, 03 ENTRY, 04 STOP, 05 TARGET, 06 EXIT.
 * Tunable paths encode which JSON field the parameter tunes; the first 1–2
 * elements are enough to decide which stage the change lives in.
 */
export function tunablePathToStageNumber(
  path: string[] | undefined,
): string | null {
  if (!path || path.length === 0) return null;
  const [p0, p1] = path;
  // 01 SESSION covers the session window itself + valid_weekdays. Sprint
  // 120b: valid_weekdays lives at the top level; when a promotion changes
  // it we still want stage 01 to light up.
  if (p0 === "session_window") return "01";
  if (p0 === "valid_weekdays") return "01";
  if (p0 === "timezone") return "01";
  // 02 SIGNAL BAR — indicator definitions + entry.conditions predicate
  // trees. Entry conditions are the "when do we call this bar a signal"
  // logic (RSI cross, KC touch, close vs EMA, …).
  if (p0 === "indicators") return "02";
  if (p0 === "entry" && p1 === "conditions") return "02";
  // 03 ENTRY — entry price expression + sizing.
  if (p0 === "computed") return "03";
  if (p0 === "entry") return "03";
  if (p0 === "exit") {
    if (p1 === "stop_loss") return "04";
    if (p1 === "take_profit") return "05";
    if (p1 === "time_stop" || p1 === "exit_conditions") return "06";
    if (p1 === "stages") return "06";
    return "06";
  }
  if (p0 === "sl_method") return "04";
  return null;
}

export function computeChangedStageNumbers(
  changes: PromotionInsightChange[],
  tunables: TunableWithValue[],
  bodyChangePaths: string[][] = [],
): Set<string> {
  const byName = new Map(tunables.map((t) => [t.name, t.path]));
  const out = new Set<string>();
  // Declared tunable changes from the LLM's proposed_changes.
  for (const c of changes) {
    const path = byName.get(c.name);
    const stage = tunablePathToStageNumber(path);
    if (stage) out.add(stage);
  }
  // Sprint 120b: any other body-level differences vs the parent. A promotion
  // can edit the body beyond the declared tunables (e.g., a session-window
  // shift, weekday narrowing, entry-condition rewrite). Those must light up
  // too or the PLAYBOOK tint lies by omission.
  for (const path of bodyChangePaths) {
    const stage = tunablePathToStageNumber(path);
    if (stage) out.add(stage);
  }
  return out;
}

function VersionTimeline({ family }: { family: VersionFamilyEntry[] }) {
  return (
    <section className="mb-8">
      <SectionRule label="VERSIONS" note={`${family.length} shipped`} />
      <div
        className="flex items-start"
        style={{
          gap: 0,
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {family.map((v, i) => {
          const pnl = v.latest_pnl_points;
          const pnlColor =
            pnl == null
              ? "var(--ghost)"
              : pnl >= 0
                ? "var(--bull)"
                : "var(--bear)";
          const showConnector = i < family.length - 1;
          return (
            <div
              key={v.id}
              className="flex items-center"
              style={{ flex: showConnector ? 1 : "0 0 auto", minWidth: 0 }}
            >
              <div
                className="flex flex-col items-center"
                style={{ minWidth: 68 }}
              >
                <Link
                  href={`/dashboard/strategies/${v.id}`}
                  aria-label={`v${v.version}`}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: v.is_current ? "var(--ink)" : "transparent",
                    border: `2px solid ${v.is_current ? "var(--ink)" : "var(--dim)"}`,
                    display: "block",
                    textDecoration: "none",
                  }}
                />
                <span
                  style={{
                    marginTop: 6,
                    color: v.is_current ? "var(--ink)" : "var(--dim)",
                    fontWeight: v.is_current ? 700 : 500,
                    letterSpacing: "0.02em",
                  }}
                >
                  v{v.version}
                </span>
                <span
                  style={{
                    marginTop: 2,
                    color: pnlColor,
                    fontSize: 10,
                    letterSpacing: "0.02em",
                  }}
                >
                  {pnl == null
                    ? "no bt"
                    : `${pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(1)}`}
                </span>
              </div>
              {showConnector && (
                <div
                  aria-hidden
                  style={{
                    flex: 1,
                    height: 1,
                    background: "var(--line2)",
                    minWidth: 12,
                    // Align the connector with the vertical center of the dot
                    // (dot is 14px; label + pnl sit below → nudge up).
                    marginTop: -22,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WhyPanel({
  insight,
  currentVersion,
  tunables,
  pointValue,
}: {
  insight: PromotionInsight;
  currentVersion: number;
  tunables: TunableWithValue[];
  pointValue: number;
}) {
  const parentV = currentVersion - 1;
  const pathByName = new Map(tunables.map((t) => [t.name, t.path] as const));

  return (
    <section className="mb-10">
      <SectionRule
        label={`WHY v${currentVersion}`}
        note={`from v${parentV} · ${timeAgo(insight.created_at)}`}
      />
      <div
        className="flex items-center gap-3 flex-wrap"
        style={{ marginBottom: 16 }}
      >
        <ModelChip model={insight.model} />
        <AbDeltaChip insight={insight} pointValue={pointValue} />
      </div>

      {/* Sprint 147: [CHANGES] top — the concrete diffs.
          [REASONS] bottom — the LLM's narrative for why. Two sub-headers so
          a reader can skim "what got moved" before diving into "why". */}
      <SubHeader label="CHANGES" />
      {insight.changes.length > 0 ? (
        <div className="flex flex-col" style={{ gap: 6, marginBottom: 20 }}>
          {insight.changes.map((c) => {
            const stage = tunablePathToStageNumber(pathByName.get(c.name));
            return (
              <div
                key={c.name}
                className="grid items-baseline"
                style={{
                  gridTemplateColumns: "36px minmax(0, 200px) minmax(0, 1fr)",
                  columnGap: 14,
                  padding: "8px 0",
                  borderBottom: "1px solid rgba(141, 164, 178, 0.14)",
                  fontFamily: "var(--font-jb)",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span style={{ color: "var(--ghost)" }}>{stage ?? "—"}</span>
                <span style={{ color: "var(--ink)" }}>{c.name}</span>
                <span style={{ color: "var(--dim)" }}>
                  {c.current_value}
                  <span style={{ color: "var(--ghost)", margin: "0 6px" }}>
                    →
                  </span>
                  <span style={{ color: "var(--brand)", fontWeight: 600 }}>
                    {c.applied_value}
                  </span>
                  {c.was_clamped && (
                    <span
                      style={{ color: "var(--ghost)", marginLeft: 10, fontSize: 11 }}
                    >
                      (proposed {c.original_proposed_value}; clamped)
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 12,
            color: "var(--ghost)",
            fontStyle: "italic",
            marginBottom: 20,
          }}
        >
          No parameter changes — this promotion was cosmetic (metadata only).
        </p>
      )}

      {insight.rationale && (
        <>
          <SubHeader label="REASONS" />
          <p
            style={{
              fontFamily: "var(--font-nunito)",
              fontSize: 14,
              lineHeight: 1.55,
              color: "var(--ink)",
            }}
          >
            {insight.rationale}
          </p>
        </>
      )}
    </section>
  );
}

// Sprint 147: small sub-section header for the [CHANGES] / [REASONS] split
// inside WHY. Lighter weight than SectionRule so the panel keeps its own
// visual hierarchy above the sub-headers.
function SubHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-jb)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.14em",
        color: "var(--ghost)",
        marginBottom: 10,
      }}
    >
      {label}
    </div>
  );
}

// Sprint 137: WHY panel for structural (body-change) promotions.
// Sprint 139: side-by-side layout (description | what changed) with plain
// English translations of the JSON body paths for non-technical readers.
function StructuralWhyPanel({
  promotion,
  currentVersion,
  compact,
}: {
  promotion: StructuralPromotionView;
  currentVersion: number;
  /** Sprint 144: when true, hide the internal "WHAT CHANGED" column — used
      when this panel sits next to Playbook, which tints changed stages. */
  compact?: boolean;
}) {
  const parentV = currentVersion - 1;
  const changesInPlainEnglish = promotion.body_change_paths
    .map(humanizeBodyPath)
    .filter((s, i, arr) => arr.indexOf(s) === i);
  // Sprint 149: in compact mode we normally suppress the body list because
  // RULES tints the changed stages. BUT when there's no change_summary either
  // (fallback path — hand-written descriptions on older v2+ rows), the CHANGES
  // section would render empty. In that case, fall back to showing the body
  // list so the reader always sees SOMETHING under CHANGES.
  const showBodyList =
    changesInPlainEnglish.length > 0 &&
    (!compact || !promotion.change_summary);
  const hasChanges = promotion.change_summary || showBodyList;

  return (
    <section className="mb-10">
      <SectionRule
        label={`WHY v${currentVersion}`}
        note={`from v${parentV} · ${timeAgo(promotion.created_at)}`}
      />
      <div
        className="flex items-center gap-3 flex-wrap"
        style={{ marginBottom: 16 }}
      >
        {promotion.model && <ModelChip model={promotion.model} />}
        <span
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 10,
            letterSpacing: "0.08em",
            color: "var(--brand)",
            background: "rgba(200,16,46,0.08)",
            border: "1px solid rgba(200,16,46,0.25)",
            padding: "2px 7px",
            borderRadius: 4,
          }}
        >
          STRUCTURAL
        </span>
      </div>

      {hasChanges && (
        <>
          <SubHeader label="CHANGES" />
          {promotion.change_summary && (
            <p
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink)",
                marginBottom: showBodyList ? 12 : 20,
                lineHeight: 1.5,
              }}
            >
              {promotion.change_summary}
            </p>
          )}
          {showBodyList && (
            <ul
              className="flex flex-col"
              style={{
                gap: 0,
                paddingLeft: 0,
                listStyle: "none",
                marginBottom: 20,
              }}
            >
              {changesInPlainEnglish.slice(0, 14).map((label, i) => (
                <li
                  key={i}
                  style={{
                    fontFamily: "var(--font-nunito)",
                    fontSize: 13,
                    color: "var(--ink)",
                    padding: "7px 0",
                    borderBottom: "1px solid rgba(141, 164, 178, 0.14)",
                  }}
                >
                  {label}
                </li>
              ))}
              {changesInPlainEnglish.length > 14 && (
                <li
                  style={{
                    fontFamily: "var(--font-jb)",
                    fontSize: 11,
                    color: "var(--ghost)",
                    fontStyle: "italic",
                    paddingTop: 6,
                  }}
                >
                  +{changesInPlainEnglish.length - 14} more…
                </li>
              )}
            </ul>
          )}
        </>
      )}

      {promotion.rationale && (
        <>
          <SubHeader label="REASONS" />
          <p
            style={{
              fontFamily: "var(--font-nunito)",
              fontSize: 14,
              lineHeight: 1.55,
              color: "var(--ink)",
            }}
          >
            {promotion.rationale}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Sprint 139: turn a JSON body-diff path into a plain-English label a finance
 * user with zero coding background can parse. Removes array indices and
 * meta-fields (like tunable_parameters.N.description) that are noise to
 * traders. Collapses multiple paths that describe the same concept.
 */
function humanizeBodyPath(path: string[]): string {
  const p = path;
  const head = p[0];
  const tail = p[p.length - 1];

  // Session window edits.
  if (head === "session_window") {
    if (tail === "start") return "Session start time";
    if (tail === "end") return "Session end time";
    if (tail === "timezone") return "Session timezone";
    return "Trading session window";
  }

  // Weekday allow-list.
  if (head === "valid_weekdays") return "Trading days of the week";

  // Direction / timeframe / universe.
  if (head === "direction") return "Trade direction (long/short)";
  if (head === "timeframe") return "Bar timeframe";
  if (head === "universe") return "Ticker universe";

  // Indicators added / renamed / retuned.
  if (head === "indicators") {
    // e.g. ["indicators", "2", "params", "period"]
    if (p.length === 1) return "Set of indicators";
    if (tail === "period") return "Indicator lookback period";
    if (tail === "multiplier") return "Indicator multiplier";
    if (tail === "id" || tail === "type") return "Added or renamed an indicator";
    if (p.includes("params")) return "Indicator settings";
    return "Set of indicators";
  }

  // Entry conditions.
  if (head === "entry") {
    if (p[1] === "conditions") return "Entry conditions (rules to fire a trade)";
    if (p[1] === "sizing") {
      if (tail === "value") return "Position size (dollars per trade)";
      if (tail === "method") return "Position sizing method";
      return "Position sizing";
    }
    return "Entry logic";
  }

  // Exit logic.
  if (head === "exit") {
    if (p[1] === "stop_loss") {
      if (tail === "value") return "Stop-loss distance";
      return "Stop-loss placement";
    }
    if (p[1] === "take_profit") {
      if (tail === "value") return "Take-profit distance";
      return "Take-profit placement";
    }
    if (p[1] === "time_stop") return "Time-stop rule (e.g. end of day)";
    if (p[1] === "sl_method") {
      if (tail === "value") return "Stop-loss ATR multiple";
      return "Stop-loss method";
    }
    return "Exit logic";
  }

  // Computed helpers (entry price, thresholds).
  if (head === "computed") {
    const which = p[1];
    if (which === "entry_price") return "Entry price formula";
    if (which === "signal_bar_width") return "Signal-bar width formula";
    if (which === "width_threshold") return "Wide-bar filter threshold";
    if (which === "vol_regime_ceiling") return "Calm-vol regime ceiling";
    if (which === "vol_regime_floor") return "Vol-elevation regime floor";
    if (which === "body_threshold") return "Body-magnitude threshold";
    if (which === "magnitude_threshold") return "Overreaction magnitude threshold";
    if (which === "deep_above_fair") return "Deep-above-fair threshold";
    if (which === "deep_below_fair") return "Deep-below-fair threshold";
    if (which === "cumulative_body_mag") return "Cumulative body-magnitude formula";
    if (which === "bar_body") return "Bar body-size formula";
    if (which) return `Formula: ${which.replace(/_/g, " ")}`;
    return "Derived formulas";
  }

  // Tunable parameter metadata — usually noise.
  if (head === "tunable_parameters") {
    if (tail === "description") return "Parameter descriptions (docs only)";
    if (tail === "value") return "Default parameter value";
    if (tail === "min" || tail === "max") return "Parameter bounds";
    if (tail === "name") return "Renamed a tunable parameter";
    if (tail === "path") return "Repointed a tunable parameter";
    return "Tunable parameter metadata";
  }

  // Fallback: title-case the last segment.
  const last = tail || "unknown";
  return last.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Sprint 120b: chip showing the forward-A/B result — the honest number.
 *
 * The forward A/B runs a control (parent body) against a treatment (parent
 * body + this insight's proposed_changes) over a fresh out-of-sample window
 * right after the source backtest ended. Both arms see the SAME bars, so
 * the delta cleanly measures what the LLM's proposal earned.
 *
 * The earlier Sprint 120 chip compared "v(n-1)'s latest bt" to "v(n)'s latest
 * bt" — those can be on unrelated windows, producing points-sums that look
 * 100–1000× larger than the LLM's actual effect (the rationale is talking
 * about a $-scale improvement inside a single controlled test).
 */
function AbDeltaChip({
  insight,
  pointValue,
}: {
  insight: PromotionInsight;
  pointValue: number;
}) {
  const style: React.CSSProperties = {
    fontFamily: "var(--font-jb)",
    fontSize: 12,
    color: "var(--dim)",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.02em",
  };
  if (insight.ab_status === null) {
    return (
      <span
        style={{ ...style, color: "var(--ghost)" }}
        title="No A/B row on this insight — the promotion predates the forward-A/B harness or was applied before it could run."
      >
        A/B · not run
      </span>
    );
  }
  if (insight.ab_status === "no_changes") {
    return (
      <span
        style={{ ...style, color: "var(--ghost)" }}
        title="This promotion applied no parameter changes, so the forward A/B has nothing to compare."
      >
        A/B · no parameter changes
      </span>
    );
  }
  if (insight.ab_status === "insufficient_forward_data") {
    return (
      <span
        style={{ ...style, color: "var(--hold)" }}
        title={
          insight.ab_window
            ? `Forward window ${insight.ab_window.start_date} → ${insight.ab_window.end_date} did not have enough bars to run the A/B.`
            : "The forward window did not have enough bars to run the A/B."
        }
      >
        A/B · insufficient forward data
      </span>
    );
  }
  // Sprint 124: points-first. Primary is points; dollars is the secondary
  // echo, scaled by the user's point_value_dollars.
  const pts = insight.ab_delta_points;
  const color =
    pts == null
      ? "var(--ghost)"
      : pts > 0
        ? "var(--bull)"
        : pts < 0
          ? "var(--bear)"
          : "var(--dim)";
  const sign = pts != null && pts >= 0 ? "+" : "−";
  const ptsAbs = pts != null ? Math.abs(pts).toFixed(1) : "—";
  const dollarsAbs =
    pts != null ? (Math.abs(pts) * pointValue).toFixed(2) : null;
  return (
    <span style={style}>
      <span style={{ color: "var(--ghost)", letterSpacing: "0.04em" }}>
        A/B forward Δ
      </span>{" "}
      <span style={{ color, fontWeight: 600 }}>
        {sign}{ptsAbs} pts
      </span>
      {dollarsAbs != null && (
        <span style={{ color: "var(--ghost)", marginLeft: 6 }}>
          (≈ {sign}${dollarsAbs})
        </span>
      )}
      {insight.ab_window && (
        <span style={{ color: "var(--ghost)", marginLeft: 8 }}>
          on {insight.ab_window.start_date} → {insight.ab_window.end_date}
        </span>
      )}
    </span>
  );
}

// Sprint 122: short attribution label for PROVENANCE PAPERS links.
// Sprint 123: Groq/Llama/Gemini branches removed — Claude/MCP only. Legacy
// attributions degrade to "legacy" so the UI doesn't imply the provider is
// current.
function shortModelLabel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("claude")) {
    const m = lower.match(/claude-(opus|sonnet|haiku)-?[\d.]*/);
    return m ? `claude-${m[1]}` : "claude";
  }
  return "legacy";
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const ms = Date.now() - then;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Small primitives ─────────────────────────────────────────────────────────

// ── Sprint 113: new atoms for the redesigned detail page ────────────────────

function SectionRule({
  label,
  note,
  noteColor,
  right,
}: {
  label: string;
  note?: string;
  noteColor?: string;
  /** Sprint 144: optional trailing element (e.g. a Show/Hide toggle). */
  right?: ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-3"
      style={{ marginBottom: 14 }}
    >
      <span
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.14em",
          color: "var(--ink)",
        }}
      >
        {label}
      </span>
      <span
        aria-hidden
        style={{
          flex: 1,
          height: 1,
          background: "var(--line)",
        }}
      />
      {note && (
        <span
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: noteColor ?? "var(--ghost)",
            letterSpacing: "0.02em",
          }}
        >
          {note}
        </span>
      )}
      {right}
    </div>
  );
}

// ── Identity strip — name, ticker, timeframe, direction, sub-line, actions ──

function IdentityStrip({
  detail,
  watched,
  watchBusy,
  forkBusy,
  scalperBusy,
  onToggleWatch,
  onFork,
  onUseAsScalper,
}: {
  detail: StrategyDetail;
  watched: boolean;
  watchBusy: boolean;
  forkBusy: boolean;
  scalperBusy: boolean;
  onToggleWatch: () => void;
  onFork: () => void;
  onUseAsScalper: () => void;
}) {
  const canFork =
    !detail.is_mine &&
    (detail.visibility !== "private" || detail.is_shared_with_me);

  const originWord = deriveOriginWord(detail);

  const sublineBits: string[] = [
    `v${detail.version}`,
    originWord,
    `by ${detail.owner_label}`,
    detail.timeframe,
    `${detail.direction}-only`,
    detail.visibility,
  ];

  return (
    <header className="mb-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1
              className="font-display font-bold"
              style={{
                fontSize: 26,
                letterSpacing: "-0.01em",
                color: "var(--ink)",
                fontFamily: "var(--font-jb)",
              }}
            >
              {detail.name}
            </h1>
            {detail.ticker && (
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 13,
                  color: "var(--dim)",
                  letterSpacing: "0.02em",
                }}
              >
                {detail.ticker}
              </span>
            )}
            {detail.is_my_scalper && (
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  color: "var(--bull)",
                  background: "var(--bull-bg)",
                  padding: "2px 8px",
                  borderRadius: 3,
                }}
              >
                MY SCALPER
              </span>
            )}
            {detail.is_shared_with_me && (
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  color: "var(--brand)",
                  background: "rgba(200,16,46,0.08)",
                  padding: "2px 8px",
                  borderRadius: 3,
                }}
              >
                SHARED WITH YOU
              </span>
            )}
          </div>

          <p
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              color: "var(--ghost)",
              marginTop: 8,
              letterSpacing: "0.02em",
            }}
          >
            {sublineBits.join(" · ")}
          </p>

          {detail.tags.length > 0 && (
            <div
              className="flex flex-wrap items-center"
              style={{ gap: 6, marginTop: 12 }}
            >
              {detail.tags.map((t) => (
                <TagPill key={t} tag={t} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onToggleWatch}
            disabled={watchBusy}
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              padding: "6px 14px",
              borderRadius: 4,
              border: `1px solid ${watched ? "var(--bull)" : "var(--line)"}`,
              background: watched ? "var(--bull-bg)" : "transparent",
              color: watched ? "var(--bull)" : "var(--ink)",
              cursor: watchBusy ? "default" : "pointer",
              letterSpacing: "0.02em",
            }}
            title={
              watched
                ? "Atlas evaluates this every 5 min for live signals. Click to unwatch."
                : "Get live signal notifications for this strategy."
            }
          >
            {watchBusy ? "…" : watched ? "★ Watching" : "☆ Watch"}
          </button>
          {canFork && (
            <button
              onClick={onFork}
              disabled={forkBusy}
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 4,
                border: "1px solid var(--brand)",
                background: "var(--brand)",
                color: "#fff",
                cursor: forkBusy ? "default" : "pointer",
                letterSpacing: "0.02em",
              }}
            >
              {forkBusy ? "Forking…" : "Fork to my library"}
            </button>
          )}
          {detail.is_mine && (
            <ShareButton
              strategyId={detail.id}
              visibility={detail.visibility}
              shares={detail.shares}
            />
          )}
          {detail.is_mine && !detail.is_my_scalper && (
            <button
              onClick={onUseAsScalper}
              disabled={scalperBusy}
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 4,
                border: "1px solid var(--bull)",
                background: "var(--bull)",
                color: "#fff",
                cursor: scalperBusy ? "default" : "pointer",
                letterSpacing: "0.02em",
              }}
            >
              {scalperBusy ? "Setting…" : "Use as my scalper"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Sprint 145: Drive-style Share button. Sits in the identity strip next to
 * "Use as my scalper" and opens a modal with the visibility segmented control,
 * email-invite row, and the list of people with access. Owner-only. Replaces
 * the old bottom-of-page VISIBILITY + SHARE sections.
 */
function ShareButton({
  strategyId,
  visibility,
  shares,
}: {
  strategyId: string;
  visibility: "private" | "unlisted" | "public";
  shares: StrategyShareEntry[];
}) {
  const [open, setOpen] = useState(false);

  // Sprint 145: match the visibility state's affordance colour to the current
  // publicity level so the button reads as a status pill, not just an action.
  const dotColor =
    visibility === "public"
      ? "var(--bull)"
      : visibility === "unlisted"
        ? "#f5a623"
        : "var(--ghost)";
  const label =
    visibility === "public"
      ? "Public"
      : visibility === "unlisted"
        ? "Unlisted"
        : "Private";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 12,
          padding: "6px 14px",
          borderRadius: 4,
          border: "1px solid var(--line)",
          background: "transparent",
          color: "var(--ink)",
          cursor: "pointer",
          letterSpacing: "0.02em",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
        title="Share this strategy"
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dotColor,
          }}
        />
        Share · {label}
      </button>
      {open && (
        <ShareModal
          strategyId={strategyId}
          initialVisibility={visibility}
          initialShares={shares}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ShareModal({
  strategyId,
  initialVisibility,
  initialShares,
  onClose,
}: {
  strategyId: string;
  initialVisibility: "private" | "unlisted" | "public";
  initialShares: StrategyShareEntry[];
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 17, 21, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          borderRadius: 10,
          border: "1px solid var(--line)",
          padding: 28,
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: "var(--ink)",
            }}
          >
            Share strategy
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              color: "var(--ghost)",
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: 24 }}>
          <VisibilityPanel
            strategyId={strategyId}
            initialVisibility={initialVisibility}
          />
        </div>

        <div>
          <div
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.14em",
              color: "var(--ink)",
              marginBottom: 12,
            }}
          >
            PEOPLE WITH ACCESS
          </div>
          <SharePanel strategyId={strategyId} initialShares={initialShares} />
        </div>
      </div>
    </div>
  );
}


/**
 * Sprint 147: clickable tag pill. Colour derives from a stable hash of the
 * tag string so "keltner" always looks the same across strategies — the
 * palette is a small curated set (bull/brand/hold plus two blues + purple)
 * so the pills read as categorical, not random. Click routes to
 * /dashboard/strategies?tag=<tag> — the Mine tab filters to matching rows.
 */
function TagPill({ tag }: { tag: string }) {
  const palette = [
    { fg: "#2C8F5E", bg: "rgba(44, 143, 94, 0.10)", border: "rgba(44, 143, 94, 0.30)" },
    { fg: "#C8102E", bg: "rgba(200, 16, 46, 0.08)", border: "rgba(200, 16, 46, 0.28)" },
    { fg: "#B87500", bg: "rgba(184, 117, 0, 0.10)", border: "rgba(184, 117, 0, 0.30)" },
    { fg: "#2762C5", bg: "rgba(39, 98, 197, 0.10)", border: "rgba(39, 98, 197, 0.30)" },
    { fg: "#6E44B0", bg: "rgba(110, 68, 176, 0.10)", border: "rgba(110, 68, 176, 0.30)" },
    { fg: "#0E7E96", bg: "rgba(14, 126, 150, 0.10)", border: "rgba(14, 126, 150, 0.30)" },
  ];
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  const c = palette[hash % palette.length];
  return (
    <Link
      href={`/dashboard/strategies?tag=${encodeURIComponent(tag)}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--font-jb)",
        fontSize: 10,
        letterSpacing: "0.06em",
        padding: "3px 9px",
        borderRadius: 999,
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.fg,
        textDecoration: "none",
        transition: "transform 100ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-1px)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
    >
      #{tag}
    </Link>
  );
}

function deriveOriginWord(detail: StrategyDetail): string {
  if (detail.paper_extracted || detail.paper_source_url) return "arXiv";
  if (detail.forked_from_label) return `Fork from ${detail.forked_from_label}`;
  return "Chat";
}

// ── PROOF — recent backtests + mini bar chart ───────────────────────────────

function ProofSection({ backtests }: { backtests: BacktestListEntry[] }) {
  // Sprint 144: default to showing only the latest backtest; user expands to
  // reveal history. The "latest" is the first entry (page.tsx already sorts
  // by created_at desc).
  const [expanded, setExpanded] = useState(false);
  const maxAbs = Math.max(
    1,
    ...backtests.map((b) => Math.abs(b.total_pnl_points ?? 0)),
  );
  const visible = expanded ? backtests : backtests.slice(0, 1);
  const hiddenCount = backtests.length - visible.length;

  return (
    <section className="mb-10">
      <SectionRule
        label={`PROOF · ${backtests.length} backtest${backtests.length === 1 ? "" : "s"}`}
      />
      {backtests.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 12,
            color: "var(--ghost)",
            padding: "8px 0",
          }}
        >
          No runs yet. Run a backtest from your connected Claude/ChatGPT MCP session.
        </p>
      ) : (
        <div className="flex flex-col">
          {visible.map((b) => (
            <BacktestRow key={b.id} bt={b} maxAbs={maxAbs} />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-jb)",
                fontSize: 11,
                color: "var(--ghost)",
                textAlign: "left",
                padding: "10px 4px 0",
                letterSpacing: "0.04em",
                textDecoration: "underline",
              }}
            >
              Show {hiddenCount} more →
            </button>
          )}
          {expanded && backtests.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-jb)",
                fontSize: 11,
                color: "var(--ghost)",
                textAlign: "left",
                padding: "10px 4px 0",
                letterSpacing: "0.04em",
                textDecoration: "underline",
              }}
            >
              Collapse
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function BacktestRow({
  bt,
  maxAbs,
}: {
  bt: BacktestListEntry;
  maxAbs: number;
}) {
  const pnl = bt.total_pnl_points ?? 0;
  const pnlPos = pnl >= 0;
  const barPct = Math.min(100, (Math.abs(pnl) / maxAbs) * 100);

  return (
    <Link
      href={`/dashboard/backtests/${bt.id}`}
      className="grid items-center"
      style={{
        gridTemplateColumns: "auto auto auto minmax(0, 1fr) auto",
        columnGap: 14,
        padding: "10px 4px",
        borderBottom: "1px solid rgba(141, 164, 178, 0.14)",
        textDecoration: "none",
        fontFamily: "var(--font-jb)",
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ color: "var(--ghost)" }}>
        {bt.start_date} → {bt.end_date}
      </span>
      <span style={{ color: "var(--dim)" }}>
        {bt.ticker} {bt.timeframe}
      </span>
      <span style={{ color: "var(--dim)" }}>
        {bt.total_trades}t{" "}
        {bt.win_rate != null && (
          <span style={{ color: "var(--ghost)" }}>
            · {(bt.win_rate * 100).toFixed(0)}%
          </span>
        )}
      </span>

      {/* mini bar */}
      <div
        style={{
          height: 8,
          background: "var(--elevated)",
          borderRadius: 1,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${barPct}%`,
            background: pnlPos ? "var(--bull)" : "var(--bear)",
            borderRadius: 1,
          }}
        />
      </div>

      <span
        style={{
          color: pnlPos ? "var(--bull)" : "var(--bear)",
          fontWeight: 600,
          minWidth: 88,
          textAlign: "right",
        }}
      >
        {pnlPos ? "+" : "−"}
        {Math.abs(pnl).toFixed(1)} pts
      </span>
    </Link>
  );
}

// ── RULES — Sprint 148 ──────────────────────────────────────────────────────
// Merged view: the 6 trade-lifecycle stages (SESSION → EXIT), with each
// stage's tunable knobs inlined directly under it. Replaces the old
// PLAYBOOK + TUNABLE split — knobs live next to the rule they modify.
// Unmapped tunables fall into stage 06 (rarely used in practice).

function RulesSection({
  rendered,
  prevRendered,
  timeframe,
  direction,
  changedStageNumbers,
  tunables,
}: {
  rendered: RenderedSections;
  prevRendered: RenderedSections | null;
  timeframe: string;
  direction: string;
  changedStageNumbers: Set<string>;
  tunables: TunableWithValue[];
}) {
  const exit = [
    ...(rendered.timeStop ? [rendered.timeStop] : []),
    ...rendered.exitConditions,
  ];
  const prevExit = prevRendered
    ? [
        ...(prevRendered.timeStop ? [prevRendered.timeStop] : []),
        ...prevRendered.exitConditions,
      ]
    : [];

  const knobsByStage = new Map<string, TunableWithValue[]>();
  for (const t of tunables) {
    const stage = tunablePathToStageNumber(t.path) ?? "06";
    if (!knobsByStage.has(stage)) knobsByStage.set(stage, []);
    knobsByStage.get(stage)!.push(t);
  }

  return (
    <section className="mb-10">
      <SectionRule label="RULES" note={`${direction}-only · ${timeframe}`} />

      <RulesLegend />

      <div className="flex flex-col" style={{ gap: 24 }}>
        <RuleRow
          number="01"
          name="SESSION"
          value={rendered.whenItFires ?? "Always active — no session filter"}
          prevValue={prevRendered?.whenItFires ?? undefined}
          muted={!rendered.whenItFires}
          changed={changedStageNumbers.has("01")}
          knobs={knobsByStage.get("01") ?? []}
        />
        <RuleRow
          number="02"
          name="SIGNAL BAR"
          value={rendered.signalBar[0] ?? "—"}
          prevValue={prevRendered?.signalBar[0]}
          continuation={rendered.signalBar.slice(1)}
          prevContinuation={prevRendered?.signalBar.slice(1)}
          changed={changedStageNumbers.has("02")}
          knobs={knobsByStage.get("02") ?? []}
        />
        <RuleRow
          number="03"
          name="ENTRY"
          value={rendered.entry[0] ?? "—"}
          prevValue={prevRendered?.entry[0]}
          continuation={rendered.entry.slice(1)}
          prevContinuation={prevRendered?.entry.slice(1)}
          changed={changedStageNumbers.has("03")}
          knobs={knobsByStage.get("03") ?? []}
        />
        <RuleRow
          number="04"
          name="STOP"
          value={rendered.stopLoss}
          prevValue={prevRendered?.stopLoss}
          changed={changedStageNumbers.has("04")}
          knobs={knobsByStage.get("04") ?? []}
        />
        <RuleRow
          number="05"
          name="TARGET"
          value={rendered.takeProfit}
          prevValue={prevRendered?.takeProfit}
          changed={changedStageNumbers.has("05")}
          knobs={knobsByStage.get("05") ?? []}
        />
        <RuleRow
          number="06"
          name="EXIT"
          value={exit[0] ?? "No time-based exit"}
          prevValue={prevRendered ? (prevExit[0] ?? "No time-based exit") : undefined}
          continuation={exit.slice(1)}
          prevContinuation={prevRendered ? prevExit.slice(1) : undefined}
          muted={exit.length === 0}
          changed={changedStageNumbers.has("06")}
          knobs={knobsByStage.get("06") ?? []}
        />
      </div>

      {rendered.indicators.length > 0 && (
        <div
          className="flex flex-wrap items-baseline gap-2"
          style={{
            marginTop: 24,
            paddingTop: 14,
            borderTop: "1px dashed var(--line)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "var(--ghost)",
            }}
          >
            INDICATORS
          </span>
          {rendered.indicators.map((ind) => (
            <span
              key={ind.id}
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 11,
                color: "var(--dim)",
              }}
            >
              <span style={{ color: "var(--ink)" }}>{ind.id}</span> {ind.label}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

// Sprint 151: one-sentence definition per stage — surfaced as a tooltip on
// the row label and, once, as a legend block under the RULES header. The
// examiner reading a screenshot doesn't hover, so the legend carries the
// explanation without cluttering each row.
const STAGE_HINTS: Record<string, string> = {
  SESSION: "When the strategy is allowed to look for setups — trading window and weekdays.",
  "SIGNAL BAR": "The bar-level pattern that must be true before Atlas will enter — the trigger.",
  ENTRY: "How the position is opened — the fill price expression and position size.",
  STOP: "The invalidation price. If the market hits this level, the trade is closed at a loss.",
  TARGET: "The take-profit price. If the market hits this level, the trade is closed at a gain.",
  EXIT: "Any other early-exit rule — time-based (end of day, N bars) or indicator-driven.",
};

function RulesLegend() {
  const rows: Array<[string, string]> = [
    ["01 SESSION", STAGE_HINTS.SESSION],
    ["02 SIGNAL BAR", STAGE_HINTS["SIGNAL BAR"]],
    ["03 ENTRY", STAGE_HINTS.ENTRY],
    ["04 STOP", STAGE_HINTS.STOP],
    ["05 TARGET", STAGE_HINTS.TARGET],
    ["06 EXIT", STAGE_HINTS.EXIT],
  ];
  return (
    <details
      style={{
        marginTop: 8,
        marginBottom: 20,
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: "6px 12px",
        background: "var(--surface)",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          letterSpacing: "0.06em",
          color: "var(--dim)",
          listStyle: "revert",
        }}
      >
        WHAT THE SIX STAGES MEAN
      </summary>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "10px 0 4px 0",
          display: "grid",
          gridTemplateColumns: "minmax(120px, auto) 1fr",
          columnGap: 14,
          rowGap: 6,
        }}
      >
        {rows.map(([label, hint]) => (
          <li
            key={label}
            style={{
              display: "contents",
              fontFamily: "var(--font-jb)",
              fontSize: 12,
            }}
          >
            <span style={{ color: "var(--ink)", fontWeight: 600, letterSpacing: "0.04em" }}>
              {label}
            </span>
            <span style={{ color: "var(--dim)", lineHeight: 1.45 }}>{hint}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function RuleRow({
  number,
  name,
  value,
  prevValue,
  continuation,
  prevContinuation,
  muted,
  changed,
  knobs,
}: {
  number: string;
  name: string;
  value: string;
  prevValue?: string;
  continuation?: string[];
  prevContinuation?: string[];
  muted?: boolean;
  changed?: boolean;
  knobs: TunableWithValue[];
}) {
  // Sprint 150: inline word-level diff. Only when the row is marked changed
  // AND we have a comparable prev string that actually differs. Otherwise we
  // render plain text to avoid noisy re-highlights on identical lines.
  const showDiff =
    changed && prevValue !== undefined && prevValue !== value;
  return (
    <div
      className="grid items-baseline"
      style={{
        gridTemplateColumns: "32px 110px minmax(0, 1fr)",
        columnGap: 16,
        paddingLeft: changed ? 8 : 0,
        marginLeft: changed ? -8 : 0,
        borderLeft: changed
          ? "2px solid rgba(200, 16, 46, 0.55)"
          : "2px solid transparent",
      }}
      title={changed ? "This stage was modified from the previous version" : undefined}
    >
      <span
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 15,
          fontWeight: 700,
          color: muted ? "var(--ghost)" : "var(--brand)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {number}
      </span>
      <span
        title={STAGE_HINTS[name] ?? undefined}
        style={{
          fontFamily: "var(--font-jb)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          color: "var(--ink)",
          cursor: STAGE_HINTS[name] ? "help" : undefined,
          textDecoration: STAGE_HINTS[name] ? "underline dotted var(--ghost)" : undefined,
          textUnderlineOffset: 3,
        }}
      >
        {name}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-nunito)",
            fontSize: 14,
            lineHeight: 1.5,
            color: muted ? "var(--ghost)" : "var(--ink)",
            fontStyle: muted ? "italic" : "normal",
          }}
        >
          {showDiff ? <InlineDiff prev={prevValue!} next={value} /> : value}
        </div>
        {continuation && continuation.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "4px 0 0 0",
            }}
          >
            {continuation.map((c, i) => {
              const prevC = prevContinuation?.[i];
              const rowChanged = changed && prevC !== undefined && prevC !== c;
              return (
                <li
                  key={i}
                  style={{
                    fontFamily: "var(--font-jb)",
                    fontSize: 12,
                    color: "var(--dim)",
                    lineHeight: 1.5,
                    paddingLeft: 12,
                    position: "relative",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: 0,
                      color: "var(--ghost)",
                    }}
                  >
                    ─
                  </span>
                  {rowChanged ? <InlineDiff prev={prevC!} next={c} /> : c}
                </li>
              );
            })}
          </ul>
        )}

        {knobs.length > 0 && (
          <div
            className="flex flex-col"
            style={{
              gap: 8,
              marginTop: 10,
              paddingTop: 8,
              borderTop: "1px dashed var(--line)",
            }}
          >
            {knobs.map((k) => (
              <KnobRow key={k.name} knob={k} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Sprint 150: inline word-level diff between the parent-version rule string
 * and the current-version rule string. Removed tokens render with a red
 * strikethrough; added tokens render with a green highlight. Unchanged
 * tokens render in the row's normal color. Small enough that a hand-rolled
 * LCS beats pulling in a diff dependency.
 */
function InlineDiff({ prev, next }: { prev: string; next: string }) {
  const ops = diffWords(prev, next);
  return (
    <>
      {ops.map((op, i) => {
        if (op.type === "equal") return <span key={i}>{op.text}</span>;
        if (op.type === "remove")
          return (
            <span
              key={i}
              style={{
                textDecoration: "line-through",
                color: "var(--bear)",
                backgroundColor: "rgba(200, 16, 46, 0.08)",
                padding: "0 3px",
                borderRadius: 3,
              }}
            >
              {op.text}
            </span>
          );
        return (
          <span
            key={i}
            style={{
              color: "var(--bull)",
              backgroundColor: "rgba(34, 139, 90, 0.10)",
              padding: "0 3px",
              borderRadius: 3,
              fontWeight: 600,
            }}
          >
            {op.text}
          </span>
        );
      })}
    </>
  );
}

type DiffOp = { type: "equal" | "add" | "remove"; text: string };

/**
 * Word-level diff via LCS. Tokens split on whitespace but keep whitespace
 * runs as their own tokens so re-joining preserves the original spacing.
 * O(n*m) time / space — fine for one-line rule strings (< ~200 tokens).
 */
function diffWords(a: string, b: string): DiffOp[] {
  const toks = (s: string): string[] => s.split(/(\s+)/).filter((x) => x !== "");
  const A = toks(a);
  const B = toks(b);
  const n = A.length;
  const m = B.length;
  // LCS length table
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        A[i - 1] === B[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Backtrack to build ops
  const rev: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (A[i - 1] === B[j - 1]) {
      rev.push({ type: "equal", text: A[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      rev.push({ type: "remove", text: A[i - 1] });
      i--;
    } else {
      rev.push({ type: "add", text: B[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    rev.push({ type: "remove", text: A[i - 1] });
    i--;
  }
  while (j > 0) {
    rev.push({ type: "add", text: B[j - 1] });
    j--;
  }
  rev.reverse();
  // Merge consecutive same-type ops so adjacent removes/adds render as one span.
  const merged: DiffOp[] = [];
  for (const op of rev) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === op.type) prev.text += op.text;
    else merged.push({ ...op });
  }
  return merged;
}

/**
 * Sprint 148: one tunable knob rendered inline under its owning rule.
 * Answers "how is this strategy set right now?" at a glance — the current
 * value gets the bold weight, the range and description are secondary.
 */
function KnobRow({ knob }: { knob: TunableWithValue }) {
  return (
    <div>
      <div
        className="flex items-baseline flex-wrap"
        style={{ gap: 10 }}
      >
        <span
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--dim)",
          }}
        >
          {knob.name}
        </span>
        {knob.current_value != null && (
          <span
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ink)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {knob.current_value}
          </span>
        )}
        <span
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 10,
            color: "var(--ghost)",
            letterSpacing: "0.02em",
          }}
        >
          [{knob.min ?? "—"} … {knob.max ?? "—"}]
        </span>
      </div>
      {knob.description && (
        <div
          style={{
            fontFamily: "var(--font-nunito)",
            fontSize: 12,
            color: "var(--ghost)",
            lineHeight: 1.45,
            marginTop: 2,
          }}
        >
          {knob.description}
        </div>
      )}
    </div>
  );
}


// ── SharePanel — Sprint 075a ──────────────────────────────────────────────────

function SharePanel({
  strategyId,
  initialShares,
}: {
  strategyId: string;
  initialShares: StrategyShareEntry[];
}) {
  const [shares, setShares] = useState<StrategyShareEntry[]>(initialShares);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onShare(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/ticket-logics/${strategyId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (!body.already_shared) {
        setShares((cur) => [
          { email: trimmed, granted_at: new Date().toISOString() },
          ...cur.filter((s) => s.email !== trimmed),
        ]);
        setMsg("Shared.");
      } else {
        setMsg("Already shared.");
      }
      setEmail("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2400);
    }
  }

  async function onRevoke(target: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/v1/ticket-logics/${strategyId}/shares?email=${encodeURIComponent(target)}`,
        { method: "DELETE" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setShares((cur) => cur.filter((s) => s.email !== target));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2400);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: "var(--ghost)" }}>
        Grant a person read access by email. They&apos;ll see this strategy in
        their library on next login — they don&apos;t need to have signed up yet.
      </p>

      <form onSubmit={onShare} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
          className="flex-1 px-3 py-1.5 text-sm rounded border"
          style={{
            background: "var(--surface)",
            borderColor: "var(--line)",
            color: "var(--ink)",
          }}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || email.trim().length === 0}
          className="px-3 py-1.5 text-sm font-medium rounded disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#fff" }}
        >
          {busy ? "…" : "Share"}
        </button>
      </form>

      {msg && (
        <p className="text-xs" style={{ color: "var(--brand)" }}>
          {msg}
        </p>
      )}

      {shares.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--ghost)" }}>
          No one has access yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {shares.map((s) => (
            <li
              key={s.email}
              className="flex items-center justify-between p-2 rounded text-sm"
              style={{
                background: "var(--elevated)",
                color: "var(--ink)",
              }}
            >
              <span className="font-mono text-xs">{s.email}</span>
              <button
                onClick={() => onRevoke(s.email)}
                disabled={busy}
                className="text-xs disabled:opacity-50"
                style={{
                  color: "var(--bear)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
