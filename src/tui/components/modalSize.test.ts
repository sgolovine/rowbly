import { describe, expect, it } from "vitest";
import { modalSize } from "./modalSize.js";

describe("modalSize", () => {
  it("is as wide as maxWidth when there is room, and 2 columns narrower than the room otherwise", () => {
    expect(modalSize({ width: 100 }, { footer: true }).width).toBe(72);
    expect(modalSize({ width: 60 }, { footer: true }).width).toBe(58);
    expect(modalSize({ width: 200 }, { size: "screen", footer: true }).width).toBe(120);
    expect(modalSize({ width: 100 }, { maxWidth: 50, footer: true }).width).toBe(50);
  });

  it("is never narrower than 30 columns", () => {
    expect(modalSize({ width: 10 }, { footer: false }).width).toBe(30);
  });

  it("has no room and no body height without a height", () => {
    const size = modalSize({ width: 100 }, { footer: true });
    expect(size.room).toBeUndefined();
    expect(size.body).toEqual({ width: 66, height: undefined });
  });

  it("gives the padding back to the body of a flush modal", () => {
    expect(modalSize({ width: 100, height: 30 }, { footer: true, flush: true }).body).toEqual({
      width: 70,
      height: 24,
    });
  });

  it("takes the border, the footer and the padding from the body height", () => {
    expect(modalSize({ width: 100, height: 30 }, { footer: true })).toEqual({
      width: 72,
      room: 28,
      body: { width: 66, height: 22 },
    });
    expect(modalSize({ width: 100, height: 30 }, { footer: false }).body.height).toBe(24);
  });

  it("keeps a room of at least 8 lines", () => {
    expect(modalSize({ width: 100, height: 4 }, { footer: false }).room).toBe(8);
  });
});
