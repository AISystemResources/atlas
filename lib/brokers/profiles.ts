/**
 * BrokerProfile catalog — Sprint 077B.
 *
 * A BrokerProfile is the broker's declared "physics" — separate from any
 * code that talks to the broker. The Atlas Simulator's fill engine reads
 * the profile to apply spread, commission, and slippage during sim
 * fills. Real-broker adapters (Alpaca, IBKR, etc.) ignore profiles
 * because they get the friction from the broker itself.
 *
 * Discipline:
 *   - Spread + commission: deterministic, published — model exactly.
 *   - Slippage: stated assumption (fixed bps). Document on the profile.
 *   - Partial fills, halts, overnight gaps, regulatory rejections, PDT
 *     enforcement: explicitly NOT modeled. Surface that on the profile
 *     so users connecting live know what reality tax to expect.
 *
 * The single static catalog is exported as `BROKER_PROFILES`. The
 * canonical "frictionless reference" profile is `pure`.
 */

export type AssetClass = "equity" | "etf" | "index" | "crypto" | "cfd";

export interface CommissionModel {
  /** Flat $ per trade */
  flat?: number;
  /** Per-share cents */
  per_share?: number;
  /** Percent of notional, e.g. 0.001 = 10 bps */
  pct_notional?: number;
  /** Minimum charge per trade */
  min_per_trade?: number;
}

export interface SpreadModel {
  /** Half-spread in basis points (1 bp = 0.01%). Used additively on BUY,
   *  subtractively on SELL. e.g. 5 bps half-spread on a $100 quote means
   *  BUY fills at 100.05 and SELL fills at 99.95. */
  half_spread_bps: number;
  /** Override per-asset-class (e.g. crypto 30 bps but equity 5 bps) */
  by_asset?: Partial<Record<AssetClass, number>>;
}

export interface SlippageModel {
  /** Additional bps on top of spread, applied in the adverse direction. */
  additive_bps: number;
}

export interface BrokerProfile {
  /** Stable identifier, lowercase-hyphen */
  id: string;
  /** Human label for UI */
  label: string;
  /** Free-text description shown in UI */
  description: string;
  /** Asset classes this profile is honest about */
  asset_classes: AssetClass[];
  supports_fractional: boolean;
  supports_brackets_by_asset: Partial<Record<AssetClass, boolean>>;
  commission: CommissionModel;
  spread: SpreadModel;
  slippage: SlippageModel;
  /** Free-text list of things this profile explicitly does NOT model */
  not_modeled: string[];
}

