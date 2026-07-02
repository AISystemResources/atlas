"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BASE_MAINNET,
  USDC_DECIMALS,
  ensureBaseMainnet,
  isOnBase,
  normalizeChainId,
  readUsdcAllowance,
  readUsdcBalance,
  sendUsdcApprove,
  sendOpenTrade,
  usdcAmount,
  positionSizeUsd,
  dollarsPerPoint,
} from "@/lib/execution/gtrade";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface WalletState {
  address: string;
  chainId: string;
  isOnBase: boolean;
}

interface Strategy {
  id: string;
  name: string;
  version: number;
  ticker: string | null;
  status: string;
}

import { PriceChart, type ChartBar } from "./PriceChart";
import { AutoExecutePanel } from "./AutoExecutePanel";
import { RecentSignals } from "./RecentSignals";

interface SignalResult {
  // Sprint 104B: aligned with CFD trading vocabulary. null = no setup
  // currently active (no badge rendered, no entry/TP/SL shown).
  signal: "LONG" | "SHORT" | null;
  direction: "long" | "short" | null;
  entry_price: number | null;
  take_profit: number | null;
  stop_loss: number | null;
  current_price: number | null;
  last_bar_ts: string | null;
  bars_evaluated: number;
  // Sprint 107: last N OHLC bars for the chart panel.
  chart_bars: ChartBar[];
  strategy: { id: string; name: string; version: number; ticker: string; timeframe: string };
}

type TradeStage =
  | { kind: "idle" }
  | { kind: "approving"; tx?: string }
  | { kind: "trading"; tx?: string }
  | { kind: "success"; tx: string }
  | { kind: "error"; message: string };

// ^DJI index value is ~100× gTrade's DIA pair price (which tracks the DIA ETF).
// When the signal originates from a ^DJI-priced strategy, divide by 100 to get
// the gTrade-pair price the contract's oracle expects. Other tickers: scale=1.
function scaleSignalToGtrade(signalTicker: string, signalPrice: number): number {
  if (signalTicker === "^DJI" || signalTicker.toUpperCase() === "DJI") {
    return signalPrice / 100;
  }
  return signalPrice;
}

// Sprint 115: shared monospace section rule — same idiom as Dashboard,
// Research, Strategy listing, Strategy detail. Keeps the app visually
// coherent across pages.
function SectionRule({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-3"
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
          fontWeight: 600,
          letterSpacing: "0.14em",
          color: "var(--ink)",
        }}
      >
        {label}
      </span>
      <span aria-hidden style={{ flex: 1 }} />
      {right}
    </div>
  );
}

