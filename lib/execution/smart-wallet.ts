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
 * Sprint 109 Phase 2: ERC-7715 permission grant. Requests the Smart Wallet
 * to authorise the server-side `spender` address to spend up to
 * `allowanceWei` of USDC (on Base) targeting the gTrade Diamond contract
 * over `periodSeconds`. Returns the grant response containing the on-chain
 * receipt / permission data the server then records to spend_permissions.
 *
 * Shape of the response varies by wallet implementation; we pass through
 * the raw result and let the caller record what's returned. The gate we
 * care about is: did the wallet accept and produce a permission tuple?
 */
export interface GrantPermissionParams {
  provider: EthereumProvider;
  spenderAddress: string;
  tokenAddress: string;
  contractTarget: string;
  allowanceWei: string;
  periodSeconds: number;
  expiresAtEpochSeconds: number;
}

export async function grantSpendPermission(
  params: GrantPermissionParams,
): Promise<unknown> {
  const { provider, spenderAddress, tokenAddress, contractTarget, allowanceWei, periodSeconds, expiresAtEpochSeconds } = params;

  return provider.request({
    method: "wallet_grantPermissions",
    params: [
      {
        chainId: "0x2105", // Base mainnet
        expiry: expiresAtEpochSeconds,
        signer: {
          type: "account",
          data: { address: spenderAddress },
        },
        permissions: [
          {
            type: "erc20-token-spend",
            data: {
              token: tokenAddress,
              amount: allowanceWei,
            },
            policies: [
              {
                type: "token-allowance",
                data: {
                  allowance: allowanceWei,
                  period: periodSeconds,
                },
              },
              {
                type: "contract-call",
                data: {
                  target: contractTarget,
                },
              },
            ],
          },
        ],
      },
    ],
  });
}
