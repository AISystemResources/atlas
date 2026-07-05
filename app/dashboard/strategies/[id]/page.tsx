/**
 * /dashboard/strategies/[id] — strategy detail (Sprint 061C).
 *
 * Fetches: the strategy, its full version family (other versions chained by
 * name+author), recent backtests, and a preview of the structured rules
 * (rendered server-side so the page paints instantly).
 */

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { getServiceClient } from "@/lib/supabase-server";
import { parseTicketLogicBody } from "@/lib/strategies/schema";
import { renderTicketLogicBody } from "@/lib/strategies/render-rules";
import { buildAccessContext, canRead } from "@/lib/strategies/access";
import {
  StrategyDetailClient,
  type StrategyDetail,
  type VersionFamilyEntry,
  type BacktestListEntry,
  type PendingProposal,
  type PromotionInsight,
  type PromotionInsightChange,
  type StructuralPromotionView,
} from "./StrategyDetailClient";

interface StrategyRow {
  id: string;
  name: string;
  version: number;
  parent_version_id: string | null;
  forked_from_id: string | null;
  parent_paper_id: string | null;
  description: string;
  body: unknown;
  status: "draft" | "active" | "archived";
  visibility: "private" | "unlisted" | "public";
  created_by_user_id: string | null;
  created_at: string;
  ticker: string | null;
  tags: string[] | null;
}

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const { id } = await params;
  const sb = getServiceClient();

  const { data: rowData } = await sb
    .from("ticket_logics")
    .select(
      "id, name, version, parent_version_id, forked_from_id, parent_paper_id, description, body, status, visibility, created_by_user_id, created_at, ticker, tags",
    )
    .eq("id", id)
    .maybeSingle();

  const row = rowData as unknown as StrategyRow | null;
  if (!row) notFound();

  const isOwner = row.created_by_user_id === userId;

  // Sprint 075a: access check includes per-email shares.
  const access = await buildAccessContext(userId);
  if (!canRead(row, access)) notFound();
  const isSharedWithMe = !isOwner && access.sharedStrategyIds.has(row.id);

  // Version family: same (name, created_by_user_id) pair, ordered v1, v2, ...
  const { data: familyRows } = await sb
    .from("ticket_logics")
    .select("id, version, status, created_at")
    .eq("name", row.name)
    .eq("created_by_user_id", row.created_by_user_id)
    .order("version", { ascending: true });

  const familyRowsTyped = (familyRows ?? []) as Array<{
    id: string;
    version: number;
    status: string;
    created_at: string;
  }>;

  // Sprint 120: pull the best-effort latest backtest per sibling version so
  // the timeline can show a PnL chip under each dot. One SELECT covers all
  // siblings — we sort by created_at DESC and pick the first row per
  // ticket_logic_id.
  const familyIds = familyRowsTyped.map((r) => r.id);
  const latestPnlByVersionId = new Map<string, number | null>();
  if (familyIds.length > 0) {
    const { data: familyBtRows } = await sb
      .from("ticket_backtests")
      .select("ticket_logic_id, total_pnl_points, created_at")
      .in("ticket_logic_id", familyIds)
      .order("created_at", { ascending: false });
    for (const r of (familyBtRows ?? []) as Array<{
      ticket_logic_id: string;
      total_pnl_points: number | null;
      created_at: string;
    }>) {
      if (!latestPnlByVersionId.has(r.ticket_logic_id)) {
        latestPnlByVersionId.set(r.ticket_logic_id, r.total_pnl_points);
      }
    }
  }

  const family: VersionFamilyEntry[] = familyRowsTyped.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    created_at: r.created_at,
    is_current: r.id === row.id,
    latest_pnl_points: latestPnlByVersionId.get(r.id) ?? null,
  }));

  // Sprint 079E: surface the concrete next version number on the Promote
  // button instead of the abstract "v(N+1)" so non-technical users can
  // see exactly what they're creating before clicking.
  const nextVersion =
    family.length > 0 ? Math.max(...family.map((f) => f.version)) + 1 : row.version + 1;

  // Recent backtests targeting this exact strategy version.
  const { data: btRows } = await sb
    .from("ticket_backtests")
    .select(
      "id, ticker, timeframe, start_date, end_date, total_trades, win_rate, total_pnl_points, created_at",
    )
    .eq("ticket_logic_id", id)
    .order("created_at", { ascending: false })
    .limit(10);

  const backtests: BacktestListEntry[] = ((btRows ?? []) as Array<{
    id: string;
    ticker: string;
    timeframe: string;
    start_date: string;
    end_date: string;
    total_trades: number;
    win_rate: number | null;
    total_pnl_points: number | null;
    created_at: string;
  }>).map((r) => r);

  // Sprint 053.3: pending promote-proposals for THIS version. Owner-only —
  // promote is owner-gated anyway, no point showing the section to viewers
  // who couldn't act on it.
  let pendingProposals: PendingProposal[] = [];
  if (isOwner && backtests.length > 0) {
    const backtestIds = backtests.map((b) => b.id);
    // Sprint 123: filter PENDING to Claude-family insights only. Sprint 095
    // removed all server-side LLM inference, so Groq/Llama/Gemini rows in
    // ticket_backtest_insights are legacy from before the pivot. Historical
    // insights that already promoted (v2, v3, ...) remain visible in the
    // WHY panel — that's honest trace. But un-promoted Llama proposals are
    // stale and should not surface as actionable "Promote to vN" buttons.
    const { data: insightRows } = await sb
      .from("ticket_backtest_insights")
      .select(
        "id, backtest_id, rationale, proposed_changes, ab_comparison, winning_trade_ids, losing_trade_ids, created_at, model",
      )
      .in("backtest_id", backtestIds)
      .eq("recommendation", "promote")
      .is("promoted_to_version_id", null)
      .ilike("model", "%claude%")
      .order("created_at", { ascending: false });

    type ProposedChangeRow = {
      name: string;
      current_value: number;
      proposed_value: number;
      reason: string;
      supporting_trade_ids?: string[];
      original_proposed_value?: number;
      was_clamped?: boolean;
      clamp_reason?: string;
      max_step_pct?: number | null;
    };
    type InsightRowLite = {
      id: string;
      backtest_id: string;
      rationale: string | null;
      proposed_changes: ProposedChangeRow[] | null;
      ab_comparison: unknown;
      winning_trade_ids: string[] | null;
      losing_trade_ids: string[] | null;
      created_at: string;
      model: string;
    };
    const btMeta = new Map(
      backtests.map((b) => [b.id, { ticker: b.ticker, timeframe: b.timeframe }] as const),
    );
    pendingProposals = ((insightRows ?? []) as InsightRowLite[]).map((r) => ({
      insight_id: r.id,
      backtest_id: r.backtest_id,
      backtest_ticker: btMeta.get(r.backtest_id)?.ticker ?? "",
      backtest_timeframe: btMeta.get(r.backtest_id)?.timeframe ?? "",
      created_at: r.created_at,
      model: r.model,
      rationale: r.rationale,
      proposed_changes: (r.proposed_changes ?? []).map((c) => ({
        name: c.name,
        current_value: c.current_value,
        applied_value: c.proposed_value, // post-clamp value persisted into proposed_value
        original_proposed_value:
          c.original_proposed_value ?? c.proposed_value,
        was_clamped: c.was_clamped ?? false,
        clamp_reason: (c.clamp_reason ?? "") as
          | ""
          | "step"
          | "min"
          | "max",
        max_step_pct: c.max_step_pct ?? null,
        reason: c.reason,
        supporting_trade_ids: c.supporting_trade_ids ?? [],
      })),
      winning_trade_count: r.winning_trade_ids?.length ?? 0,
      losing_trade_count: r.losing_trade_ids?.length ?? 0,
      ab_comparison: r.ab_comparison as PendingProposal["ab_comparison"],
    }));
  }

  // Sprint 120: the WHY behind this version. If this row was promoted from an
  // LLM insight (v2+), find the insight row where promoted_to_version_id = us.
  // Carries the model + rationale + proposed_changes that produced this v.
  // Sprint 120b: also fetch ab_comparison (the honest forward A/B delta) and
  // the parent's body so we can compute a full body-level diff (SESSION,
  // weekday, and entry-condition changes that don't map to a declared tunable).
  let promotionInsight: PromotionInsight | null = null;
  {
    const { data: insightRow } = await sb
      .from("ticket_backtest_insights")
      .select(
        "id, backtest_id, model, rationale, proposed_changes, ab_comparison, winning_pattern, losing_pattern, created_at",
      )
      .eq("promoted_to_version_id", row.id)
      .maybeSingle();
    if (insightRow) {
      type AbControl = {
        total_trades: number;
        win_rate: number | null;
        total_pnl_dollars: number;
        max_drawdown_dollars: number;
      };
      type AbComparison =
        | null
        | { status: "no_changes" }
        | {
            status: "insufficient_forward_data";
            forward_window: {
              start_date: string;
              end_date: string;
              days_requested: number;
            };
            bars_returned: number;
            reason: string;
          }
        | {
            status: "ok";
            forward_window: {
              start_date: string;
              end_date: string;
              days_requested: number;
            };
            control: AbControl;
            treatment: AbControl;
            delta: AbControl;
          };
      type Row = {
        id: string;
        backtest_id: string;
        model: string;
        rationale: string | null;
        proposed_changes: Array<{
          name: string;
          current_value: number;
          proposed_value: number;
          original_proposed_value?: number;
          was_clamped?: boolean;
          clamp_reason?: string;
          reason: string;
        }> | null;
        ab_comparison: AbComparison;
        winning_pattern: string | null;
        losing_pattern: string | null;
        created_at: string;
      };
      const r = insightRow as Row;

      const changes: PromotionInsightChange[] = (r.proposed_changes ?? []).map(
        (c) => ({
          name: c.name,
          current_value: c.current_value,
          applied_value: c.proposed_value,
          original_proposed_value: c.original_proposed_value ?? c.proposed_value,
          was_clamped: c.was_clamped ?? false,
          reason: c.reason,
        }),
      );

      // Sprint 120b: HONEST delta. The forward A/B in ab_comparison was run
      // on the SAME bars (control body vs treatment body over the same window
      // right after the backtest end). That's what the LLM's proposal
      // actually earned in a controlled test.
      // Sprint 124: points-first. Prefer control/treatment total_pnl_points
      // for the delta since ab_comparison.delta only carries dollar fields.
      let abDeltaDollars: number | null = null;
      let abDeltaPoints: number | null = null;
      let abStatus: PromotionInsight["ab_status"] = null;
      let abWindow: PromotionInsight["ab_window"] = null;
      if (r.ab_comparison) {
        abStatus = r.ab_comparison.status;
        if (r.ab_comparison.status === "ok") {
          abDeltaDollars = r.ab_comparison.delta.total_pnl_dollars;
          // Some older ab_comparison rows don't carry points on control /
          // treatment; guard and fall back to null cleanly.
          const cPts = (r.ab_comparison.control as {
            total_pnl_points?: number;
          }).total_pnl_points;
          const tPts = (r.ab_comparison.treatment as {
            total_pnl_points?: number;
          }).total_pnl_points;
          if (typeof cPts === "number" && typeof tPts === "number") {
            abDeltaPoints = tPts - cPts;
          }
          abWindow = r.ab_comparison.forward_window;
        } else if (r.ab_comparison.status === "insufficient_forward_data") {
          abWindow = r.ab_comparison.forward_window;
        }
      }

      // Sprint 120b: body-level diff. Pull the parent body so we can walk
      // both trees and report EVERY changed key path — SESSION, weekday,
      // indicator params, entry conditions — not just the declared tunables.
      const bodyChangePaths: string[][] = [];
      if (row.parent_version_id) {
        const { data: parentRow } = await sb
          .from("ticket_logics")
          .select("body")
          .eq("id", row.parent_version_id)
          .maybeSingle();
        const parentBody = (parentRow as { body: unknown } | null)?.body ?? null;
        if (parentBody !== null) {
          diffJson(parentBody, row.body, [], bodyChangePaths);
        }
      }

      promotionInsight = {
        insight_id: r.id,
        backtest_id: r.backtest_id,
        model: r.model,
        rationale: r.rationale,
        winning_pattern: r.winning_pattern,
        losing_pattern: r.losing_pattern,
        created_at: r.created_at,
        changes,
        ab_status: abStatus,
        ab_delta_dollars: abDeltaDollars,
        ab_delta_points: abDeltaPoints,
        ab_window: abWindow,
        body_change_paths: bodyChangePaths,
      };
    }
  }

  // Sprint 137: structural-promotion "why" — for v2+ rows created via
  // promote_with_body_change (the structural body-change path). Those rows
  // have no ticket_backtest_insights entry, but they stamp
  //   "Promoted from <name> v<N> via structural change. Change: <SUMMARY>.
  //    Rationale: <LONGFORM>. Model: <MODEL>"
  // into their description. Parse it here so the WHY panel can render "what
  // changed and why" even when the promotion took the structural path.
  // If a distillation insight already exists, that wins — no need for this
  // fallback (ratchet promotes are richer with A/B forward data).
  let structuralPromotion: StructuralPromotionView | null = null;
  if (!promotionInsight && row.parent_version_id && row.description) {
    structuralPromotion = parseStructuralDescription(
      row.description,
      row.created_at,
    );
    // Fallback: older v2+ rows (created directly via create_ticket_logic before
    // promote_with_body_change existed) still have a hand-written description
    // explaining the change but no parseable markers. Surface the raw
    // description as rationale so the user sees *something* under WHY instead
    // of a blank strategy detail page.
    if (!structuralPromotion) {
      structuralPromotion = {
        change_summary: null,
        rationale: row.description,
        model: null,
        created_at: row.created_at,
        body_change_paths: [],
      };
    }
    // Reuse the same body-diff walk as the ratchet path so PLAYBOOK stage
    // tinting still lights up on structural changes.
    const { data: parentRow } = await sb
      .from("ticket_logics")
      .select("body")
      .eq("id", row.parent_version_id)
      .maybeSingle();
    const parentBody = (parentRow as { body: unknown } | null)?.body ?? null;
    if (parentBody !== null) {
      const bodyChangePaths: string[][] = [];
      diffJson(parentBody, row.body, [], bodyChangePaths);
      structuralPromotion.body_change_paths = bodyChangePaths;
    }
  }

  // Forked-from info, if any.
  let forkedFromLabel: string | null = null;
  if (row.forked_from_id) {
    const { data: src } = await sb
      .from("ticket_logics")
      .select("name, version, created_by_user_id")
      .eq("id", row.forked_from_id)
      .maybeSingle();
    if (src) {
      const r = src as { name: string; version: number; created_by_user_id: string | null };
      const author = r.created_by_user_id === userId ? "you" : truncateUser(r.created_by_user_id);
      forkedFromLabel = `${r.name} v${r.version} by ${author}`;
    }
  }

  // Am I currently using this as my scalper?
  // Sprint 124: also load point_value_dollars so the WHY panel's dollar echo
  // matches the user's Settings choice.
  const { data: profile } = await sb
    .from("profiles")
    .select("scalper_strategy_id, point_value_dollars")
    .eq("id", userId)
    .maybeSingle();
  const isMyScalper =
    ((profile as { scalper_strategy_id: string | null } | null)
      ?.scalper_strategy_id ?? null) === row.id;
  const pointValue =
    (profile as { point_value_dollars: number | null } | null)
      ?.point_value_dollars ?? 1;

  // If this strategy was extracted from a paper, fetch the source URL for the badge link.
  let paperSourceUrl: string | null = null;
  if (row.parent_paper_id) {
    const { data: paperRow } = await sb
      .from("signal_papers")
      .select("source_url")
      .eq("id", row.parent_paper_id)
      .maybeSingle();
    paperSourceUrl = (paperRow as { source_url: string } | null)?.source_url ?? null;
  }

  // Sprint 122: N:N paper links. Join through strategy_paper_links so we can
  // surface convergent-inspiration papers (multiple papers → one strategy).
  const linkedPapers: Array<{
    paper_id: string;
    title: string;
    source_url: string | null;
    inspiration_note: string | null;
    added_by_model: string | null;
    is_origin: boolean;
  }> = [];
  {
    const { data: linkRows } = await sb
      .from("strategy_paper_links")
      .select(
        "paper_id, inspiration_note, added_by_model, signal_papers!inner(id, title, source_url)",
      )
      .eq("strategy_id", row.id)
      .order("added_at", { ascending: true });
    type LinkRow = {
      paper_id: string;
      inspiration_note: string | null;
      added_by_model: string | null;
      signal_papers: { id: string; title: string; source_url: string | null };
    };
    for (const r of (linkRows ?? []) as unknown as LinkRow[]) {
      const isOrigin =
        r.inspiration_note === "origin" || r.paper_id === row.parent_paper_id;
      linkedPapers.push({
        paper_id: r.paper_id,
        title: r.signal_papers.title,
        source_url: r.signal_papers.source_url,
        inspiration_note: r.inspiration_note,
        added_by_model: r.added_by_model,
        is_origin: isOrigin,
      });
    }
  }

  // Render the body to structured prose server-side.
  const body = parseTicketLogicBody(row.body);
  const rendered = renderTicketLogicBody(body);

  // Sprint 075a: when the caller is the owner, surface the share list.
  let shares: Array<{ email: string; granted_at: string }> = [];
  if (isOwner) {
    const { data: shareRows } = await sb
      .from("strategy_shares")
      .select("email, granted_at")
      .eq("strategy_id", row.id)
      .order("granted_at", { ascending: false });
    shares = (shareRows ?? []) as Array<{ email: string; granted_at: string }>;
  }

  // Sprint 109 Phase 3: is this strategy in the caller's watched set?
  const { data: watchRow } = await sb
    .from("watched_strategies")
    .select("strategy_id")
    .eq("user_id", userId)
    .eq("strategy_id", row.id)
    .maybeSingle();
  const watchedByMe = watchRow !== null;

  const detail: StrategyDetail = {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    is_mine: isOwner,
    is_shared_with_me: isSharedWithMe,
    owner_label: isOwner ? "you" : truncateUser(row.created_by_user_id),
    forked_from_id: row.forked_from_id,
    forked_from_label: forkedFromLabel,
    parent_version_id: row.parent_version_id,
    is_my_scalper: isMyScalper,
    created_at: row.created_at,
    rendered,
    tunable_parameters: body.tunable_parameters ?? [],
    timeframe: body.timeframe,
    direction: body.direction,
    ticker: row.ticker ?? null,
    tags: row.tags ?? [],
    paper_extracted: (row.tags ?? []).includes("paper-extracted"),
    paper_source_url: paperSourceUrl,
    linked_papers: linkedPapers,
    shares,
    watched_by_me: watchedByMe,
  };

  return (
    <StrategyDetailClient
      detail={detail}
      family={family}
      backtests={backtests}
      pendingProposals={pendingProposals}
      nextVersion={nextVersion}
      promotionInsight={promotionInsight}
      structuralPromotion={structuralPromotion}
      pointValue={pointValue}
    />
  );
}

