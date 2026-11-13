import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Story } from "../../../../services/story/story.js";
import { renderTui } from "../../../testing/index.js";
import { StoryListItem } from "./story-list-item.js";

afterEach(cleanup);

const story: Story = {
  id: "ROW-01",
  number: 1,
  title: "Login page",
  stage: "DOING",
  position: 1,
  description: "",
  fields: {},
  path: "",
};

describe("StoryListItem", () => {
  it("shows a Story with its Stage, and calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <StoryListItem
        row={{ kind: "story", id: "ROW-01", story, stage: { name: "Doing", category: "board" } }}
        activity={undefined}
        selected={false}
        clickable
        indented={false}
        onClick={onClick}
        dragProps={{}}
      />,
    );
    expect(tui.frame()).toContain("ROW-01");
    expect(tui.frame()).toContain("Login page");
    expect(tui.frame()).toContain("Doing");
    await tui.click("Login page");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows the heading of a Stage section with its count", async () => {
    const tui = await renderTui(
      <StoryListItem
        row={{ kind: "stage", id: "stage:DOING", key: "DOING", label: "Doing", count: 3, collapsed: true }}
        activity={undefined}
        selected
        clickable
        indented
        onClick={vi.fn()}
        dragProps={{}}
      />,
    );
    expect(tui.frame()).toMatch(/▸ Doing.*3/);
  });
});
