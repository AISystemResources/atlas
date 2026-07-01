/**
 * Sprint 109 Phase 2: encryption for server-held spender private keys.
 *
 * Uses AES-256-GCM with a master key held in SPENDER_MASTER_KEY env var.
 * The capstone deliverable uses this env-var path with clear documentation;
 * the production upgrade is to move the master key into Supabase Vault
 * (accessed via decrypted_secrets view or a Postgres function) so the app
 * runtime never sees plaintext master.
 *
 * Ciphertext format (base64 encoded):
 *   iv (12 bytes) | authTag (16 bytes) | encrypted payload
 *
 * We store the concatenated blob as a single base64 string in the
 * user_spender_keys.encrypted_private_key column.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const raw = process.env.SPENDER_MASTER_KEY;
  if (!raw || raw.length < 32) {
    throw new Error(
      "SPENDER_MASTER_KEY env var missing or too short (need ≥32 bytes). " +
        "Generate with: openssl rand -hex 32",
    );
  }
  // Accept either raw 32-byte hex (64 chars) or arbitrary length via SHA-256.
  // Hex form is preferred; anything else gets hashed for uniformity.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSpenderKey(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSpenderKey(ciphertextB64: string): string {
  const key = getMasterKey();
  const buf = Buffer.from(ciphertextB64, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("ciphertext too short — payload corrupted or wrong format");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const payload = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(payload), decipher.final()]);
  return plaintext.toString("utf8");
}
