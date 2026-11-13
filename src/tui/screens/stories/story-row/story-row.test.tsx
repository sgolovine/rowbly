import { Box } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Story } from "../../../../services/story/story.js";
import { renderTui } from "../../../testing/index.js";
import { StoryRow } from "./story-row.js";

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

  describe("factory activity", () => {
    const stage = { name: "Done", category: "done" } as const;

    it.each([
      [{ kind: "active", label: "claude" }, "▶ claude"],
      [{ kind: "conflict" }, "▶ conflict"],
      [{ kind: "unknown" }, "▶ unknown"],
    ] as const)("shows %o to the left of the Stage", async (activity, text) => {
      const tui = await renderTui(
        <StoryRow story={story} activity={activity} stage={stage} selected clickable onClick={() => {}} />,
      );
      expect(tui.frame()).toMatch(new RegExp(`^▌ ROW-07 Fix login\\s+${text}\\s+● Done\\s*$`));
    });

    it("shows no indicator without activity", async () => {
      const tui = await renderTui(<StoryRow story={story} stage={stage} selected clickable onClick={() => {}} />);
      expect(tui.frame()).not.toContain("▶");
    });

    it("cuts a long label and stays on one line with a long title", async () => {
      const tui = await renderTui(
        <Box width={50}>
          <StoryRow
            story={{ ...story, title: "A very long title that does not fit in the row at all" }}
            activity={{ kind: "active", label: "a-very-long-agent\nname" }}
            stage={stage}
            selected={false}
            clickable
            onClick={() => {}}
          />
        </Box>,
      );
      expect(tui.frame().split("\n")).toHaveLength(1);
      expect(tui.frame()).toContain("▶ a-very-long…");
      expect(tui.frame()).toContain("● Done");
    });
  });
});

it("shows only nonzero saved attachment counts", async () => {
  const tui = await renderTui(
    <StoryRow
      story={{ ...story, attachmentCount: 2 }}
      stage={{ name: "Done", category: "done" }}
      selected
      clickable
      onClick={() => {}}
    />,
  );
  expect(tui.frame()).toContain("▧ 2");
  await tui.rerender(
    <StoryRow
      story={{ ...story, attachmentCount: 0 }}
      stage={{ name: "Done", category: "done" }}
      selected
      clickable
      onClick={() => {}}
    />,
  );
  expect(tui.frame()).not.toContain("▧");
});
