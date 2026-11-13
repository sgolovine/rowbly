import { describe, expect, it } from "vitest";
import type { Project } from "../../../services/project/project.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import type { Board } from "./shell-state.js";
import { type ShellViewInput, shellView } from "./shell-view.js";

function stage(key: string, position: number): Stage {
  return { key, label: key.toLowerCase(), enabled: true, prompt: "", position } as Stage;
}

function story(number: number, stageKey: string, position: number): Story {
  const id = `ROW-0${number}`;

  return { id, number, title: id, stage: stageKey, position, description: "", fields: {}, path: "" };
}

const BOARD: Board = {
  project: { root: "/p", projectName: "Rowbly", customFields: [] } as unknown as Project,
  stages: [stage("BACKLOG", 1), stage("DONE", 2)],
  stories: [story(1, "BACKLOG", 1), story(2, "DONE", 1)],
  activity: { path: "/p/.rowbly/state.json", status: "ok", stories: {} },
};

function input(change: Partial<ShellViewInput>): ShellViewInput {
  return {
    data: { loading: false, data: BOARD },
    active: true,
    overlay: null,
    pane: "stories",
    sidebarShown: true,
    stageKey: null,
    selectedId: null,
    collapsed: new Set(),
    ...change,
  };
}

describe("shellView", () => {
  it("tells a first load from a directory without a Project", () => {
    const loading = shellView(input({ data: { loading: true, data: undefined } }));
    const none = shellView(input({ data: { loading: false, data: null } }));

    expect([loading.loading, loading.noProject, loading.board]).toEqual([true, false, undefined]);
    expect([none.noProject, none.board, none.sidebar]).toEqual([true, undefined, false]);
  });

  it("starts the cursor on the first Story, below the heading of its Stage", () => {
    const view = shellView(input({}));

    expect(view.rows.map((row) => row.id)).toEqual(["stage:BACKLOG", "ROW-01", "stage:DONE", "ROW-02"]);
    expect(view.cursor).toBe(1);
    expect(view.cursorStage).toBe("BACKLOG");
  });

  it("shows only the Stories of the Stage of the filter", () => {
    const view = shellView(input({ stageKey: "DONE" }));

    expect(view.rows.map((row) => row.id)).toEqual(["ROW-02"]);
    expect([view.stageIndex, view.cursorStage]).toEqual([2, "DONE"]);
  });

  it("shows every Story again when the Stage of the filter is gone", () => {
    const view = shellView(input({ stageKey: "GONE" }));

    expect(view.stage).toBeUndefined();
    expect(view.stageIndex).toBe(0);
    expect(view.rows).toHaveLength(4);
  });

  it("gives the focus to one pane, and to none while an overlay is open", () => {
    expect(shellView(input({ pane: "stages" }))).toMatchObject({ sidebarFocused: true, listFocused: false });
    expect(shellView(input({ pane: "stories" }))).toMatchObject({ sidebarFocused: false, listFocused: true });
    expect(shellView(input({ overlay: { kind: "help" } }))).toMatchObject({ idle: false, listFocused: false });
  });
});
