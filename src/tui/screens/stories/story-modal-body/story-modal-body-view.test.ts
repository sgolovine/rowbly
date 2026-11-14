import { describe, expect, it } from "vitest";
import { IMAGE_PASTE_HINT } from "../../../hooks/index.js";
import {
  generalLayoutOf,
  nextTabId,
  specsLayoutOf,
  storyModalHints,
  storyTabIds,
  storyTabLabels,
} from "./story-modal-body-view.js";

const noTabHints = { specHints: [], threadHints: [], attachmentHints: [], modelHints: [], tabOwnsKeys: false };

describe("storyTabIds and storyTabLabels", () => {
  it("has a Specs tab only when the Project has Specs on, and counts the specs and threads", () => {
    expect(storyTabIds(true)).toEqual(["general", "specs", "attachments", "threads", "models"]);
    expect(storyTabIds(false)).toEqual(["general", "attachments", "threads", "models"]);
    expect(storyTabLabels(true, 2, undefined)).toEqual(["General", "Specs 2", "Attachments", "Threads", "Models"]);
    expect(storyTabLabels(false, undefined, 3)).toEqual(["General", "Attachments", "Threads 3", "Models"]);
  });

  it("goes from the last tab to the first tab", () => {
    expect(nextTabId(storyTabIds(false), 2)).toBe("models");
    expect(nextTabId(storyTabIds(false), 3)).toBe("general");
    expect(nextTabId(storyTabIds(false), 0)).toBe("attachments");
  });
});

describe("storyModalHints", () => {
  it("gives only the delete key on the General tab", () => {
    expect(storyModalHints("general", noTabHints)).toEqual([{ key: "ctrl+d", description: "delete" }]);
  });

  it("puts the esc of the tab last, in place of the esc of the Modal", () => {
    const threadHints = [
      { key: "x", description: "interrupt" },
      { key: "esc", description: "back to Threads" },
    ];
    const keys = storyModalHints("threads", { ...noTabHints, threadHints }).map((hint) => hint.key);
    expect(keys[0]).toBe("x");
    expect(keys.at(-1)).toBe("esc");
    expect(keys.filter((key) => key === "esc")).toHaveLength(1);
  });

  it("gives no esc while a region of a tab takes the keys and has no esc", () => {
    const keys = storyModalHints("specs", { ...noTabHints, tabOwnsKeys: true }).map((hint) => hint.key);
    expect(keys).not.toContain("esc");
    expect(storyModalHints("attachments", noTabHints).at(-1)).toEqual({ key: "esc", description: "Story list" });
  });

  it("gives the keys of the Models tab, then the keys of the Modal", () => {
    const modelHints = [
      { key: "↑/↓", description: "select Stage" },
      { key: "enter", description: "change model" },
    ];
    const keys = storyModalHints("models", { ...noTabHints, modelHints }).map((hint) => hint.key);
    expect(keys).toEqual(["↑/↓", "enter", "ctrl+s", IMAGE_PASTE_HINT.key, "shift+tab", "esc"]);
  });
});

describe("layouts", () => {
  it("pads the General tab and lets the Specs tab reach the frame", () => {
    expect(generalLayoutOf(100, 40, 1)).toEqual({ width: 96, height: 35 });
    expect(specsLayoutOf(100, 40, 1)).toEqual({ width: 100, height: 37 });
    expect(generalLayoutOf(100, undefined, 0).height).toBeUndefined();
  });
});
