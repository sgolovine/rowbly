import { describe, expect, it } from "vitest";
import { columnWidth } from "./column-width.js";

describe("columnWidth", () => {
  it("fits the longest value and adds the padding", () => {
    expect(columnWidth(["To do", "In progress"], 2)).toBe(13);
  });

  it("adds two spaces when the call gives no padding", () => {
    expect(columnWidth(["key"])).toBe(5);
  });

  it("gives only the padding for no values", () => {
    expect(columnWidth([], 4)).toBe(4);
  });
});
