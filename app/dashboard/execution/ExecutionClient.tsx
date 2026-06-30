"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BASE_MAINNET,
  USDC_DECIMALS,
  ensureBaseMainnet,
  isOnBase,
  readUsdcAllowance,
  readUsdcBalance,
  sendUsdcApprove,
  sendOpenTrade,
  usdcAmount,
  positionSizeUsd,
  dollarsPerPoint,
} from "@/lib/execution/gtrade";
import { connectSmartWallet } from "@/lib/execution/smart-wallet";

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

type WalletKind = "metamask" | "smart";

interface WalletState {
  address: string;
  chainId: string;
  isOnBase: boolean;
  kind: WalletKind;
}

interface Strategy {
  id: string;
  name: string;
  version: number;
  ticker: string | null;
  status: string;
}

interface SignalResult {
  signal: "BUY" | "SELL" | "HOLD";
  direction: "long" | "short" | null;
  entry_price: number | null;
  take_profit: number | null;
  stop_loss: number | null;
  current_price: number | null;
  last_bar_ts: string | null;
  bars_evaluated: number;
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
  const [connecting, setConnecting] = useState<WalletKind | null>(null);
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

  // Auto-reconnect to MetaMask if the user previously approved it.
  // Smart Wallet doesn't auto-reconnect — users explicitly click "Sign in with Base".
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const eth = window.ethereum;
    eth
      .request({ method: "eth_accounts" })
      .then((res) => {
        const accounts = res as string[];
        if (accounts.length > 0) {
          eth.request({ method: "eth_chainId" }).then((c) => {
            const chainId = c as string;
            setProvider(eth);
            setWallet({
              address: accounts[0],
              chainId,
              isOnBase: chainId.toLowerCase() === BASE_MAINNET.chainId,
              kind: "metamask",
            });
          });
        }
      })
      .catch(() => {});
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

  async function connectMetaMask() {
    if (!window.ethereum) {
      setWalletError(
        "No browser wallet detected. Install MetaMask or Coinbase Wallet, or sign in with Base instead.",
      );
      return;
    }
    const eth = window.ethereum;
    setConnecting("metamask");
    setWalletError("");
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const chainId = (await eth.request({ method: "eth_chainId" })) as string;
      setProvider(eth);
      setWallet({
        address: accounts[0],
        chainId,
        isOnBase: chainId.toLowerCase() === BASE_MAINNET.chainId,
        kind: "metamask",
      });
    } catch (e: unknown) {
      setWalletError(e instanceof Error ? e.message : "Connection rejected");
    } finally {
      setConnecting(null);
    }
  }

  async function connectSmart() {
    setConnecting("smart");
    setWalletError("");
    try {
      const { provider: sp, address } = await connectSmartWallet();
      setProvider(sp);
      // Smart Wallet's wallet_connect already sets chainId via the
      // capabilities; if it doesn't, eth_chainId will tell us.
      const chainId = ((await sp.request({ method: "eth_chainId" }).catch(
        () => BASE_MAINNET.chainId,
      )) as string) ?? BASE_MAINNET.chainId;
      setWallet({
        address,
        chainId,
        isOnBase: chainId.toLowerCase() === BASE_MAINNET.chainId,
        kind: "smart",
      });
    } catch (e: unknown) {
      setWalletError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setConnecting(null);
    }
  }

  async function switchToBase() {
    if (!provider) return;
    setSwitching(true);
    setWalletError("");
    try {
      await ensureBaseMainnet(provider);
      const onBase = await isOnBase(provider);
      const chainId = (await provider.request({ method: "eth_chainId" })) as string;
      setWallet((w) => (w ? { ...w, chainId, isOnBase: onBase } : w));
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
    if (signal.signal === "HOLD") return;

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
        long: signal.signal === "BUY",
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
    signal?.signal === "BUY"
      ? "var(--bull)"
      : signal?.signal === "SELL"
        ? "var(--bear)"
        : "var(--ghost)";

  const usdcBalanceDollars =
    usdcBalance !== null ? Number(usdcBalance) / 10 ** USDC_DECIMALS : null;
  const insufficientBalance =
    usdcBalanceDollars !== null && usdcBalanceDollars < collateralUsdc;

  const tradePanelDisabled =
    !signal ||
    signal.signal === "HOLD" ||
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
              onClick={connectSmart}
              disabled={connecting !== null}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: connecting === "smart" ? "var(--elevated)" : "var(--brand)",
                color: connecting === "smart" ? "var(--ghost)" : "#fff",
              }}
              title="Email + passkey sign-in. No browser extension required. Recommended."
            >
              {connecting === "smart" ? "Opening sign-in…" : "Sign in with Base (email + passkey)"}
            </button>
            <button
              onClick={connectMetaMask}
              disabled={connecting !== null}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors border"
              style={{
                borderColor: "var(--line)",
                background: "transparent",
                color: connecting !== null ? "var(--ghost)" : "var(--ink)",
              }}
              title="Use MetaMask, Coinbase Wallet, or any browser EVM wallet"
            >
              {connecting === "metamask" ? "Connecting…" : "Connect browser wallet (MetaMask / Coinbase)"}
            </button>
            <p className="text-xs mt-1" style={{ color: "var(--ghost)" }}>
              Sign in with Base uses Coinbase&apos;s Smart Wallet — sign in with email + passkey,
              no seed phrase. Works on Base mainnet by default.
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
                Wallet
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: wallet.kind === "smart" ? "var(--brand)22" : "var(--elevated)",
                  color: wallet.kind === "smart" ? "var(--brand)" : "var(--ink)",
                }}
              >
                {wallet.kind === "smart" ? "Smart Wallet (Base)" : "Browser wallet"}
              </span>
            </div>
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

            {/* Price levels */}
            <div
              className="rounded-md p-3 grid grid-cols-2 gap-2"
              style={{ background: "var(--elevated)" }}
            >
              {[
                ["Current price", signal.current_price],
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

            {/* Meta */}
            <p className="text-xs" style={{ color: "var(--ghost)" }}>
              {signal.bars_evaluated.toLocaleString()} bars evaluated ·{" "}
              {signal.strategy.ticker} {signal.strategy.timeframe}
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

      {/* Trade panel — visible when signal is BUY or SELL */}
      {signal && signal.signal !== "HOLD" && (
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
