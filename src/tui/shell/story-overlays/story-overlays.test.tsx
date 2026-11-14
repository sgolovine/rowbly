import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProject } from "../../../services/project/project.js";
import { listStages } from "../../../services/stage/stage.js";
import { createStory, searchStories } from "../../../services/story/story.js";
import { useTestProject } from "../../../services/test-project/test-project.js";
import { renderTui } from "../../testing/index.js";
import type { Overlay, OverlayHandlers } from "../overlay.js";
import { StoryOverlays } from "./story-overlays.js";

afterEach(cleanup);

function handlers(): OverlayHandlers {
  return {
    close: vi.fn(),
    openStory: vi.fn(),
    openThread: vi.fn(),
    discardStory: vi.fn(),
    removeStory: vi.fn(),
    stageSaved: vi.fn(),
    openAiSettings: vi.fn(),
    switchProject: vi.fn(),
    reload: vi.fn(),
  };
}

describe("StoryOverlays", () => {
  const project = useTestProject();

  async function open(overlay: (story: Awaited<ReturnType<typeof createStory>>) => Overlay | null) {
    const story = await createStory({ title: "First story" }, project.ctx);
    const board = {
      project: await getProject(project.ctx),
      stages: await listStages(project.ctx),
      stories: await searchStories({}, project.ctx),
    };
    const on = handlers();
    const tui = await renderTui(<StoryOverlays overlay={overlay(story)} board={board} on={on} />);

    return { tui, on, story };
  }

  it("shows nothing without a Story overlay", async () => {
    const { tui } = await open(() => ({ kind: "help" }));

    expect(tui.frame().trim()).toBe("");
  });

  it("opens a Story from the finder", async () => {
    const { tui, on } = await open(() => ({ kind: "finder" }));

    expect(tui.frame()).toContain("Find Stories");
    await tui.click("First story");
    expect(on.openStory).toHaveBeenCalledWith(expect.objectContaining({ id: "ROW-01" }));
  });

  it("asks before it deletes a Story", async () => {
    const { tui, on, story } = await open((created) => ({ kind: "deleteStory", story: created }));

    expect(tui.frame()).toContain("Delete Story › ROW-01");
    await tui.press("y");
    expect(on.removeStory).toHaveBeenCalledWith(story);
  });

  it("asks before it discards the changes of the Story sidebar", async () => {
    const { tui, on } = await open(() => ({ kind: "discardStory", next: { kind: "new" } }));

    expect(tui.frame()).toContain("Close and discard unsaved changes?");
    await tui.press("n");
    expect(on.close).toHaveBeenCalledOnce();
    expect(on.discardStory).not.toHaveBeenCalled();
    await tui.press("y");
    expect(on.discardStory).toHaveBeenCalledWith({ kind: "new" });
  });
});