export const BROKER_PROFILES: BrokerProfile[] = [
  {
    id: "pure",
    label: "Atlas Sim — frictionless",
    description:
      "Zero spread, zero commission, zero slippage. The cleanest reference for evaluating raw strategy edge. Useful when comparing strategy versions head-to-head.",
    asset_classes: ["equity", "etf", "index", "crypto", "cfd"],
    supports_fractional: true,
    supports_brackets_by_asset: { equity: true, etf: true, index: true, crypto: true, cfd: true },
    commission: {},
    spread: { half_spread_bps: 0 },
    slippage: { additive_bps: 0 },
    not_modeled: [
      "all friction (this is the reference profile)",
      "partial fills",
      "halts",
      "overnight gaps",
      "regulatory rejections",
    ],
  },
  {
    id: "alpaca-paper",
    label: "Alpaca paper",
    description:
      "Alpaca paper trading — zero commission on equity and crypto, IEX-only market data. Spread modeled at typical liquidity levels.",
    asset_classes: ["equity", "etf", "crypto"],
    supports_fractional: true,
    supports_brackets_by_asset: { equity: true, etf: true, crypto: false },
    commission: {},
    spread: {
      half_spread_bps: 5,
      by_asset: { equity: 5, etf: 5, crypto: 10 },
    },
    slippage: { additive_bps: 2 },
    not_modeled: [
      "intra-day spread widening on news",
      "halts",
      "partial fills",
      "PDT enforcement",
      "overnight gaps",
    ],
  },
  {
    id: "alpaca-live",
    label: "Alpaca live",
    description:
      "Alpaca live trading — same commission structure as paper (zero on equity/crypto) but live order book. Treat as a near-substitute for paper-mode physics.",
    asset_classes: ["equity", "etf", "crypto"],
    supports_fractional: true,
    supports_brackets_by_asset: { equity: true, etf: true, crypto: false },
    commission: {},
    spread: {
      half_spread_bps: 5,
      by_asset: { equity: 5, etf: 5, crypto: 10 },
    },
    slippage: { additive_bps: 2 },
    not_modeled: [
      "intra-day spread widening on news",
      "halts",
      "partial fills",
      "PDT enforcement",
      "overnight gaps",
      "fees from regulators (SEC TAF, FINRA TAF)",
    ],
  },
  {
    id: "ibkr-paper",
    label: "IBKR paper (tiered pricing)",
    description:
      "Interactive Brokers paper using the tiered pricing schedule for US stocks — $0.0035/share minimum $0.35. No fractional shares on most account types. Tighter spreads than Alpaca on liquid names.",
    asset_classes: ["equity", "etf", "cfd"],
    supports_fractional: false,
    supports_brackets_by_asset: { equity: true, etf: true, cfd: false },
    commission: {
      per_share: 0.0035,
      min_per_trade: 0.35,
    },
    spread: {
      half_spread_bps: 3,
      by_asset: { equity: 3, etf: 3, cfd: 10 },
    },
    slippage: { additive_bps: 2 },
    not_modeled: [
      "tier-step commission discount past 300K shares/mo",
      "halts",
      "partial fills",
      "OCA group nuances",
      "PDT enforcement",
    ],
  },
  {
    id: "pepperstone-cfd-dow",
    label: "Pepperstone CFD — Dow / US30",
    description:
      "Spread is the cost — typical 3-point spread on the US30 CFD during normal market hours. Zero commission. The 3-point spread eats directly into Edmund S1's 3-point buffer; this profile is the canonical example of friction-vs-edge separation.",
    asset_classes: ["cfd"],
    supports_fractional: true,
    supports_brackets_by_asset: { cfd: true },
    commission: {},
    spread: {
      // On a $40,000 index, 3 points = ~7.5 bps. half-spread = ~3.75 bps.
      half_spread_bps: 4,
      by_asset: { cfd: 4 },
    },
    slippage: { additive_bps: 5 },
    not_modeled: [
      "spread widening outside session hours",
      "overnight financing (swap)",
      "gap risk on weekly reopen",
      "halts on circuit-breaker events",
    ],
  },
];

const PROFILES_BY_ID = new Map(BROKER_PROFILES.map((p) => [p.id, p]));

export function getBrokerProfile(id: string): BrokerProfile {
  const p = PROFILES_BY_ID.get(id);
  if (!p) {
    throw new Error(`Unknown broker profile: '${id}'`);
  }
  return p;
}

/** Pure helpers consumed by the AtlasSimAdapter fill engine. */

export interface FillPrices {
  /** Adjusted entry price after spread + slippage applied in the adverse direction. */
  fillPrice: number;
  /** Commission charged on this trade (positive, in dollars). */
  commission: number;
}

/**
 * Compute the actual fill price + commission given a reference price.
 *
 * On BUY: fill is REFERENCE × (1 + halfSpread + slippage), commission charged.
 * On SELL: fill is REFERENCE × (1 - halfSpread - slippage), commission charged.
 */
export function applyFillFriction(
  profile: BrokerProfile,
  args: {
    action: "BUY" | "SELL";
    referencePrice: number;
    qty: number;
    asset: AssetClass;
  },
): FillPrices {
  const halfSpread = profile.spread.by_asset?.[args.asset] ?? profile.spread.half_spread_bps;
  const slip = profile.slippage.additive_bps;
  const adversePct = (halfSpread + slip) / 10_000;
  const sign = args.action === "BUY" ? 1 : -1;
  const fillPrice = args.referencePrice * (1 + sign * adversePct);

  const notional = fillPrice * args.qty;
  const c = profile.commission;
  let commission = 0;
  if (c.flat) commission += c.flat;
  if (c.per_share) commission += c.per_share * args.qty;
  if (c.pct_notional) commission += c.pct_notional * notional;
  if (c.min_per_trade && commission < c.min_per_trade) commission = c.min_per_trade;

  return { fillPrice, commission };
}
