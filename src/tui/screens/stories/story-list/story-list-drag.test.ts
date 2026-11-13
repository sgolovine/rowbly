import { describe, expect, it, vi } from "vitest";
import type { StoryListRow } from "../story-list-rows.js";
import { clickRow, dropStory, rowDragProps, type StoryListEnv, wheelCursor } from "./story-list-drag.js";

const story = (id: string): StoryListRow => ({
  kind: "story",
  id,
  story: { id, number: 1, title: id, stage: "DOING", position: 1, description: "", fields: {}, path: "" },
  stage: { name: "Doing", category: "board" },
});
const heading: StoryListRow = {
  kind: "stage",
  id: "stage:DOING",
  key: "DOING",
  label: "Doing",
  count: 3,
  collapsed: false,
};
const self = {};

function env(overrides: Partial<StoryListEnv> = {}): StoryListEnv {
  return {
    rows: [heading, story("ROW-01"), story("ROW-02"), story("ROW-03")],
    self,
    cursor: 1,
    setSlot: vi.fn(),
    onCursor: vi.fn(),
    onActivate: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
}

describe("rowDragProps", () => {
  it("gives no drag props without onMove", () => {
    expect(rowDragProps(env({ onMove: undefined }), heading, 0)).toEqual({});
  });

  it("drags a Story but not a heading", () => {
    const list = env();
    expect(rowDragProps(list, story("ROW-01"), 1).drag).toEqual({ list: self, id: "ROW-01" });
    expect(rowDragProps(list, heading, 0).drag).toBeUndefined();
  });

  it("puts the gap above a Story above the dragged Story, below a Story below it, and below a heading", () => {
    const list = env();
    const dragged = { list: self, id: "ROW-02" };
    rowDragProps(list, story("ROW-01"), 1).onDragOver?.(dragged);
    rowDragProps(list, story("ROW-03"), 3).onDragOver?.(dragged);
    rowDragProps(list, heading, 0).onDragOver?.(dragged);
    rowDragProps(list, story("ROW-02"), 2).onDragOver?.(dragged);
    rowDragProps(list, story("ROW-01"), 1).onDragOver?.({ list: {}, id: "ROW-02" });
    expect(vi.mocked(list.setSlot).mock.calls.map(([slot]) => slot)).toEqual([1, 4, 1, null, null]);
  });

  it("moves the dragged Story on a drop", () => {
    const list = env();
    rowDragProps(list, story("ROW-03"), 3).onDrop?.({ list: self, id: "ROW-01" });
    expect(list.onMove).toHaveBeenCalledWith("ROW-01", 4);
    expect(list.setSlot).toHaveBeenCalledWith(null);
  });
});

describe("dropStory", () => {
  it("ends the drag without a move for a drag of another list or without a gap", () => {
    const list = env();
    dropStory(list, { list: {}, id: "ROW-01" }, 2);
    dropStory(list, { list: self, id: "ROW-01" }, null);
    expect(list.onMove).not.toHaveBeenCalled();
    expect(list.setSlot).toHaveBeenCalledTimes(2);
  });
});

describe("clickRow and wheelCursor", () => {
  it("activates the selected row, and selects another row", () => {
    const list = env();
    clickRow(list, 1);
    clickRow(list, 2);
    expect(list.onActivate).toHaveBeenCalledWith(1);
    expect(list.onCursor).toHaveBeenCalledWith(2);
  });

  it("keeps the cursor inside the list on a turn of the wheel", () => {
    const list = env();
    wheelCursor(list, 1, 3);
    wheelCursor(list, -1, 3);
    expect(vi.mocked(list.onCursor).mock.calls.map(([index]) => index)).toEqual([3, 0]);
  });
});
