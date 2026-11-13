import { describe, expect, it } from "vitest";
import type { StoryListRow } from "../story-list-rows.js";
import { listWindow, visibleItems } from "./story-list-window.js";

const rows: StoryListRow[] = Array.from({ length: 5 }, (_, i) => ({
  kind: "stage",
  id: `stage:S${i}`,
  key: `S${i}`,
  label: `S${i}`,
  count: 0,
  collapsed: false,
}));

describe("listWindow", () => {
  it("shows every row when the list fits or has no height", () => {
    expect(listWindow(5, undefined, 0, null)).toEqual({ overflow: false, start: 0, shown: 5, above: 0, below: 0 });
    expect(listWindow(5, 5, 4, null).overflow).toBe(false);
  });

  it("centres the cursor in a list that does not fit, and gives a line to the gap", () => {
    expect(listWindow(20, 7, 10, null)).toEqual({ overflow: true, start: 8, shown: 5, above: 8, below: 7 });
    expect(listWindow(20, 7, 10, 9).shown).toBe(4);
    expect(listWindow(20, 7, 0, null)).toMatchObject({ start: 0, above: 0 });
  });
});

describe("visibleItems", () => {
  it("puts the gap before the row at the slot", () => {
    const view = listWindow(5, undefined, 0, 2);
    expect(visibleItems(rows, view, 2).map((item) => (item.kind === "gap" ? "gap" : item.row.id))).toEqual([
      "stage:S0",
      "stage:S1",
      "gap",
      "stage:S2",
      "stage:S3",
      "stage:S4",
    ]);
  });

  it("gives the index in the list of each visible row", () => {
    const view = listWindow(5, 4, 4, null);
    expect(visibleItems(rows, view, null).map((item) => item.index)).toEqual([3, 4]);
  });
});
