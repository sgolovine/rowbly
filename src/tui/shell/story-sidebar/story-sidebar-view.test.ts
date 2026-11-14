import { describe, expect, it } from "vitest";
import type { Story } from "../../../services/story/story.js";
import { storyBodyLayout, storySidebarHints, storySidebarTitle } from "./story-sidebar-view.js";

const STORY = { id: "ROW-07" } as Story;

describe("storySidebarTitle", () => {
  it("names the form as the Modals did", () => {
    expect(storySidebarTitle({ kind: "new" })).toBe("New Story");
    expect(storySidebarTitle({ kind: "edit", story: STORY })).toBe("Edit ROW-07");
  });
});

describe("storyBodyLayout", () => {
  it("takes the border, and the padding of the new Story form", () => {
    expect(storyBodyLayout({ kind: "edit", story: STORY }, 40, 20)).toEqual({ width: 38, height: 18 });
    expect(storyBodyLayout({ kind: "new" }, 40, 20)).toEqual({ width: 34, height: 16 });
    expect(storyBodyLayout({ kind: "new" }, 40, undefined)).toEqual({ width: 34, height: undefined });
  });
});

describe("storySidebarHints", () => {
  it("puts the Form keys first and esc last, as the Story list", () => {
    const hints = storySidebarHints(
      [
        {
          keys: [
            { key: "ctrl+s", description: "save" },
            { key: "esc", description: "cancel" },
          ],
        },
      ],
      [{ key: "ctrl+d", description: "delete" }],
    );

    expect(hints).toEqual([
      { key: "ctrl+s", description: "save" },
      { key: "ctrl+d", description: "delete" },
      { key: "esc", description: "Story list" },
    ]);
  });

  it("keeps the esc of a region of a tab", () => {
    const hints = storySidebarHints([], [{ key: "esc", description: "back to specs" }]);

    expect(hints).toEqual([{ key: "esc", description: "back to specs" }]);
  });
});
