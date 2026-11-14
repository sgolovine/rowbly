import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import { getProject } from "../../../services/project/project.js";
import { listStages } from "../../../services/stage/stage.js";
import { useTestProject } from "../../../services/test-project/test-project.js";
import { keys, renderTui } from "../../testing/index.js";
import type { Overlay, OverlayBoard, OverlayHandlers } from "../overlay.js";
import { ShellOverlays } from "./shell-overlays.js";

vi.mock("../../../services/agent-auth/agent-auth.js", async (original) => ({
  ...(await original<typeof import("../../../services/agent-auth/agent-auth.js")>()),
  authRuntime: vi.fn(async () => {
    throw new Error("Pi is not loaded in this test");
  }),
}));

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

describe("ShellOverlays", () => {
  const project = useTestProject();

  async function open(
    overlay: Overlay | null,
    withBoard = true,
    factory: FactoryStatus = { version: 1, phase: "stopped" },
  ) {
    const board: OverlayBoard | undefined = withBoard
      ? { project: await getProject(project.ctx), stages: await listStages(project.ctx), stories: [] }
      : undefined;
    const on = handlers();
    const tui = await renderTui(
      <ShellOverlays
        overlay={overlay}
        board={board}
        ctx={project.ctx}
        launch={undefined}
        factory={factory}
        hints={[{ key: "n", description: "new Story" }]}
        on={on}
      />,
    );

    return { tui, on };
  }

  it("shows nothing without an overlay", async () => {
    const { tui } = await open(null);

    expect(tui.frame().trim()).toBe("");
  });

  it("shows the keys in the help Modal and closes it on esc", async () => {
    const { tui, on } = await open({ kind: "help" }, false);

    expect(tui.frame()).toContain("new Story");
    await tui.press(keys.escape);
    expect(on.close).toHaveBeenCalled();
  });

  it("opens the Project switcher also without a Project", async () => {
    const { tui } = await open({ kind: "projects" }, false);

    expect(tui.frame()).toContain("Projects");
  });

  it("opens the Modals of a Project only when a Project is open", async () => {
    const without = await open({ kind: "newStage" }, false);

    expect(without.tui.frame().trim()).toBe("");
    cleanup();

    const stage = await open({ kind: "newStage" });

    expect(stage.tui.frame()).toContain("New Stage");
  });

  it("opens the settings and the Factory controls", async () => {
    const settings = await open({ kind: "settings" });

    expect(settings.tui.frame()).toContain("Settings");
    cleanup();

    const factory = await open({ kind: "factory" });

    expect(factory.tui.frame()).toContain("Factory");
  });

  it("opens the Checks Modal with the Stage labels of the board, and closes it on esc", async () => {
    const stages = await listStages(project.ctx);
    const stage = stages[0];
    const factory = {
      version: 1,
      phase: "ready",
      liveness: "alive",
      checks: {
        running: 1,
        queued: 0,
        maxConcurrent: 2,
        jobs: [
          {
            ...{ id: "j1", threadId: "t1", storyId: "ROW-01", stage: stage?.key ?? "", key: "test", scope: "full" },
            ...{ status: "running", queuedAt: new Date().toISOString(), startedAt: new Date().toISOString() },
          },
        ],
      },
    } as FactoryStatus;
    const { tui, on } = await open({ kind: "checks" }, true, factory);

    expect(tui.frame()).toContain("Factory › Checks");
    expect(tui.frame()).toContain(`ROW-01 · ${stage?.label} · test`);
    await tui.press(keys.escape);
    expect(on.close).toHaveBeenCalled();
  });
});
