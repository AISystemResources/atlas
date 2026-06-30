"use client";

import { useState, useEffect, useCallback } from "react";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

const ARBITRUM_SEPOLIA = {
  chainId: "0x66eee",
  chainName: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
  blockExplorerUrls: ["https://sepolia.arbiscan.io"],
};

interface WalletState {
  address: string;
  chainId: string;
  isArbitrumSepolia: boolean;
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

export function ExecutionClient() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
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
            setWallet({
              address: accounts[0],
              chainId,
              isArbitrumSepolia: chainId === ARBITRUM_SEPOLIA.chainId,
            });
          });
        }
      })
      .catch(() => {});
  }, []);

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

  async function connect() {
    if (!window.ethereum) {
      setWalletError("MetaMask not detected. Please install the MetaMask browser extension.");
      return;
    }
    const eth = window.ethereum;
    setConnecting(true);
    setWalletError("");
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const chainId = (await eth.request({ method: "eth_chainId" })) as string;
      setWallet({
        address: accounts[0],
        chainId,
        isArbitrumSepolia: chainId === ARBITRUM_SEPOLIA.chainId,
      });
    } catch (e: unknown) {
      setWalletError(e instanceof Error ? e.message : "Connection rejected");
    } finally {
      setConnecting(false);
    }
  }

  async function switchNetwork() {
    if (!window.ethereum) return;
    const eth = window.ethereum;
    setSwitching(true);
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARBITRUM_SEPOLIA.chainId }],
      });
    } catch (e: unknown) {
      if ((e as { code?: number }).code === 4902) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [ARBITRUM_SEPOLIA],
          });
        } catch {
          setWalletError("Could not add Arbitrum Sepolia to MetaMask.");
        }
      }
    } finally {
      setSwitching(false);
      const chainId = (await eth.request({ method: "eth_chainId" })) as string;
      setWallet((w) =>
        w ? { ...w, chainId, isArbitrumSepolia: chainId === ARBITRUM_SEPOLIA.chainId } : w,
      );
    }
  }

  async function checkSignal() {
    if (!selectedId) return;
    setEvaluating(true);
    setSignalError("");
    setSignal(null);
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
  }

  const signalColor =
    signal?.signal === "BUY"
      ? "var(--bull)"
      : signal?.signal === "SELL"
        ? "var(--bear)"
        : "var(--ghost)";

  return (
    <div className="mx-auto" style={{ maxWidth: 720 }}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "var(--ink)" }}>
          Execution
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>
          Evaluate live signals from your strategies and deploy via gTrade on Arbitrum
        </p>
      </div>

      {/* Wallet connection card */}
      <div
        className="rounded-lg p-5 border mb-5"
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
          <div>
            <button
              onClick={connect}
              disabled={connecting}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: connecting ? "var(--elevated)" : "var(--brand)",
                color: connecting ? "var(--ghost)" : "#fff",
              }}
            >
              {connecting ? "Connecting…" : "Connect MetaMask"}
            </button>
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
              {wallet.isArbitrumSepolia ? (
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded-full"
                  style={{ background: "var(--bull)22", color: "var(--bull)" }}
                >
                  Arbitrum Sepolia ✓
                </span>
              ) : (
                <button
                  onClick={switchNetwork}
                  disabled={switching}
                  className="text-xs px-2 py-0.5 rounded-full border"
                  style={{ borderColor: "var(--bear)", color: "var(--bear)" }}
                >
                  {switching ? "Switching…" : "Switch to Arbitrum Sepolia"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Live signal evaluator */}
      <div
        className="rounded-lg p-5 border mb-5"
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
                    {val != null ? Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
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

            {/* Place trade button — 094B */}
            <button
              disabled
              className="w-full py-2.5 rounded-lg text-sm font-medium mt-1"
              style={{ background: "var(--elevated)", color: "var(--ghost)", cursor: "not-allowed" }}
              title="gTrade contract submission coming in Sprint 094B"
            >
              Place Trade on gTrade (coming soon)
            </button>
          </div>
        )}

        {!signal && !signalError && !evaluating && (
          <p className="text-xs" style={{ color: "var(--ghost)" }}>
            Select a strategy and click Check Signal to evaluate the latest market bar.
          </p>
        )}
      </div>

      {/* gTrade info card */}
      <div
        className="rounded-lg p-5 border mb-5"
        style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      >
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--ink)" }}>
          gTrade (Gains Network)
        </h2>
        <div className="flex flex-col gap-2 text-xs" style={{ color: "var(--dim)" }}>
          <p>
            Decentralised CFD perpetuals on Arbitrum. Trade US30 (Dow Jones), crypto, and forex
            using USDC as collateral. No KYC, no account required.
          </p>
          <div className="flex flex-wrap gap-3 mt-2">
            <a
              href="https://gains.trade"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--brand)" }}
            >
              gains.trade ↗
            </a>
            <a
              href="https://faucet.quicknode.com/arbitrum/sepolia"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--brand)" }}
            >
              Arbitrum Sepolia faucet ↗
            </a>
            <a
              href="https://sepolia.arbiscan.io"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--brand)" }}
            >
              Arbiscan ↗
            </a>
          </div>
        </div>
      </div>

      {/* Positions placeholder */}
      <div
        className="rounded-lg p-8 border text-center"
        style={{ borderColor: "var(--line)", borderStyle: "dashed" }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: "var(--ghost)" }}>
          No open positions
        </p>
        <p className="text-xs" style={{ color: "var(--ghost)" }}>
          gTrade on-chain positions will appear here once Sprint 094B ships.{" "}
          {!wallet && "Connect your wallet to get started."}
        </p>
      </div>
    </div>
  );
}