function truncateUser(userId: string | null): string {
  if (!userId) return "—";
  if (userId.startsWith("user_")) return `@${userId.slice(5, 11)}`;
  return `@${userId.slice(0, 6)}`;
}

/**
 * Sprint 120b: recursive JSON deep-diff. Walks two trees and records the
 * full path of every leaf that differs OR every subtree that only exists on
 * one side. Used to surface all body-level changes on the WHY panel so
 * SESSION / weekday / entry-condition edits light up even when the LLM
 * didn't declare them as tunable proposed_changes.
 *
 * Arrays are diffed element-wise up to the shared length; extra elements on
 * either side count as changes with a numeric index in the path.
 */
function diffJson(
  a: unknown,
  b: unknown,
  path: string[],
  out: string[][],
): void {
  if (a === b) return;
  if (a === null || b === null || a === undefined || b === undefined) {
    out.push([...path]);
    return;
  }
  if (typeof a !== typeof b) {
    out.push([...path]);
    return;
  }
  if (typeof a !== "object") {
    // primitives — !== already caught inequality above
    out.push([...path]);
    return;
  }
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) {
    out.push([...path]);
    return;
  }
  if (aIsArr && bIsArr) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    const len = Math.max(arrA.length, arrB.length);
    for (let i = 0; i < len; i++) {
      diffJson(arrA[i], arrB[i], [...path, String(i)], out);
    }
    return;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  for (const k of keys) {
    diffJson(objA[k], objB[k], [...path, k], out);
  }
}

