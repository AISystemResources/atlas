/**
 * Base Smart Wallet — client-side wallet helper.
 *
 * Sprint 094C. Wraps @base-org/account so users can sign in with email +
 * passkey (Coinbase Smart Wallet) instead of installing MetaMask. The
 * resulting provider implements the same EIP-1193 `request()` interface
 * as window.ethereum, so it drops straight into the gtrade.ts helpers.
 *
 * Two-sided story (Sprint 095 architecture decision):
 *   - Authors (Pro Claude/ChatGPT users): create + iterate strategies
 *     via MCP. Wallet is MetaMask or Smart Wallet; doesn't matter.
 *   - Consumers (browse + trade public strategies): the audience without
 *     crypto savvy. Smart Wallet's "sign in with email" UX is their
 *     onboarding story.
 */

import { createBaseAccountSDK } from "@base-org/account";

let _sdk: ReturnType<typeof createBaseAccountSDK> | null = null;

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function getSdk() {
  if (typeof window === "undefined") {
    throw new Error("getSdk: must be called in browser context");
  }
  if (!_sdk) {
    _sdk = createBaseAccountSDK({
      appName: "Atlas",
      appLogoUrl: "https://atlas-broker.vercel.app/favicon.ico",
    });
  }
  return _sdk;
}

/** Get the EIP-1193 provider exposed by the Base Smart Wallet SDK. */
export function getSmartWalletProvider(): EthereumProvider {
  return getSdk().getProvider() as unknown as EthereumProvider;
}

/** 16-byte hex nonce for Sign-in with Ethereum. */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface SmartWalletConnectResult {
  provider: EthereumProvider;
  address: string;
}

/**
 * Trigger the email + passkey sign-in flow. Returns the connected provider
 * + first account address. The provider can then be passed to the gtrade.ts
 * helpers (readUsdcBalance, sendUsdcApprove, sendOpenTrade) directly.
 *
 * Sprint 104C: the Base Account SDK returns `accounts` as an array of
 * objects (`{ address: "0x...", capabilities: { ... } }`) when the
 * `signInWithEthereum` capability is used — NOT as an array of plain
 * strings the way legacy EIP-1193 `eth_requestAccounts` does. Guard for
 * both shapes so downstream `wallet.address.slice(0, 6)` renders (and
 * every gTrade helper that treats address as a string) don't blow up.
 */
type AccountEntry = string | { address: string; [key: string]: unknown };

function extractAddress(entry: AccountEntry): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.address === "string") {
    return entry.address;
  }
  throw new Error(
    `Smart Wallet returned an unexpected account shape: ${JSON.stringify(entry)}`,
  );
}

export async function connectSmartWallet(): Promise<SmartWalletConnectResult> {
  const provider = getSmartWalletProvider();
  const result = (await provider.request({
    method: "wallet_connect",
    params: [
      {
        version: "1",
        capabilities: {
          signInWithEthereum: {
            nonce: generateNonce(),
            chainId: "0x2105", // Base mainnet
          },
        },
      },
    ],
  })) as { accounts: AccountEntry[] };

  if (!result.accounts || result.accounts.length === 0) {
    throw new Error("Smart Wallet did not return an account");
  }

  return { provider, address: extractAddress(result.accounts[0]) };
}

/**
 * Sprint 104E: silently check whether the user already has an active Smart
 * Wallet session (persisted in browser storage by the Base Account SDK).
 * Returns the provider + address if so, or null if there's no session —
 * without triggering the sign-in UI. Call this on mount to auto-reconnect
 * users who refreshed the page.
 */
export async function tryReconnectSmartWallet(): Promise<SmartWalletConnectResult | null> {
  if (typeof window === "undefined") return null;
  try {
    const provider = getSmartWalletProvider();
    const raw = await provider.request({ method: "eth_accounts" });
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const address = extractAddress(raw[0] as AccountEntry);
    return { provider, address };
  } catch {
    return null;
  }
}
