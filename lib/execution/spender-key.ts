/**
 * Sprint 109 Phase 2: per-user spender key provisioning.
 *
 * Generates a fresh Ethereum keypair per user, encrypts the private key at
 * rest via SPENDER_MASTER_KEY, and stores the tuple in user_spender_keys.
 *
 * The private key never touches the user's browser. It is created by the
 * server, held encrypted by the server, and used by the server to sign
 * gTrade trades within the on-chain permission cap the user grants via
 * ERC-7715. The user's own wallet is never asked to hand over private
 * material — they only sign the permission-grant transaction.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getServiceClient } from "@/lib/supabase-server";
import { encryptSpenderKey } from "./spender-key-crypto";

export interface SpenderKeyRecord {
  user_id: string;
  spender_address: string;
  created_at: string;
}

/**
 * Return the caller's spender address, creating one if this is the first
 * call. Idempotent — subsequent calls return the same record without
 * touching the private key.
 */
export async function getOrCreateSpenderKey(userId: string): Promise<SpenderKeyRecord> {
  const sb = getServiceClient();

  const { data: existing } = await sb
    .from("user_spender_keys")
    .select("user_id, spender_address, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return existing as SpenderKeyRecord;

  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const encrypted = encryptSpenderKey(pk);

  const { data: inserted, error } = await sb
    .from("user_spender_keys")
    .insert({
      user_id: userId,
      spender_address: account.address,
      encrypted_private_key: encrypted,
    })
    .select("user_id, spender_address, created_at")
    .single();

  if (error) throw new Error(`spender key insert failed: ${error.message}`);
  return inserted as SpenderKeyRecord;
}

/**
 * Load a spender's private key. Server-side use only — never expose the
 * plaintext key over an API boundary. This should be called immediately
 * before signing a trade and discarded from memory afterward.
 */
export async function loadSpenderPrivateKey(userId: string): Promise<`0x${string}` | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("user_spender_keys")
    .select("encrypted_private_key")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const { decryptSpenderKey } = await import("./spender-key-crypto");
  const pk = decryptSpenderKey(data.encrypted_private_key as string);
  return pk as `0x${string}`;
}
