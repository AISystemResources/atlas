/**
 * Sprint 070 — autonomy matrix tests.
 */

import { deriveCell, scalperParticipates } from "@/lib/boundary/autonomy";

describe("deriveCell", () => {
  it("returns ai-opens-ai-closes when both are true (autonomous)", () => {
    expect(
      deriveCell({ ai_intervenes_open: true, ai_intervenes_close: true }),
    ).toBe("ai-opens-ai-closes");
  });

  it("returns human-opens-ai-closes when only close is true (recommended)", () => {
    expect(
      deriveCell({ ai_intervenes_open: false, ai_intervenes_close: true }),
    ).toBe("human-opens-ai-closes");
  });

  it("returns ai-opens-human-closes when only open is true (high-risk)", () => {
    expect(
      deriveCell({ ai_intervenes_open: true, ai_intervenes_close: false }),
    ).toBe("ai-opens-human-closes");
  });

  it("returns human-opens-human-closes when both are false (manual)", () => {
    expect(
      deriveCell({ ai_intervenes_open: false, ai_intervenes_close: false }),
    ).toBe("human-opens-human-closes");
  });
});

describe("scalperParticipates", () => {
  it("is true when AI handles opens", () => {
    expect(scalperParticipates({ ai_intervenes_open: true, ai_intervenes_close: false })).toBe(true);
  });

  it("is true when AI handles closes", () => {
    expect(scalperParticipates({ ai_intervenes_open: false, ai_intervenes_close: true })).toBe(true);
  });

  it("is true when AI handles both", () => {
    expect(scalperParticipates({ ai_intervenes_open: true, ai_intervenes_close: true })).toBe(true);
  });

  it("is false when human owns the entire cycle", () => {
    expect(scalperParticipates({ ai_intervenes_open: false, ai_intervenes_close: false })).toBe(false);
  });
});
