"use client";

import { useState, useEffect } from "react";

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

export function ExecutionClient() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);

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

  async function connect() {
    if (!window.ethereum) {
      setError("MetaMask not detected. Please install the MetaMask browser extension.");
      return;
    }
    const eth = window.ethereum;
    setConnecting(true);
    setError("");
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const chainId = (await eth.request({ method: "eth_chainId" })) as string;
      setWallet({
        address: accounts[0],
        chainId,
        isArbitrumSepolia: chainId === ARBITRUM_SEPOLIA.chainId,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Connection rejected");
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
      // Chain not added yet — add it
      if ((e as { code?: number }).code === 4902) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [ARBITRUM_SEPOLIA],
          });
        } catch {
          setError("Could not add Arbitrum Sepolia to MetaMask.");
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

  function disconnect() {
    setWallet(null);
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 720 }}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "var(--ink)" }}>
          Execution
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>
          Deploy strategies to live markets via gTrade on Arbitrum
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
            <button
              onClick={disconnect}
              className="text-xs"
              style={{ color: "var(--ghost)" }}
            >
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
            {error && (
              <p className="text-xs mt-2" style={{ color: "var(--bear)" }}>
                {error}
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
          Live gTrade execution coming in the next sprint.{" "}
          {!wallet && "Connect your wallet to get started."}
        </p>
      </div>
    </div>
  );
}
