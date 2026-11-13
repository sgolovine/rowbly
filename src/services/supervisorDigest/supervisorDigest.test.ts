import { describe, expect, it } from "vitest";
import { promptHash, supervisorDigest } from "./supervisorDigest.js";

describe("supervisor digest", () => {
  it("caps every section at twelve items and supplies a cursor", () => {
    const digest = supervisorDigest({ candidates: Array.from({ length: 100 }, (_, id) => ({ id })) });
    expect(JSON.parse(digest.text).candidates).toMatchObject({ total: 100, nextCursor: 12 });
    expect(JSON.parse(digest.text).candidates.items).toHaveLength(12);
    expect(supervisorDigest({ candidates: Array.from({ length: 100 }, (_, id) => ({ id })) }).hash).toBe(digest.hash);
    expect(promptHash("old")).not.toBe(promptHash("new"));
  });
  it("bounds large Unicode results and returns valid JSON", () => {
    const digest = supervisorDigest({
      reports: Array.from({ length: 100 }, () => ({ summary: "日".repeat(10000) })),
      notes: [],
    });
    expect(Buffer.byteLength(digest.text)).toBeLessThanOrEqual(16384);
    expect(() => JSON.parse(digest.text)).not.toThrow();
  });
});
