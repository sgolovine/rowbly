import { describe, expect, it } from "vitest";
import { shellHints } from "./shell-hints.js";
import type { ShellView } from "./shell-state.js";

function view(change: Partial<ShellView>): ShellView {
  return { board: {}, noProject: false, sidebar: true, sidebarFocused: false, ...change } as unknown as ShellView;
}

function keysOf(hints: readonly { key: string }[]): string[] {
  return hints.map((hint) => hint.key);
}

describe("shellHints", () => {
  it("shows the onboarding keys and the Project switcher without a Project", () => {
    const onboarding = [{ key: "enter", description: "next" }];

    expect(keysOf(shellHints(view({ board: undefined, noProject: true }), true, onboarding))).toEqual(["enter", "p"]);
    expect(keysOf(shellHints(view({ board: undefined }), true, onboarding))).toEqual(["p"]);
  });

  it("shows the Stage keys while the sidebar has the focus", () => {
    const hints = shellHints(view({ sidebarFocused: true, stage: { key: "DONE" } as never }), true, []);

    expect(keysOf(hints)).toEqual(["↑/↓", "n", "e", "shift+↑/↓", "tab", "ctrl+b", "p"]);
  });

  it("shows the keys of the selected Story in the list", () => {
    const row = { kind: "story", id: "ROW-01" } as never;

    expect(keysOf(shellHints(view({ row }), false, []))).toEqual([
      "↑/↓",
      "enter",
      "shift+↑/↓",
      "ctrl+shift+↑/↓",
      "n",
      "d",
      "tab",
      "ctrl+p",
      "p",
      "f",
      ",",
      "ctrl+b",
      "←/→",
    ]);
    expect(shellHints(view({ row }), false, []).find((hint) => hint.key === "ctrl+b")?.description).toBe("show Stages");
  });

  it("shows expand or collapse on a Stage heading", () => {
    const row = { kind: "stage", id: "stage:DONE", collapsed: true } as never;

    expect(shellHints(view({ row }), true, []).find((hint) => hint.key === "enter")?.description).toBe("expand");
  });

  it("shows the keys of the Story sidebar while it is the selected pane", () => {
    const story = [{ key: "ctrl+s", description: "save" }];

    expect(shellHints(view({ storyPane: { kind: "new" }, storyActive: true } as never), true, [], story)).toEqual(
      story,
    );
  });

  it("shows the focus keys and the close key of the Story sidebar in the list", () => {
    const hints = shellHints(view({ storyPane: { kind: "new" } } as never), true, []);

    expect(hints.find((hint) => hint.key === "tab")?.description).toBe("Story");
    expect(hints.find((hint) => hint.key === "shift+tab")?.description).toBe("Stages");
    expect(hints.find((hint) => hint.key === "esc")?.description).toBe("close Story");
  });

  it("shows the keys of the Factory view and t in threads mode", () => {
    const threadHints = [{ key: "enter", description: "open Thread" }];
    const hints = shellHints(view({ mode: "threads" }), true, [], [], threadHints);

    expect(keysOf(hints)).toEqual(["enter", "t", "tab", "ctrl+p", "p", "f", ",", "ctrl+b"]);
    expect(hints.find((hint) => hint.key === "t")?.description).toBe("Stories");
  });

  it("shows the focus keys of the Story sidebar in threads mode, and its own keys while it is the selected pane", () => {
    const story = [{ key: "ctrl+s", description: "save" }];
    const list = shellHints(view({ mode: "threads", storyPane: { kind: "new" } } as never), true, [], story, []);
    const pane = shellHints(
      view({ mode: "threads", storyPane: { kind: "new" }, storyActive: true } as never),
      true,
      [],
      story,
      [],
    );

    expect(list.find((hint) => hint.key === "tab")?.description).toBe("Story");
    expect(list.find((hint) => hint.key === "esc")?.description).toBe("close Story");
    expect(pane).toEqual(story);
  });
});
