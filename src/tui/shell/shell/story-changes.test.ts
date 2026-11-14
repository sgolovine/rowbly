import { describe, expect, it, vi } from "vitest";
import { getProject } from "../../../services/project/project.js";
import { listStages } from "../../../services/stage/stage.js";
import { createStory, searchStories } from "../../../services/story/story.js";
import { useTestProject } from "../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { createShellRegistry, createToastStore } from "../../hooks/index.js";
import type { ShellEnv } from "./shell-state.js";
import { shellView } from "./shell-view.js";
import { afterDelete, dropStory, moveStage, removeStory, shiftStory } from "./story-changes.js";

/** The shell of the Project in `ctx`, with fake setters. */
async function env(ctx: ServiceContext): Promise<ShellEnv> {
  const [project, stages, stories] = await Promise.all([getProject(ctx), listStages(ctx), searchStories({}, ctx)]);
  const board = { project, stages, stories, activity: { path: "", status: "ok" as const, stories: {} } };
  const view = shellView({
    data: { loading: false, data: board },
    active: true,
    overlay: null,
    pane: "stories",
    storyPane: null,
    mode: "stories",
    sidebarShown: true,
    stageKey: null,
    selectedId: null,
    collapsed: new Set(),
  });

  return {
    ctx,
    view,
    stageKey: null,
    sidebarShown: true,
    registry: createShellRegistry(),
    toast: createToastStore(),
    exit: vi.fn(),
    reload: vi.fn(),
    setCtx: vi.fn(),
    setOverlay: vi.fn(),
    setOnboardingHints: vi.fn(),
    setThreadHints: vi.fn(),
    setMode: vi.fn(),
    setPane: vi.fn(),
    setSidebarWidth: vi.fn(),
    setSidebarShown: vi.fn(),
    setStoryPane: vi.fn(),
    setStoryWidth: vi.fn(),
    setStoryHints: vi.fn(),
    setStageKey: vi.fn(),
    setSelectedId: vi.fn(),
    setCollapsed: vi.fn(),
  };
}

describe("story changes", () => {
  const project = useTestProject();

  it("moves a Story down its Stage and selects it", async () => {
    await createStory({ title: "One" }, project.ctx);
    await createStory({ title: "Two" }, project.ctx);
    const shell = await env(project.ctx);

    shiftStory(shell, shell.view.stories[0] as never, 1);

    await vi.waitFor(() => expect(shell.reload).toHaveBeenCalledOnce());
    expect(shell.setSelectedId).toHaveBeenCalledWith("ROW-01");
    expect((await searchStories({}, project.ctx)).map((s) => s.id)).toEqual(["ROW-02", "ROW-01"]);
  });

  it("drops a Story below the Story above the gap", async () => {
    await createStory({ title: "One" }, project.ctx);
    await createStory({ title: "Two" }, project.ctx);
    await createStory({ title: "Three" }, project.ctx);
    const shell = await env(project.ctx);
    const gap = shell.view.rows.findIndex((row) => row.id === "ROW-03");

    dropStory(shell, "ROW-01", gap);

    await vi.waitFor(() => expect(shell.reload).toHaveBeenCalledOnce());
    expect(shell.setPane).toHaveBeenCalledWith("stories");
    expect((await searchStories({}, project.ctx)).map((s) => s.id)).toEqual(["ROW-02", "ROW-01", "ROW-03"]);
  });

  it("does not write a Stage that stays in its place", async () => {
    const shell = await env(project.ctx);
    const first = shell.view.stages[0];

    moveStage(shell, first?.key ?? "", 1);
    moveStage(shell, "GONE", 2);

    expect(shell.reload).not.toHaveBeenCalled();
  });

  it("deletes a Story, tells the user and selects the next row", async () => {
    await createStory({ title: "One" }, project.ctx);
    await createStory({ title: "Two" }, project.ctx);
    const shell = await env(project.ctx);

    removeStory(shell, shell.view.stories[0] as never);

    await vi.waitFor(() => expect(shell.reload).toHaveBeenCalledOnce());
    expect(shell.toast.list().map((toast) => toast.message)).toEqual(["Deleted ROW-01"]);
    expect(shell.setSelectedId).toHaveBeenCalledWith("ROW-02");
    expect(shell.setOverlay).toHaveBeenCalledWith(null);
  });

  it("selects nothing after the delete of a Story that is not in the list", async () => {
    const shell = await env(project.ctx);

    afterDelete(shell, "ROW-99");

    expect(shell.setSelectedId).toHaveBeenCalledWith(null);
  });
});
