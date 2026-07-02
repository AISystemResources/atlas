/**
 * Base Smart Wallet — client-side helper for the AUTO-EXECUTE opt-in path.
 *
 * Sprint 106 removed Smart Wallet as the default consumer flow (browser
 * wallet is the single door for connect + manual trade). Sprint 109 Phase 2
 * brings it back **narrowly scoped** to the ERC-7715 wallet_grantPermissions
 * flow — a user who wants server-side auto-execute must use a Smart Wallet
 * because EOAs can't grant permissions to spenders.
 *
 * Users who only want manual mode stay on browser wallet; users who opt
 * into auto-execute connect a Smart Wallet separately for the grant flow.
 * The two paths coexist on the Execution page.
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

export function getSmartWalletProvider(): EthereumProvider {
  return getSdk().getProvider() as unknown as EthereumProvider;
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

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

export interface SmartWalletConnectResult {
  provider: EthereumProvider;
  address: string;
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
 * Sprint 118: Coinbase Smart Sub-Accounts. Replaces the ERC-7715
 * `grantSpendPermission` path which Coinbase Wallet SDK v2.5.7 does not
 * actually implement (never opens a signing UI, times out, auto-rejects
 * as code 4001 — see Sprint 117 error diagnostic).
 *
 * `wallet_addSubAccount` creates a nested ERC-4337 smart account under
 * the user's Smart Wallet. We register our server-side spender address as
 * the initial signer (type: "address") so the dispatcher can sign
 * UserOperations from the sub-account when signals fire.
 *
 * Trust model:
 *   - The sub-account holds its OWN funds (user tops up separately)
 *   - Blast radius if server is compromised = whatever's in the sub-account
 *   - User revokes by not topping up / calling wallet_revokeSubAccount
 */
export interface CreateSubAccountParams {
  provider: EthereumProvider;
  /** Server-side spender EOA address that will sign UserOperations. */
  spenderAddress: string;
}

/** Shape returned by wallet_addSubAccount. */
export interface SubAccountInfo {
  address: string;
  /** ERC-4337 account factory address — needed by the bundler for the
   *  first UserOperation to deploy the sub-account counterfactually. */
  factory?: string;
  /** ABI-encoded factory init calldata for counterfactual deployment. */
  factoryData?: string;
}

export async function createSubAccount(
  params: CreateSubAccountParams,
): Promise<SubAccountInfo> {
  const { provider, spenderAddress } = params;

  const result = (await provider.request({
    method: "wallet_addSubAccount",
    params: [
      {
        account: {
          type: "create",
          keys: [
            {
              type: "address",
              publicKey: spenderAddress,
            },
          ],
        },
      },
    ],
  })) as SubAccountInfo;

  if (!result || typeof result.address !== "string") {
    throw new Error(
      `wallet_addSubAccount returned an unexpected shape: ${JSON.stringify(result)}`,
    );
  }
  return result;
}
