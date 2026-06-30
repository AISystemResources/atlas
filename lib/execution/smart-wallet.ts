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
 */
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
  })) as { accounts: string[] };

  if (!result.accounts || result.accounts.length === 0) {
    throw new Error("Smart Wallet did not return an account");
  }

  return { provider, address: result.accounts[0] };
}
