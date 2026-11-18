import { describe, expect, it } from "vitest";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { menuStory, storyMenuItems } from "./story-menu-items.js";

const STAGES = [{ key: "BACKLOG" }, { key: "DEV" }, { key: "DONE" }] as Stage[];

/** The actions of the items that do not apply. */
function disabled(stageKey: string, forceable: boolean): string[] {
  return storyMenuItems(STAGES, stageKey, forceable)
    .filter((item) => item.disabled)
    .map((item) => item.action);
}

describe("storyMenuItems", () => {
  it("gives the six items in order, with their keys", () => {
    expect(storyMenuItems(STAGES, "DEV", true).map((item) => [item.label, item.keyName])).toEqual([
      ["Open", "enter"],
      ["Move to next Stage", "shift+↓"],
      ["Move to previous Stage", "shift+↑"],
      ["Move to Backlog", undefined],
      ["Delete", "d"],
      ["Force assignment", "ctrl+r"],
    ]);
  });

  it("applies all items to a Story in a middle Stage that the factory can assign", () => {
    expect(disabled("DEV", true)).toEqual([]);
  });

  it("does not move a Story in the first Stage back or to the Backlog", () => {
    expect(disabled("BACKLOG", true)).toEqual(["previous", "backlog"]);
  });

  it("does not move a Story in the last Stage forward", () => {
    expect(disabled("DONE", true)).toEqual(["next"]);
  });

  it("does not force the assignment when canForceAssignment is false", () => {
    expect(disabled("DEV", false)).toEqual(["force"]);
  });
});

describe("menuStory", () => {
  const stories = [{ id: "ROW-1" }, { id: "ROW-2" }] as Story[];

  it("gives the Story when it still exists", () => {
    expect(menuStory(stories, "ROW-2")).toBe(stories[1]);
  });

  it("gives undefined when the Story does not exist", () => {
    expect(menuStory(stories, "ROW-3")).toBeUndefined();
  });
});
