import { describe, expect, it } from "vitest";
import { isTerminal } from "./thread-types.js";

describe("thread types", () => {
  it("treats only pending and running as active", () => {
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("running")).toBe(false);
    expect(["completed", "failed", "cancelled", "interrupted"].every((s) => isTerminal(s as never))).toBe(true);
  });
});
