/**
 * gTrade Base mainnet — client-side openTrade helper.
 *
 * This module signs and submits trades against the gains.trade
 * GNSMultiCollatDiamond on Base. Signing is MetaMask-side; the server
 * NEVER holds keys. Do not call this from server code or move any of
 * this behind an API route — it is intentionally client-only.
 *
 * Sprint 094B.
 *
 * References (verified against gains.trade docs, 2026-06-30):
 *   - Base mainnet contracts:    https://docs.gains.trade/what-is-gains-network/contract-addresses/base-mainnet.md
 *   - Trade struct shape:        https://docs.gains.trade/developer/technical-reference/contracts/interfaces/types/itradingstorage
 *   - openTrade signature:       https://docs.gains.trade/developer/technical-reference/contracts/interfaces/libraries/itradinginteractionsutils
 *   - DIA/USD pair index:        89 (from https://docs.gains.trade/gtrade-leveraged-trading/pair-list.md)
 */

import { encodeFunctionData, parseUnits } from "viem";

// ─── Network constants ────────────────────────────────────────────────────────

export const BASE_MAINNET = {
  chainId: "0x2105", // 8453 in decimal
  chainName: "Base",
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
} as const;

// ─── Contract addresses ───────────────────────────────────────────────────────
// Source: gains.trade docs, verified 2026-06-30.

/** GNSMultiCollatDiamond — the main Trading contract on Base mainnet. */
export const GTRADE_DIAMOND_BASE = "0x6cD5aC19a07518A8092eEFfDA4f1174C72704eeb" as const;

/** Native USDC on Base (Circle). 6 decimals. */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** USDC precision on Base. 6 decimals — verify before changing. */
export const USDC_DECIMALS = 6;

/**
 * `collateralIndex` to pass in the Trade struct for USDC on Base.
 *
 * Verified 2026-06-30 against gains.trade's Base backend
 * (`https://backend-base.gains.trade/trading-variables` → `collaterals[]`):
 *
 *   { collateralIndex: 1, collateral: 0x833589fCD...02913, symbol: "USDC",
 *     isActive: true, decimals: 6 }
 *
 * If gains.trade ever reorders collaterals, openTrade will revert with an
 * invalid-collateral error and this constant must be updated. Re-verify by
 * calling the backend endpoint above.
 */
export const COLLATERAL_INDEX_USDC_BASE = 1 as const;

/**
 * DIA/USD pair index on gTrade (Dow Jones Industrial Average tracker).
 * Verified 2026-06-30 — same backend endpoint → `pairs[89] = { from: "DIA", to: "USD" }`.
 */
export const PAIR_INDEX_DIA = 89 as const;

// ─── Precision constants ──────────────────────────────────────────────────────

const PRICE_PRECISION = 1e10;     // openPrice / tp / sl: uint64 @ 1e10
const LEVERAGE_PRECISION = 1e3;   // leverage: uint24 @ 1e3
const SLIPPAGE_PRECISION = 1e3;   // maxSlippageP: uint16 @ 1e3 (per docs)

// ─── ABI fragments ────────────────────────────────────────────────────────────
// We only need a few function selectors; using viem's parseAbi-friendly arrays.

const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const TRADING_ABI = [
  {
    type: "function",
    name: "openTrade",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_trade",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "index", type: "uint32" },
          { name: "pairIndex", type: "uint16" },
          { name: "leverage", type: "uint24" },
          { name: "long", type: "bool" },
          { name: "isOpen", type: "bool" },
          { name: "collateralIndex", type: "uint8" },
          { name: "tradeType", type: "uint8" },
          { name: "collateralAmount", type: "uint120" },
          { name: "openPrice", type: "uint64" },
          { name: "tp", type: "uint64" },
          { name: "sl", type: "uint64" },
          { name: "isCounterTrade", type: "bool" },
          { name: "positionSizeToken", type: "uint160" },
          { name: "__placeholder", type: "uint24" },
        ],
      },
      { name: "_maxSlippageP", type: "uint16" },
      { name: "_referrer", type: "address" },
    ],
    outputs: [],
  },
] as const;

// ─── Ethereum provider type ───────────────────────────────────────────────────

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

// ─── Network helpers ──────────────────────────────────────────────────────────

/**
 * Normalise a chainId value to a canonical lowercase hex string.
 *
 * Sprint 104D: EIP-1193 says `eth_chainId` MUST return a hex string like
 * "0x2105". In practice we've seen:
 *   - MetaMask: "0x2105"          → keep
 *   - Coinbase Smart Wallet: "8453" (decimal string) or 8453 (number)
 *   - Some wallets: "0X2105"      → lowercase
 *   - Rare: "2105" (decimal string that LOOKS like hex — treat as decimal
 *     since standard hex chainIds carry a 0x prefix)
 *
 * Returning null lets callers apply their own fallback (e.g. assume Base
 * for Smart Wallet, since the SDK is Base-locked by design).
 */
export function normalizeChainId(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return `0x${v.toString(16)}`;
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed.length === 0) return null;
    if (/^0x[0-9a-f]+$/i.test(trimmed)) return trimmed.toLowerCase();
    if (/^\d+$/.test(trimmed)) return `0x${parseInt(trimmed, 10).toString(16)}`;
  }
  return null;
}

export async function getCurrentChainId(eth: EthereumProvider): Promise<string> {
  const raw = await eth.request({ method: "eth_chainId" });
  const normalized = normalizeChainId(raw);
  if (!normalized) {
    throw new Error(
      `Unexpected chainId shape from provider: ${JSON.stringify(raw)}`,
    );
  }
  return normalized;
}

export async function isOnBase(eth: EthereumProvider): Promise<boolean> {
  const chainId = await getCurrentChainId(eth);
  return chainId === BASE_MAINNET.chainId;
}

