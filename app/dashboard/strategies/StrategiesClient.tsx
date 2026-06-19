"use client";

/**
 * Strategy Library — Sprint 061B.
 *
 * Tabs: Mine / Public. Card grid per tab. Click into a card → strategy
 * detail page (Sprint 061C). "My scalper" badge shown on the strategy
 * currently in profiles.scalper_strategy_id.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

export interface StrategyCard {
  id: string;
  name: string;
  version: number;
  description: string;
  visibility: "private" | "unlisted" | "public";
  status: "draft" | "active" | "archived";
  forked_from_id: string | null;
  is_mine: boolean;
  owner_label: string;
  backtest_count: number;
  is_my_scalper: boolean;
  created_at: string;
  ticker: string | null;
  tags: string[];
}

type Tab = "mine" | "public";

export function StrategiesClient({ cards }: { cards: StrategyCard[] }) {
  const [tab, setTab] = useState<Tab>("mine");

  const mine = useMemo(() => cards.filter((c) => c.is_mine), [cards]);
  const publik = useMemo(
    () => cards.filter((c) => !c.is_mine && c.visibility === "public"),
    [cards],
  );
  const visible = tab === "mine" ? mine : publik;

  return (
    <div className="mx-auto p-6" style={{ maxWidth: 1100, color: "var(--ink)" }}>
      <h1 className="text-2xl font-bold mb-1">Strategies</h1>
      <p
        className="text-sm mb-6"
        style={{ color: "var(--dim)" }}
      >
        A Ticket Logic is a rule set for entering and exiting trades. Yours
        evolves through AI distillation; public strategies are read-only until
        you fork them into your library.
      </p>

      {/* Tabs */}
      <div
        className="flex gap-1 mb-6 p-1 inline-flex rounded-lg"
        style={{ background: "var(--elevated)" }}
      >
        <TabButton active={tab === "mine"} onClick={() => setTab("mine")}>
          Mine ({mine.length})
        </TabButton>
        <TabButton active={tab === "public"} onClick={() => setTab("public")}>
          Public ({publik.length})
        </TabButton>
      </div>

      {visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <TickerGroupedGrid cards={visible} />
      )}
    </div>
  );
}

function TickerGroupedGrid({ cards }: { cards: StrategyCard[] }) {
  // Sprint 068: strategies are now ticker-locked. Group by ticker so the
  // library reads as "what's available for ^DJI" rather than a flat list.
  const groups = useMemo(() => {
    const m = new Map<string, StrategyCard[]>();
    for (const c of cards) {
      const key = c.ticker ?? "—";
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return [...m.entries()].sort(([a], [b]) => {
      if (a === "—") return 1;
      if (b === "—") return -1;
      return a.localeCompare(b);
    });
  }, [cards]);

  return (
    <div className="space-y-8">
      {groups.map(([ticker, group]) => (
        <section key={ticker}>
          <div className="flex items-baseline gap-2 mb-3">
            <h2
              className="text-lg font-semibold font-mono"
              style={{ color: "var(--ink)" }}
            >
              {ticker === "—" ? "Unassigned" : ticker}
            </h2>
            <span className="text-xs" style={{ color: "var(--ghost)" }}>
              {group.length} strategy{group.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {group.map((c) => (
              <StrategyCardView key={c.id} card={c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-1.5 text-sm rounded-md font-medium transition-all"
      style={{
        background: active ? "var(--surface)" : "transparent",
        color: active ? "var(--ink)" : "var(--dim)",
        boxShadow: active ? "var(--card-shadow)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function StrategyCardView({ card }: { card: StrategyCard }) {
  return (
    <Link
      href={`/dashboard/strategies/${card.id}`}
      className="block p-4 rounded-lg border transition-colors"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h2
              className="font-semibold text-base font-mono"
              style={{ color: "var(--ink)" }}
            >
              {card.name}
            </h2>
            <span
              className="text-xs font-mono"
              style={{ color: "var(--dim)" }}
            >
              v{card.version}
            </span>
            {card.is_my_scalper && (
              <span
                className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded ring-1 ring-inset uppercase"
                style={{
                  background: "var(--bull-bg)",
                  color: "var(--bull)",
                  borderColor: "var(--bull)",
                }}
              >
                My scalper
              </span>
            )}
            <VisibilityChip vis={card.visibility} />
          </div>
          <div
            className="text-xs flex items-center gap-2"
            style={{ color: "var(--ghost)" }}
          >
            <span>by {card.owner_label}</span>
            <span>·</span>
            <span>{card.backtest_count} backtest{card.backtest_count === 1 ? "" : "s"}</span>
            {card.forked_from_id && (
              <>
                <span>·</span>
                <span>forked</span>
              </>
            )}
          </div>
        </div>
      </div>

      <p
        className="text-sm leading-relaxed line-clamp-3"
        style={{ color: "var(--dim)" }}
      >
        {card.description || (
          <span className="italic" style={{ color: "var(--ghost)" }}>
            No description yet.
          </span>
        )}
      </p>

      {card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {card.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded"
              style={{
                background: "var(--elevated)",
                color: "var(--dim)",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

function VisibilityChip({ vis }: { vis: "private" | "unlisted" | "public" }) {
  const styles: Record<typeof vis, { bg: string; color: string; label: string }> = {
    private: {
      bg: "var(--elevated)",
      color: "var(--dim)",
      label: "Private",
    },
    unlisted: {
      bg: "var(--hold-bg)",
      color: "var(--hold)",
      label: "Unlisted",
    },
    public: {
      bg: "var(--bull-bg)",
      color: "var(--bull)",
      label: "Public",
    },
  };
  const s = styles[vis];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded uppercase"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div
      className="p-10 rounded-lg border text-center"
      style={{
        borderColor: "var(--line)",
        background: "var(--surface)",
      }}
    >
      <p className="text-sm mb-2" style={{ color: "var(--dim)" }}>
        {tab === "mine"
          ? "You haven't authored or forked any strategies yet."
          : "No public strategies available."}
      </p>
      {tab === "mine" && (
        <p className="text-xs" style={{ color: "var(--ghost)" }}>
          Browse the Public tab and fork a strategy to start.
        </p>
      )}
    </div>
  );
}