export function ExecutionClient() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [provider, setProvider] = useState<EthereumProvider | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [switching, setSwitching] = useState(false);

  // Strategy selector
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingStrategies, setLoadingStrategies] = useState(false);

  // Signal evaluation
  const [evaluating, setEvaluating] = useState(false);
  const [signal, setSignal] = useState<SignalResult | null>(null);
  const [signalError, setSignalError] = useState("");

  // Trade form
  const [collateralUsdc, setCollateralUsdc] = useState(5);
  const [leverage, setLeverage] = useState(5);
  const [slippagePercent, setSlippagePercent] = useState(1.0);
  const [openPriceOverride, setOpenPriceOverride] = useState<number | null>(null);
  const [tradeStage, setTradeStage] = useState<TradeStage>({ kind: "idle" });
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);

  // Sprint 106: browser wallet is the only path — silently reconnect on
  // mount if the user previously approved the site. The Smart Wallet /
  // Sign in with Base flow was removed as scope creep for the capstone.
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const eth = window.ethereum;
    let cancelled = false;
    (async () => {
      try {
        const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
        if (cancelled || accounts.length === 0) return;
        const rawChain = await eth.request({ method: "eth_chainId" });
        const chainId = normalizeChainId(rawChain) ?? BASE_MAINNET.chainId;
        if (cancelled) return;
        setProvider(eth);
        setWallet({
          address: accounts[0],
          chainId,
          isOnBase: chainId === BASE_MAINNET.chainId,
        });
      } catch {
        // Non-fatal — user can always click Connect.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pull USDC balance whenever the wallet is on Base.
  useEffect(() => {
    if (!wallet?.isOnBase || !provider) {
      setUsdcBalance(null);
      return;
    }
    readUsdcBalance(provider, wallet.address)
      .then(setUsdcBalance)
      .catch(() => setUsdcBalance(null));
  }, [wallet, provider]);

  const loadStrategies = useCallback(async () => {
    setLoadingStrategies(true);
    try {
      const res = await fetch("/api/v1/ticket-logics?scope=mine&status=active&limit=50");
      if (res.ok) {
        const json = (await res.json()) as { strategies?: Strategy[] };
        const list = json.strategies ?? [];
        setStrategies(list);
        if (list.length > 0 && !selectedId) setSelectedId(list[0].id);
      }
    } finally {
      setLoadingStrategies(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadStrategies();
  }, [loadStrategies]);

  async function connectWallet() {
    if (!window.ethereum) {
      setWalletError(
        "No browser wallet detected. Install MetaMask or Coinbase Wallet, then reload.",
      );
      return;
    }
    const eth = window.ethereum;
    setConnecting(true);
    setWalletError("");
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const chainIdRaw = await eth.request({ method: "eth_chainId" });
      const chainId = normalizeChainId(chainIdRaw) ?? BASE_MAINNET.chainId;
      setProvider(eth);
      setWallet({
        address: accounts[0],
        chainId,
        isOnBase: chainId === BASE_MAINNET.chainId,
      });
    } catch (e: unknown) {
      setWalletError(e instanceof Error ? e.message : "Connection rejected");
    } finally {
      setConnecting(false);
    }
  }

  async function switchToBase() {
    if (!provider) return;
    setSwitching(true);
    setWalletError("");
    try {
      await ensureBaseMainnet(provider);
      const onBase = await isOnBase(provider);
      const chainIdRaw = await provider.request({ method: "eth_chainId" });
      const chainId = normalizeChainId(chainIdRaw) ?? BASE_MAINNET.chainId;
      setWallet((w) => (w ? { address: w.address, chainId, isOnBase: onBase } : w));
    } catch (e: unknown) {
      setWalletError(e instanceof Error ? e.message : "Could not switch to Base.");
    } finally {
      setSwitching(false);
    }
  }

  async function checkSignal() {
    if (!selectedId) return;
    setEvaluating(true);
    setSignalError("");
    setSignal(null);
    setOpenPriceOverride(null);
    setTradeStage({ kind: "idle" });
    try {
      const res = await fetch("/api/v1/execution/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: selectedId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSignalError((json as { error?: string }).error ?? "Evaluation failed");
      } else {
        setSignal(json as SignalResult);
      }
    } catch {
      setSignalError("Network error");
    } finally {
      setEvaluating(false);
    }
  }

  function disconnect() {
    setWallet(null);
    setProvider(null);
  }

  // Computed: default openPrice in gTrade scale.
  const gtradeOpenPrice = useMemo(() => {
    if (openPriceOverride !== null) return openPriceOverride;
    if (signal?.current_price == null) return 0;
    return scaleSignalToGtrade(signal.strategy.ticker, signal.current_price);
  }, [openPriceOverride, signal]);

  const gtradeTakeProfit = useMemo(() => {
    if (!signal || signal.take_profit == null) return 0;
    return scaleSignalToGtrade(signal.strategy.ticker, signal.take_profit);
  }, [signal]);

  const gtradeStopLoss = useMemo(() => {
    if (!signal || signal.stop_loss == null) return 0;
    return scaleSignalToGtrade(signal.strategy.ticker, signal.stop_loss);
  }, [signal]);

  async function placeTrade() {
    if (!signal || !wallet || !provider) return;
    if (signal.signal === null) return;

    setTradeStage({ kind: "approving" });
    try {
      const required = usdcAmount(collateralUsdc);

      // 1. Check allowance, approve if needed.
      const allowance = await readUsdcAllowance(provider, wallet.address);
      if (allowance < required) {
        const approveTx = await sendUsdcApprove(provider, wallet.address, required);
        setTradeStage({ kind: "approving", tx: approveTx });
        // Poll allowance until it confirms (Base confirms ~2s/block).
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const a = await readUsdcAllowance(provider, wallet.address);
          if (a >= required) break;
        }
      }

      // 2. Submit the trade.
      setTradeStage({ kind: "trading" });
      const tradeTx = await sendOpenTrade(provider, {
        from: wallet.address,
        long: signal.signal === "LONG",
        collateralUsdc,
        leverage,
        openPrice: gtradeOpenPrice,
        takeProfit: gtradeTakeProfit,
        stopLoss: gtradeStopLoss,
        maxSlippagePercent: slippagePercent,
      });
      setTradeStage({ kind: "success", tx: tradeTx });

      // Refresh balance.
      readUsdcBalance(provider, wallet.address).then(setUsdcBalance).catch(() => {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Trade failed";
      setTradeStage({ kind: "error", message: msg });
    }
  }

  const signalColor =
    signal?.signal === "LONG"
      ? "var(--bull)"
      : signal?.signal === "SHORT"
        ? "var(--bear)"
        : "var(--ghost)";

  const usdcBalanceDollars =
    usdcBalance !== null ? Number(usdcBalance) / 10 ** USDC_DECIMALS : null;
  const insufficientBalance =
    usdcBalanceDollars !== null && usdcBalanceDollars < collateralUsdc;

  const tradePanelDisabled =
    !signal ||
    signal.signal === null ||
    !wallet ||
    !wallet.isOnBase ||
    tradeStage.kind === "approving" ||
    tradeStage.kind === "trading" ||
    insufficientBalance ||
    collateralUsdc <= 0 ||
    leverage < 2 ||
    gtradeOpenPrice <= 0;

  return (
    <div
      className="flex flex-col w-full h-full"
      style={{ maxWidth: 1100, margin: "0 auto", minHeight: 0 }}
    >
      {/* Sprint 115: identity strip matches the rest of the app —
          display-font title with a mono sub-line tracking the flow. */}
      <header className="mb-5 shrink-0">
        <h1
          className="font-display font-bold"
          style={{
            fontSize: 26,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
          }}
        >
          Execution
        </h1>
        <p
          style={{
            fontFamily: "var(--font-jb)",
            fontSize: 11,
            color: "var(--dim)",
            marginTop: 6,
            letterSpacing: "0.04em",
          }}
        >
          LIVE&nbsp;SIGNAL&nbsp;→&nbsp;WALLET&nbsp;→&nbsp;TRADE · Base&nbsp;mainnet · gTrade&nbsp;DIA
        </p>
      </header>

      {/* Two-column body — desktop: Wallet rail + Signal/Trade stack.
          Each column scrolls internally so the page itself doesn't. */}
      <div className="flex flex-col md:flex-row gap-3 flex-1 min-h-0">
        {/* Left rail: Wallet */}
        <aside
          className="md:w-[320px] md:shrink-0 flex flex-col gap-3 md:overflow-y-auto pb-2 md:pb-0"
        >

      {/* Wallet — Sprint 115 mono-terminal restyle */}
      <div>
        <SectionRule
          label="01 · WALLET"
          right={
            wallet ? (
              <button
                onClick={disconnect}
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 10,
                  color: "var(--ghost)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                  textDecoration: "underline",
                }}
              >
                Disconnect
              </button>
            ) : undefined
          }
        />

        {!wallet ? (
          <>
            <button
              onClick={connectWallet}
              disabled={connecting}
              style={{
                width: "100%",
                fontFamily: "var(--font-jb)",
                fontSize: 12,
                padding: "8px 14px",
                borderRadius: 4,
                border: "1px solid var(--brand)",
                background: connecting ? "transparent" : "var(--brand)",
                color: connecting ? "var(--ghost)" : "#fff",
                cursor: connecting ? "default" : "pointer",
                letterSpacing: "0.02em",
              }}
              title="Use MetaMask, Coinbase Wallet, or any browser EVM wallet"
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
            <p
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 10,
                color: "var(--ghost)",
                marginTop: 8,
                lineHeight: 1.5,
              }}
            >
              MetaMask, Coinbase Wallet, or any browser EVM wallet. Switch to
              Base mainnet after connecting.
            </p>
            {walletError && (
              <p
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 11,
                  color: "var(--bear)",
                  marginTop: 8,
                }}
              >
                {walletError}
              </p>
            )}
          </>
        ) : (
          <div
            className="grid"
            style={{
              gridTemplateColumns: "80px minmax(0, 1fr)",
              rowGap: 8,
              columnGap: 12,
              fontFamily: "var(--font-jb)",
              fontSize: 11,
            }}
          >
            <span style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}>
              ADDRESS
            </span>
            <span style={{ color: "var(--ink)", textAlign: "right" }}>
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </span>

            <span style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}>
              NETWORK
            </span>
            <span style={{ textAlign: "right" }}>
              {wallet.isOnBase ? (
                <span style={{ color: "var(--bull)", fontWeight: 600 }}>
                  Base ✓
                </span>
              ) : (
                <button
                  onClick={switchToBase}
                  disabled={switching}
                  style={{
                    fontFamily: "var(--font-jb)",
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 3,
                    border: "1px solid var(--bear)",
                    background: "transparent",
                    color: "var(--bear)",
                    cursor: switching ? "default" : "pointer",
                  }}
                >
                  {switching ? "Switching…" : "Switch to Base"}
                </button>
              )}
            </span>

            {wallet.isOnBase && (
              <>
                <span
                  style={{ color: "var(--ghost)", letterSpacing: "0.06em" }}
                >
                  USDC
                </span>
                <span
                  style={{
                    color: "var(--ink)",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {usdcBalanceDollars != null
                    ? `$${usdcBalanceDollars.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : "—"}
                </span>
              </>
            )}

            {walletError && (
              <span
                style={{
                  gridColumn: "1 / -1",
                  color: "var(--bear)",
                  marginTop: 4,
                }}
              >
                {walletError}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Sprint 109 Phase 2: Auto-execute opt-in card. Only useful when a
          wallet is connected, but the panel handles its own visibility. */}
      <AutoExecutePanel />

        </aside>

        {/* Right column: Signal + Trade — scrolls internally */}
        <section className="flex-1 flex flex-col gap-3 md:overflow-y-auto min-h-0 pb-2 md:pb-0">

      {/* Live signal evaluator — Sprint 115 mono-terminal restyle */}
      <div>
        <SectionRule label="02 · SIGNAL" />
        <div className="flex items-center gap-3 mb-4">
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setSignal(null);
              setSignalError("");
              setTradeStage({ kind: "idle" });
            }}
            disabled={loadingStrategies}
            className="flex-1"
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 3,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--ink)",
            }}
          >
            {loadingStrategies && <option value="">Loading strategies…</option>}
            {!loadingStrategies && strategies.length === 0 && (
              <option value="">No active strategies</option>
            )}
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} v{s.version} {s.ticker ? `· ${s.ticker}` : ""}
              </option>
            ))}
          </select>
          <button
            onClick={checkSignal}
            disabled={evaluating || !selectedId}
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 12,
              padding: "6px 14px",
              borderRadius: 3,
              border: `1px solid ${evaluating || !selectedId ? "var(--line)" : "var(--brand)"}`,
              background: evaluating || !selectedId ? "var(--elevated)" : "var(--brand)",
              color: evaluating || !selectedId ? "var(--ghost)" : "#fff",
              cursor: evaluating || !selectedId ? "not-allowed" : "pointer",
              letterSpacing: "0.04em",
            }}
          >
            {evaluating ? "Evaluating…" : "Check Signal"}
          </button>
        </div>

        {signalError && (
          <p className="text-xs mb-3" style={{ color: "var(--bear)" }}>
            {signalError}
          </p>
        )}

        {signal && (
          <div className="flex flex-col gap-3">
            {/* Sprint 107: candlestick chart. When a signal is live, the
                chart overlays entry/TP/SL as horizontal lines; when flat,
                just the price context. */}
            {signal.chart_bars.length > 0 && (
              <PriceChart
                bars={signal.chart_bars}
                overlay={{
                  entry: signal.entry_price,
                  takeProfit: signal.take_profit,
                  stopLoss: signal.stop_loss,
                  direction: signal.direction,
                }}
                ticker={signal.strategy.ticker}
                timeframe={signal.strategy.timeframe}
              />
            )}

            {signal.signal !== null ? (
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "80px minmax(0, 1fr) auto",
                  rowGap: 8,
                  columnGap: 12,
                  fontFamily: "var(--font-jb)",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span
                  style={{
                    color: "var(--ghost)",
                    letterSpacing: "0.08em",
                    fontSize: 10,
                  }}
                >
                  SIGNAL
                </span>
                <span aria-hidden />
                <span
                  style={{
                    color: signalColor,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                  }}
                >
                  {signal.signal}
                </span>

                <span
                  style={{
                    color: "var(--ghost)",
                    letterSpacing: "0.08em",
                    fontSize: 10,
                  }}
                >
                  ENTRY
                </span>
                <span aria-hidden />
                <span style={{ color: "var(--ink)", textAlign: "right" }}>
                  {signal.entry_price != null
                    ? signal.entry_price.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </span>

                <span
                  style={{
                    color: "var(--ghost)",
                    letterSpacing: "0.08em",
                    fontSize: 10,
                  }}
                >
                  TP
                </span>
                <span aria-hidden />
                <span style={{ color: "var(--bull)", textAlign: "right" }}>
                  {signal.take_profit != null
                    ? signal.take_profit.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </span>

                <span
                  style={{
                    color: "var(--ghost)",
                    letterSpacing: "0.08em",
                    fontSize: 10,
                  }}
                >
                  SL
                </span>
                <span aria-hidden />
                <span style={{ color: "var(--bear)", textAlign: "right" }}>
                  {signal.stop_loss != null
                    ? signal.stop_loss.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </span>
              </div>
            ) : (
              <p
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 11,
                  color: "var(--dim)",
                  lineHeight: 1.6,
                }}
              >
                Flat on the last bar. Wait for the next bar or pick a
                different strategy.
              </p>
            )}

            <p
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 10,
                color: "var(--ghost)",
                letterSpacing: "0.02em",
              }}
            >
              {signal.bars_evaluated.toLocaleString()} bars evaluated
              {signal.last_bar_ts && (
                <>
                  {" · last bar "}
                  {new Date(signal.last_bar_ts).toLocaleString()}
                </>
              )}
            </p>
          </div>
        )}

        {!signal && !signalError && !evaluating && (
          <p
            style={{
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              color: "var(--ghost)",
              lineHeight: 1.6,
            }}
          >
            Pick a strategy and click Check Signal to evaluate the latest bar.
          </p>
        )}
      </div>

      {/* Trade panel — Sprint 115 mono-terminal restyle. Wordy EBC and
          ^DJI-scaling explainers moved to hover-titles; the important
          state is the header note. */}
      {signal && signal.signal !== null && (
        <div>
          <SectionRule
            label="04 · TRADE"
            right={
              <span
                title="EBC matrix: Manual = you approve every trade. AI-open / AI-close / Full-auto require Smart Wallet Spend Permissions — post-capstone."
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 10,
                  color: "var(--dim)",
                  letterSpacing: "0.06em",
                }}
              >
                EBC · MANUAL
              </span>
            }
          />

          {signal.strategy.ticker === "^DJI" && (
            <p
              style={{
                fontFamily: "var(--font-jb)",
                fontSize: 10,
                color: "var(--ghost)",
                marginBottom: 12,
                letterSpacing: "0.02em",
              }}
              title="^DJI index value (~38,000) is auto-divided by 100 for gTrade's DIA pair (~$380)."
            >
              ^DJI → DIA · prices auto-scaled ÷100
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <label className="flex flex-col gap-1">
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 10,
                  color: "var(--ghost)",
                  letterSpacing: "0.06em",
                }}
              >
                Collateral (USDC)
              </span>
              <input
                type="number"
                value={collateralUsdc}
                onChange={(e) => setCollateralUsdc(Math.max(1, Number(e.target.value) || 0))}
                step={0.5}
                min={1}
                max={100}
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 3,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  color: "var(--ink)",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 10,
                  color: "var(--ghost)",
                  letterSpacing: "0.06em",
                }}
              >
                Leverage (2×–100×)
              </span>
              <input
                type="number"
                value={leverage}
                onChange={(e) => setLeverage(Math.max(2, Math.min(100, Number(e.target.value) || 2)))}
                step={1}
                min={2}
                max={100}
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 3,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  color: "var(--ink)",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 10,
                  color: "var(--ghost)",
                  letterSpacing: "0.06em",
                }}
              >
                Slippage tolerance (%)
              </span>
              <input
                type="number"
                value={slippagePercent}
                onChange={(e) => setSlippagePercent(Math.max(0.1, Number(e.target.value) || 0.1))}
                step={0.1}
                min={0.1}
                max={5}
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 3,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  color: "var(--ink)",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 10,
                  color: "var(--ghost)",
                  letterSpacing: "0.06em",
                }}
              >
                Entry price (gTrade scale)
              </span>
              <input
                type="number"
                value={gtradeOpenPrice}
                onChange={(e) => setOpenPriceOverride(Number(e.target.value) || 0)}
                step={0.01}
                style={{
                  fontFamily: "var(--font-jb)",
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 3,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  color: "var(--ink)",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </label>
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              columnGap: 12,
              rowGap: 2,
              marginBottom: 12,
              paddingBottom: 12,
              paddingTop: 6,
              borderBottom: "1px dashed var(--line)",
              fontFamily: "var(--font-jb)",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div>
              <p
                style={{
                  color: "var(--ghost)",
                  letterSpacing: "0.08em",
                  fontSize: 10,
                }}
              >
                POSITION
              </p>
              <p style={{ color: "var(--ink)", fontSize: 13, fontWeight: 600 }}>
                ${positionSizeUsd(collateralUsdc, leverage).toLocaleString()}
              </p>
            </div>
            <div>
              <p
                style={{
                  color: "var(--ghost)",
                  letterSpacing: "0.08em",
                  fontSize: 10,
                }}
              >
                $/POINT
              </p>
              <p style={{ color: "var(--ink)", fontSize: 13, fontWeight: 600 }}>
                ${dollarsPerPoint(collateralUsdc, leverage, gtradeOpenPrice).toLocaleString(
                  undefined,
                  { maximumFractionDigits: 4 },
                )}
              </p>
            </div>
            <div>
              <p
                style={{
                  color: "var(--ghost)",
                  letterSpacing: "0.08em",
                  fontSize: 10,
                }}
              >
                MAX LOSS
              </p>
              <p style={{ color: "var(--bear)", fontSize: 13, fontWeight: 600 }}>
                ${collateralUsdc.toFixed(2)}
              </p>
            </div>
          </div>

          {insufficientBalance && (
            <p className="text-xs mb-2" style={{ color: "var(--bear)" }}>
              Insufficient USDC balance. You need at least ${collateralUsdc.toFixed(2)} USDC on
              Base.
            </p>
          )}

          {!wallet?.isOnBase && wallet && (
            <p className="text-xs mb-2" style={{ color: "var(--bear)" }}>
              Switch to Base network in the Wallet card above before trading.
            </p>
          )}

          <button
            onClick={placeTrade}
            disabled={tradePanelDisabled}
            style={{
              width: "100%",
              fontFamily: "var(--font-jb)",
              fontSize: 13,
              fontWeight: 600,
              padding: "10px 14px",
              borderRadius: 4,
              border: `1px solid ${tradePanelDisabled ? "var(--line)" : "var(--brand)"}`,
              background: tradePanelDisabled ? "var(--elevated)" : "var(--brand)",
              color: tradePanelDisabled ? "var(--ghost)" : "#fff",
              cursor: tradePanelDisabled ? "not-allowed" : "pointer",
              letterSpacing: "0.06em",
            }}
          >
            {tradeStage.kind === "approving"
              ? tradeStage.tx
                ? "Waiting for USDC approval…"
                : "Approve USDC…"
              : tradeStage.kind === "trading"
                ? "Submitting trade…"
                : tradeStage.kind === "success"
                  ? `Trade submitted ✓`
                  : `Place ${signal.signal} on gTrade Base`}
          </button>

          {tradeStage.kind === "approving" && tradeStage.tx && (
            <p className="text-xs mt-2 text-center" style={{ color: "var(--ghost)" }}>
              Approve tx:{" "}
              <a
                href={`${BASE_MAINNET.blockExplorerUrls[0]}/tx/${tradeStage.tx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: "var(--brand)" }}
              >
                {tradeStage.tx.slice(0, 10)}…{tradeStage.tx.slice(-8)}
              </a>
            </p>
          )}
          {tradeStage.kind === "success" && (
            <p className="text-xs mt-2 text-center" style={{ color: "var(--bull)" }}>
              View on Basescan:{" "}
              <a
                href={`${BASE_MAINNET.blockExplorerUrls[0]}/tx/${tradeStage.tx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: "var(--brand)" }}
              >
                {tradeStage.tx.slice(0, 10)}…{tradeStage.tx.slice(-8)}
              </a>
            </p>
          )}
          {tradeStage.kind === "error" && (
            <p className="text-xs mt-2" style={{ color: "var(--bear)" }}>
              {tradeStage.message}
            </p>
          )}
        </div>
      )}

      {/* Sprint 109 Phase 3: recent signal events for the caller. Refreshes
          every 30s so newly-detected auto-executions surface without reload. */}
      <RecentSignals />

        </section>
      </div>
    </div>
  );
}
