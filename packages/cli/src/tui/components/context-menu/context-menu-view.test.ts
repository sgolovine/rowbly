import { describe, expect, it } from "vitest";
import { type ContextMenuItem, firstEnabled, menuPlace, menuSize, stepCursor } from "./context-menu-view.js";

const ITEMS: readonly ContextMenuItem[] = [
  { label: "Open", keyName: "enter" },
  { label: "Move to next Stage", keyName: "shift+↓", disabled: true },
  { label: "Move to Backlog" },
  { label: "Delete", keyName: "d", disabled: true },
];

describe("menuSize", () => {
  it("fits the widest label, the widest key and the frame", () => {
    // 7 chrome columns + 18 label columns + 7 key columns; 2 frame rows + 4 items.
    expect(menuSize(ITEMS)).toEqual({ width: 32, height: 6 });
  });
});

describe("menuPlace", () => {
  const size = { width: 20, height: 8 };

  it("opens at the cell below the pointer when the menu fits", () => {
    expect(menuPlace(10, 5, size, { width: 80, height: 24 })).toEqual({ left: 10, top: 5 });
  });

  it("moves in from the right and the bottom edges", () => {
    expect(menuPlace(70, 20, size, { width: 80, height: 24 })).toEqual({ left: 60, top: 16 });
  });

  it("keeps the top-left corner on the screen when the screen is too small", () => {
    expect(menuPlace(5, 5, size, { width: 10, height: 4 })).toEqual({ left: 0, top: 0 });
  });

  it("does not move the menu up when the height is unknown", () => {
    expect(menuPlace(5, 50, size, { width: 80 })).toEqual({ left: 5, top: 50 });
  });
});

describe("firstEnabled", () => {
  it("gives the first item that applies", () => {
    expect(firstEnabled([{ label: "A", disabled: true }, { label: "B" }])).toBe(1);
  });

  it("gives -1 when no item applies", () => {
    expect(firstEnabled([{ label: "A", disabled: true }])).toBe(-1);
  });
});

describe("stepCursor", () => {
  it("moves past the items that do not apply", () => {
    expect(stepCursor(ITEMS, 0, 1)).toBe(2);
    expect(stepCursor(ITEMS, 2, -1)).toBe(0);
  });

  it("stays at the first or the last item that applies", () => {
    expect(stepCursor(ITEMS, 2, 1)).toBe(2);
    expect(stepCursor(ITEMS, 0, -1)).toBe(0);
  });
});
