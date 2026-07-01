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
      {/* Compact header — Sprint 104: single-viewport layout */}
      <div className="mb-3 shrink-0">
        <h1 className="text-xl md:text-2xl font-bold" style={{ color: "var(--ink)" }}>
          Execution
        </h1>
        <p className="text-xs md:text-sm" style={{ color: "var(--dim)" }}>
          Live signal → on-chain trade on Base mainnet via gTrade
        </p>
      </div>

      {/* Two-column body — desktop: Wallet rail + Signal/Trade stack.
          Each column scrolls internally so the page itself doesn't. */}
      <div className="flex flex-col md:flex-row gap-3 flex-1 min-h-0">
        {/* Left rail: Wallet */}
        <aside
          className="md:w-[320px] md:shrink-0 flex flex-col gap-3 md:overflow-y-auto pb-2 md:pb-0"
        >

      {/* Wallet connection card */}
      <div
        className="rounded-lg p-4 border"
        style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
            Wallet
          </h2>
          {wallet && (
            <button onClick={disconnect} className="text-xs" style={{ color: "var(--ghost)" }}>
              Disconnect
            </button>
          )}
        </div>

        {!wallet ? (
          <div className="flex flex-col gap-2">
            <button
              onClick={connectWallet}
              disabled={connecting}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: connecting ? "var(--elevated)" : "var(--brand)",
                color: connecting ? "var(--ghost)" : "#fff",
              }}
              title="Use MetaMask, Coinbase Wallet, or any browser EVM wallet"
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
            <p className="text-xs mt-1" style={{ color: "var(--ghost)" }}>
              Connects to MetaMask, Coinbase Wallet, or any browser EVM wallet you have installed.
              Switch to Base mainnet after connecting.
            </p>
            {walletError && (
              <p className="text-xs mt-2" style={{ color: "var(--bear)" }}>
                {walletError}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--ghost)" }}>
                Address
              </span>
              <span className="text-xs font-mono" style={{ color: "var(--ink)" }}>
                {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--ghost)" }}>
                Network
              </span>
              {wallet.isOnBase ? (
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded-full"
                  style={{ background: "var(--bull)22", color: "var(--bull)" }}
                >
                  Base ✓
                </span>
              ) : (
                <button
                  onClick={switchToBase}
                  disabled={switching}
                  className="text-xs px-2 py-0.5 rounded-full border"
                  style={{ borderColor: "var(--bear)", color: "var(--bear)" }}
                >
                  {switching ? "Switching…" : "Switch to Base"}
                </button>
              )}
            </div>
            {wallet.isOnBase && (
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--ghost)" }}>
                  USDC balance
                </span>
                <span className="text-xs font-mono" style={{ color: "var(--ink)" }}>
                  {usdcBalanceDollars != null
                    ? `$${usdcBalanceDollars.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : "—"}
                </span>
              </div>
            )}
            {walletError && (
              <p className="text-xs mt-1" style={{ color: "var(--bear)" }}>
                {walletError}
              </p>
            )}
          </div>
        )}
      </div>

        </aside>

        {/* Right column: Signal + Trade — scrolls internally */}
        <section className="flex-1 flex flex-col gap-3 md:overflow-y-auto min-h-0 pb-2 md:pb-0">

      {/* Live signal evaluator */}
      <div
        className="rounded-lg p-4 border"
        style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      >
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--ink)" }}>
          Live Signal
        </h2>

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
            className="flex-1 text-xs px-3 py-2 rounded-md border"
            style={{
              borderColor: "var(--line)",
              background: "var(--elevated)",
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
            className="text-xs px-4 py-2 rounded-md font-medium transition-colors"
            style={{
              background: evaluating || !selectedId ? "var(--elevated)" : "var(--brand)",
              color: evaluating || !selectedId ? "var(--ghost)" : "#fff",
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
              <>
                {/* Signal badge */}
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: "var(--ghost)" }}>
                    Signal
                  </span>
                  <span
                    className="text-sm font-bold font-mono px-3 py-1 rounded-full"
                    style={{ background: `${signalColor}22`, color: signalColor }}
                  >
                    {signal.signal}
                  </span>
                </div>

                {/* Numeric levels — precise reference for order entry. Chart
                    shows them visually; this shows them exactly. */}
                <div
                  className="rounded-md p-3 grid grid-cols-3 gap-2"
                  style={{ background: "var(--elevated)" }}
                >
                  {[
                    ["Entry level", signal.entry_price],
                    ["Take profit", signal.take_profit],
                    ["Stop loss", signal.stop_loss],
                  ].map(([label, val]) => (
                    <div key={label as string}>
                      <p className="text-xs mb-0.5" style={{ color: "var(--ghost)" }}>
                        {label}
                      </p>
                      <p className="text-xs font-mono" style={{ color: "var(--ink)" }}>
                        {val != null
                          ? Number(val).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              // No-signal state: chart above already carries the price
              // context, so this is just the waiting message.
              <p
                className="text-xs leading-relaxed px-1"
                style={{ color: "var(--dim)" }}
              >
                No setup fired on the last bar. Strategy is sitting flat —
                check back next bar or pick a different strategy.
              </p>
            )}

            {/* Meta */}
            <p className="text-xs" style={{ color: "var(--ghost)" }}>
              {signal.bars_evaluated.toLocaleString()} bars evaluated
              {signal.last_bar_ts && (
                <> · last bar {new Date(signal.last_bar_ts).toLocaleString()}</>
              )}
            </p>
          </div>
        )}

        {!signal && !signalError && !evaluating && (
          <p className="text-xs" style={{ color: "var(--ghost)" }}>
            Select a strategy and click Check Signal to evaluate the latest market bar.
          </p>
        )}
      </div>

      {/* Trade panel — visible when a LONG or SHORT signal is active */}
      {signal && signal.signal !== null && (
        <div
          className="rounded-lg p-4 border"
          style={{ borderColor: "var(--line)", background: "var(--surface)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
              Place trade on gTrade · Base
            </h2>
            <span
              className="text-xs font-mono px-2 py-0.5 rounded-full"
              style={{ background: "var(--elevated)", color: "var(--dim)" }}
              title="EBC matrix: Manual = you approve every trade. Future modes (AI-open / AI-close / Full-auto) require Smart Wallet Spend Permissions — post-capstone."
            >
              EBC: Manual
            </span>
          </div>

          <p
            className="text-xs mb-3 px-3 py-2 rounded"
            style={{ background: "var(--elevated)", color: "var(--dim)" }}
          >
            <strong>EBC mode — Manual.</strong> You approve every transaction. The full EBC
            matrix (AI-open / AI-close × Human-open / Human-close) applies only at execution
            time on a connected wallet; backtesting is deterministic and not modeled by the
            matrix. Auto modes need Smart Wallet Spend Permissions and are post-capstone work.
          </p>

          {signal.strategy.ticker === "^DJI" && (
            <p
              className="text-xs mb-3 px-3 py-2 rounded"
              style={{ background: "var(--elevated)", color: "var(--dim)" }}
            >
              The strategy prices in ^DJI index value (~38,000). gTrade&apos;s DIA pair tracks the
              DIA ETF (~$380, ÷100). Prices below are auto-scaled.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--ghost)" }}>
                Collateral (USDC)
              </span>
              <input
                type="number"
                value={collateralUsdc}
                onChange={(e) => setCollateralUsdc(Math.max(1, Number(e.target.value) || 0))}
                step={0.5}
                min={1}
                max={100}
                className="text-xs px-3 py-2 rounded-md border font-mono"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--elevated)",
                  color: "var(--ink)",
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--ghost)" }}>
                Leverage (2×–100×)
              </span>
              <input
                type="number"
                value={leverage}
                onChange={(e) => setLeverage(Math.max(2, Math.min(100, Number(e.target.value) || 2)))}
                step={1}
                min={2}
                max={100}
                className="text-xs px-3 py-2 rounded-md border font-mono"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--elevated)",
                  color: "var(--ink)",
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--ghost)" }}>
                Slippage tolerance (%)
              </span>
              <input
                type="number"
                value={slippagePercent}
                onChange={(e) => setSlippagePercent(Math.max(0.1, Number(e.target.value) || 0.1))}
                step={0.1}
                min={0.1}
                max={5}
                className="text-xs px-3 py-2 rounded-md border font-mono"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--elevated)",
                  color: "var(--ink)",
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--ghost)" }}>
                Entry price (gTrade scale)
              </span>
              <input
                type="number"
                value={gtradeOpenPrice}
                onChange={(e) => setOpenPriceOverride(Number(e.target.value) || 0)}
                step={0.01}
                className="text-xs px-3 py-2 rounded-md border font-mono"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--elevated)",
                  color: "var(--ink)",
                }}
              />
            </label>
          </div>

          <div
            className="rounded-md p-3 mb-3 grid grid-cols-3 gap-2 text-xs"
            style={{ background: "var(--elevated)" }}
          >
            <div>
              <p style={{ color: "var(--ghost)" }}>Position size</p>
              <p className="font-mono" style={{ color: "var(--ink)" }}>
                ${positionSizeUsd(collateralUsdc, leverage).toLocaleString()}
              </p>
            </div>
            <div>
              <p style={{ color: "var(--ghost)" }}>$/point</p>
              <p className="font-mono" style={{ color: "var(--ink)" }}>
                $
                {dollarsPerPoint(collateralUsdc, leverage, gtradeOpenPrice).toLocaleString(
                  undefined,
                  { maximumFractionDigits: 4 },
                )}
              </p>
            </div>
            <div>
              <p style={{ color: "var(--ghost)" }}>Max loss</p>
              <p className="font-mono" style={{ color: "var(--ink)" }}>
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
            className="w-full py-2.5 rounded-lg text-sm font-medium"
            style={{
              background: tradePanelDisabled ? "var(--elevated)" : "var(--brand)",
              color: tradePanelDisabled ? "var(--ghost)" : "#fff",
              cursor: tradePanelDisabled ? "not-allowed" : "pointer",
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

        </section>
      </div>
    </div>
  );
}
