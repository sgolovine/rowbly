import { describe, expect, it } from "vitest";
import { WHEEL_LINES } from "../hooks/index.js";
import { clampOffset, wheelOffset } from "./scroll-offset.js";

describe("scroll offsets", () => {
  it("keeps an offset within the rows", () => {
    expect(clampOffset(-3, 10)).toBe(0);
    expect(clampOffset(12, 10)).toBe(10);
    expect(clampOffset(4, 10)).toBe(4);
  });

  it("scrolls one notch of the wheel from an offset within the rows", () => {
    expect(wheelOffset(0, 100, 1)).toBe(WHEEL_LINES);
    expect(wheelOffset(50, 2, -1)).toBe(0);
  });
});
