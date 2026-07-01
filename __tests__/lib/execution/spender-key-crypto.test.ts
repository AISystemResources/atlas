/**
 * Sprint 109 Phase 2: guardrails around the AES-256-GCM round trip.
 *
 * These tests are terse on purpose: the crypto module is tiny, the risk is
 * silently corrupting private keys, and we want a fast trip-wire if anyone
 * changes the ciphertext format.
 */

import { encryptSpenderKey, decryptSpenderKey } from "@/lib/execution/spender-key-crypto";

const KEY = "a".repeat(64); // 32 bytes of hex 'a'

describe("spender-key-crypto", () => {
  beforeAll(() => {
    process.env.SPENDER_MASTER_KEY = KEY;
  });

  it("round-trips a 32-byte private key", () => {
    const pk = "0x" + "1".repeat(64);
    const ct = encryptSpenderKey(pk);
    expect(ct).not.toContain(pk);
    expect(decryptSpenderKey(ct)).toBe(pk);
  });

  it("produces a different ciphertext each call (fresh IV)", () => {
    const pk = "0x" + "2".repeat(64);
    const a = encryptSpenderKey(pk);
    const b = encryptSpenderKey(pk);
    expect(a).not.toBe(b);
    expect(decryptSpenderKey(a)).toBe(pk);
    expect(decryptSpenderKey(b)).toBe(pk);
  });

  it("rejects corrupted ciphertext", () => {
    const pk = "0x" + "3".repeat(64);
    const ct = encryptSpenderKey(pk);
    // Flip a middle byte in the base64 blob (roughly in the payload region).
    const tampered = ct.slice(0, 20) + (ct[20] === "A" ? "B" : "A") + ct.slice(21);
    expect(() => decryptSpenderKey(tampered)).toThrow();
  });

  it("throws when SPENDER_MASTER_KEY is missing", () => {
    const prev = process.env.SPENDER_MASTER_KEY;
    delete process.env.SPENDER_MASTER_KEY;
    try {
      expect(() => encryptSpenderKey("0xdeadbeef")).toThrow(
        /SPENDER_MASTER_KEY/,
      );
    } finally {
      process.env.SPENDER_MASTER_KEY = prev;
    }
  });
});