/**
 * Switch MetaMask to Base mainnet. If the user doesn't have Base added,
 * walks them through wallet_addEthereumChain first.
 */
export async function ensureBaseMainnet(eth: EthereumProvider): Promise<void> {
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_MAINNET.chainId }],
    });
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [BASE_MAINNET],
      });
    } else {
      throw err;
    }
  }
}

// ─── USDC helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a human dollar amount (e.g. 5 for $5) to USDC base units (6 decimals).
 */
export function usdcAmount(dollars: number): bigint {
  return parseUnits(dollars.toString(), USDC_DECIMALS);
}

/**
 * Read USDC allowance via eth_call. No tx, no gas.
 */
export async function readUsdcAllowance(
  eth: EthereumProvider,
  owner: string,
  spender: string = GTRADE_DIAMOND_BASE,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner as `0x${string}`, spender as `0x${string}`],
  });
  const result = (await eth.request({
    method: "eth_call",
    params: [{ to: USDC_BASE, data }, "latest"],
  })) as string;
  return BigInt(result);
}

export async function readUsdcBalance(
  eth: EthereumProvider,
  owner: string,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner as `0x${string}`],
  });
  const result = (await eth.request({
    method: "eth_call",
    params: [{ to: USDC_BASE, data }, "latest"],
  })) as string;
  return BigInt(result);
}

/**
 * Send an approve tx so the Diamond can pull `amount` of USDC.
 * Resolves to the tx hash. The caller is responsible for waiting for
 * confirmation before calling openTrade — gTrade requires the allowance
 * to be visible at the time of the openTrade call.
 */
export async function sendUsdcApprove(
  eth: EthereumProvider,
  from: string,
  amount: bigint,
  spender: string = GTRADE_DIAMOND_BASE,
): Promise<string> {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender as `0x${string}`, amount],
  });
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: USDC_BASE, data }],
  })) as string;
}

// ─── openTrade ────────────────────────────────────────────────────────────────

export interface OpenTradeParams {
  /** Connected wallet address. */
  from: string;
  /** true = long (BUY), false = short (SELL). */
  long: boolean;
  /** Collateral in USDC dollars (e.g. 5 for $5). */
  collateralUsdc: number;
  /** Leverage multiplier (e.g. 5 for 5x). Range: 2 to 100 on indices. */
  leverage: number;
  /** Current/desired entry price in dollars (e.g. 38123.45). */
  openPrice: number;
  /** Take-profit price in dollars. Pass 0 to disable. */
  takeProfit: number;
  /** Stop-loss price in dollars. Pass 0 to disable. */
  stopLoss: number;
  /** Max slippage percent (e.g. 1.0 = 1.0%). */
  maxSlippagePercent: number;
  /** Optional referrer address. Defaults to zero. Can only be set once per trader. */
  referrer?: string;
  /** Pair index. Defaults to DIA. */
  pairIndex?: number;
}

/**
 * Encode and submit an openTrade call to the GNSMultiCollatDiamond on Base.
 * Resolves to the tx hash. Caller should display a Basescan link and wait
 * for confirmation.
 *
 * Precondition: USDC allowance >= collateralUsdc (in 6-dec units). Use
 * readUsdcAllowance + sendUsdcApprove to ensure.
 */
export async function sendOpenTrade(
  eth: EthereumProvider,
  params: OpenTradeParams,
): Promise<string> {
  const ZERO = "0x0000000000000000000000000000000000000000" as const;

  // Encode Trade struct values with the precision the contract expects.
  const trade = {
    user: params.from as `0x${string}`,
    index: 0,                                         // 0 for a new trade — contract assigns
    pairIndex: params.pairIndex ?? PAIR_INDEX_DIA,
    leverage: Math.round(params.leverage * LEVERAGE_PRECISION),
    long: params.long,
    isOpen: true,
    collateralIndex: COLLATERAL_INDEX_USDC_BASE,
    tradeType: 0,                                     // 0 = TRADE (market order)
    collateralAmount: usdcAmount(params.collateralUsdc),
    openPrice: BigInt(Math.round(params.openPrice * PRICE_PRECISION)),
    tp: params.takeProfit > 0
      ? BigInt(Math.round(params.takeProfit * PRICE_PRECISION))
      : BigInt(0),
    sl: params.stopLoss > 0
      ? BigInt(Math.round(params.stopLoss * PRICE_PRECISION))
      : BigInt(0),
    isCounterTrade: false,
    positionSizeToken: BigInt(0),                     // 0 = contract calculates from collateralAmount × leverage
    __placeholder: 0,
  };

  const maxSlippageP = Math.round(params.maxSlippagePercent * SLIPPAGE_PRECISION);

  const data = encodeFunctionData({
    abi: TRADING_ABI,
    functionName: "openTrade",
    args: [trade, maxSlippageP, (params.referrer ?? ZERO) as `0x${string}`],
  });

  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from: params.from, to: GTRADE_DIAMOND_BASE, data }],
  })) as string;
}

// ─── Convenience: rough position-size + 1-point dollar value ─────────────────

/**
 * Compute the notional position size in dollars: collateral * leverage.
 */
export function positionSizeUsd(collateralUsdc: number, leverage: number): number {
  return collateralUsdc * leverage;
}

/**
 * Estimate the dollar value of a 1-point move on the underlying.
 * For DIA at price `p`, 1 point = 1/p of the notional position.
 */
export function dollarsPerPoint(
  collateralUsdc: number,
  leverage: number,
  underlyingPrice: number,
): number {
  if (underlyingPrice <= 0) return 0;
  return positionSizeUsd(collateralUsdc, leverage) / underlyingPrice;
}

