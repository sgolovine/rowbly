import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stage } from "../../../../services/stage/stage.js";
import type { Story } from "../../../../services/story/story.js";
import { renderTui } from "../../../testing/index.js";
import { storyListRows } from "../storyListRows.js";
import { StoryList } from "./StoryList.js";

afterEach(cleanup);

const stages: Stage[] = [
  { key: "BACKLOG", label: "Backlog", enabled: true, prompt: "", position: 1 },
  { key: "DOING", label: "Doing", enabled: true, prompt: "", position: 2 },
  { key: "DONE", label: "Done", enabled: true, prompt: "", position: 3 },
];
const stories: Story[] = Array.from({ length: 10 }, (_, i) => ({
  id: `ROW-${String(i + 1).padStart(2, "0")}`,
  number: i + 1,
  title: `Story ${i + 1}`,
  stage: stages[i % 3]?.key ?? "BACKLOG",
  position: 1,
  description: "",
  fields: {},
  agentLock: null,
  path: "",
}));

function list(props: Partial<Parameters<typeof StoryList>[0]> = {}) {
  return (
    <StoryList
      rows={storyListRows(stages, stories)}
      cursor={0}
      clickable
      emptyText="No Stories yet."
      onCursor={() => {}}
      {...props}
    />
  );
}

describe("StoryList", () => {
  it("shows every Story with its Stage, and the cursor on one row", async () => {
    const frame = (await renderTui(list({ cursor: 1 }))).frame();
    expect(frame).toMatch(/ {2}ROW-01 Story 1\s+● Backlog/);
    expect(frame).toMatch(/▌ ROW-02 Story 2\s+● Doing/);
    expect(frame).toMatch(/ROW-10 Story 10\s+● Backlog/);
  });

  it("shows the empty text without Stories", async () => {
    expect((await renderTui(list({ rows: [] }))).frame()).toBe("No Stories yet.");
  });

  it("shows the rows around the cursor and the count above and below when the list does not fit", async () => {
    const frame = (await renderTui(list({ cursor: 5, height: 5 }))).frame();
    expect(frame).toContain("↑ 4 more");
    expect(frame).toMatch(/▌ ROW-06 Story 6/);
    expect(frame).toContain("↓ 3 more");
    expect(frame).not.toContain("Story 1 ");
  });

  it("moves the cursor on a click and on the wheel", async () => {
    const onCursor = vi.fn();
    const tui = await renderTui(list({ height: 5, onCursor }));
    await tui.click("Story 2");
    expect(onCursor).toHaveBeenLastCalledWith(1);
    await tui.mouse("wheelDown", 4, 1);
    expect(onCursor).toHaveBeenLastCalledWith(3);
  });

  it("shows a heading for each Stage and indents the Stories below it", async () => {
    const rows = storyListRows(stages, stories, new Set(["DOING"]));
    const frame = (await renderTui(list({ rows, cursor: 0 }))).frame();
    expect(frame).toMatch(/▌ ▾ Backlog \(4\)/);
    expect(frame).toMatch(/ {4}ROW-01 Story 1\s+● Backlog/);
    expect(frame).toMatch(/▸ Doing \(3\)/);
    expect(frame).not.toContain("Story 2 ");
    expect(frame).toMatch(/▾ Done \(3\)/);
  });

  it("calls onActivate on a click on the selected row", async () => {
    const onCursor = vi.fn();
    const onActivate = vi.fn();
    const rows = storyListRows(stages, stories, new Set());
    const tui = await renderTui(list({ rows, cursor: 0, onCursor, onActivate }));
    await tui.click("Backlog (4)");
    expect(onActivate).toHaveBeenCalledWith(0);
    await tui.click("Doing (3)");
    expect(onCursor).toHaveBeenLastCalledWith(5);
  });

  it("selects a Story on the first click and calls onActivate on a click on the selected Story", async () => {
    const onCursor = vi.fn();
    const onActivate = vi.fn();
    const rows = storyListRows(stages, stories, new Set());
    const tui = await renderTui(list({ rows, cursor: 0, onCursor, onActivate }));
    await tui.click("Story 4");
    expect(onCursor).toHaveBeenLastCalledWith(2);
    expect(onActivate).not.toHaveBeenCalled();
    await tui.rerender(list({ rows, cursor: 2, onCursor, onActivate }));
    await tui.click("Story 4");
    expect(onActivate).toHaveBeenLastCalledWith(2);
  });

  it("shows an empty row at the gap where a dragged Story lands, and calls onMove with the gap", async () => {
    const onMove = vi.fn();
    const onCursor = vi.fn();
    const rows = storyListRows(stages, stories, new Set());
    const tui = await renderTui(list({ rows, cursor: 0, onCursor, onMove }));
    const lines = () => tui.frame().split("\n");
    const drag = async (from: string, to: string, release = true) => {
      const start = tui.locate(from);
      const end = tui.locate(to);
      await tui.mouse("press", start.x, start.y);
      await tui.mouse("move", end.x + 1, end.y);
      if (release) await tui.mouse("release", end.x + 1, end.y);
    };
    // Over a Story below the dragged Story, the gap is below it.
    await drag("Story 1 ", "Story 2 ", false);
    const below = lines().findIndex((line) => line.includes("Story 2 "));
    expect(lines()[below + 1]?.trim()).toBe("");
    expect(lines()[below + 2]).toContain("Story 5");
    await tui.mouse("release", 6, below);
    expect(onMove).toHaveBeenLastCalledWith("ROW-01", 7);
    expect(lines().every((line) => line.trim() !== "")).toBe(true);
    // Over a Story above the dragged Story, the gap is above it.
    await drag("Story 7", "Story 1 ", false);
    const above = lines().findIndex((line) => line.includes("Story 1 "));
    expect(lines()[above - 1]?.trim()).toBe("");
    // The pointer can rest on the gap.
    await tui.mouse("move", 6, above - 1);
    expect(lines()[above - 1]?.trim()).toBe("");
    await tui.mouse("release", 6, above - 1);
    expect(onMove).toHaveBeenLastCalledWith("ROW-07", 1);
    // Over a heading, the gap is at the top of its section.
    await drag("Story 4", "Done (3)");
    expect(onMove).toHaveBeenLastCalledWith("ROW-04", 10);
    // Next to the dragged Story, the Story does not move.
    await drag("Story 4", "Story 4");
    expect(onMove).toHaveBeenCalledTimes(3);
    // A press and release in the same cell is a click.
    await tui.click("Story 7");
    expect(onCursor).toHaveBeenLastCalledWith(3);
  });
});
