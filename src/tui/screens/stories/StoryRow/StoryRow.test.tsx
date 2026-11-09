import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Story } from "../../../../services/story/story.js";
import { renderTui } from "../../../testing/index.js";
import { StoryRow } from "./StoryRow.js";

afterEach(cleanup);

const story: Story = {
  id: "ROW-07",
  number: 7,
  title: "Fix login",
  stage: "DONE",
  position: 1,
  description: "",
  fields: {},
  path: "",
};

describe("StoryRow", () => {
  it("shows the key and title on the left and the Stage on the right, with the bar when selected", async () => {
    const tui = await renderTui(
      <StoryRow story={story} stage={{ name: "Done", category: "done" }} selected clickable onClick={() => {}} />,
    );
    expect(tui.frame()).toMatch(/^▌ ROW-07 Fix login\s+● Done\s*$/);
    await tui.rerender(
      <StoryRow
        story={story}
        stage={{ name: "Done", category: "done" }}
        selected={false}
        clickable
        onClick={() => {}}
      />,
    );
    expect(tui.frame()).toMatch(/^ {2}ROW-07 Fix login/);
  });

  it("calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <StoryRow
        story={story}
        stage={{ name: "Done", category: "done" }}
        selected={false}
        clickable
        onClick={onClick}
      />,
    );
    await tui.click("Fix login");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