/**
 * Sprint 137: parse a structural-promotion description into its parts.
 * promote_with_body_change stamps the description in a fixed shape:
 *   "Promoted from <name> v<N> via structural change. Change: <SUMMARY>.
 *    Rationale: <LONGFORM>. Model: <MODEL>"
 * Returns null if the description doesn't match this shape (e.g. hand-written,
 * or from create_ticket_logic).
 */
function parseStructuralDescription(
  description: string,
  createdAt: string,
): StructuralPromotionView | null {
  if (!description.includes("via structural change")) return null;

  // Model is a suffix; strip first so it doesn't leak into rationale.
  let rest = description;
  let model: string | null = null;
  const modelMatch = rest.match(/(?:^|\s)Model:\s*([^\s]+.*?)\s*$/);
  if (modelMatch) {
    model = modelMatch[1].trim();
    rest = rest.slice(0, modelMatch.index).trim();
  }

  // Rationale = everything after "Rationale:".
  let rationale: string | null = null;
  const rationaleIdx = rest.indexOf("Rationale:");
  if (rationaleIdx >= 0) {
    rationale = rest.slice(rationaleIdx + "Rationale:".length).trim();
    // strip a single trailing period the stamp adds.
    rationale = rationale.replace(/\.\s*$/, "");
    rest = rest.slice(0, rationaleIdx).trim();
  }

  // Change summary = everything between "Change:" and end of rest.
  let changeSummary: string | null = null;
  const changeIdx = rest.indexOf("Change:");
  if (changeIdx >= 0) {
    changeSummary = rest.slice(changeIdx + "Change:".length).trim();
    changeSummary = changeSummary.replace(/\.\s*$/, "");
  }

  // At minimum a change summary should be present — otherwise we don't have
  // anything worth rendering distinct from the version chevrons.
  if (!changeSummary) return null;

  return {
    change_summary: changeSummary,
    rationale,
    model,
    created_at: createdAt,
    body_change_paths: [],
  };
}
