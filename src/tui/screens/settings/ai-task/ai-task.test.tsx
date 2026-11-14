import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stage } from "../../../../services/stage/stage.js";
import { keys, renderTui } from "../../../testing/index.js";
import type { AiProvider } from "../ai-view.js";
import { AiTaskView, type AiTaskViewProps } from "./ai-task.js";

afterEach(cleanup);

const provider = { id: "acme", methods: ["api_key"], configured: true } as unknown as AiProvider;

function props(overrides: Partial<AiTaskViewProps> = {}): AiTaskViewProps {
  return {
    task: null,
    ctx: {},
    runtime: undefined,
    provider,
    status: { providers: [provider], models: [] },
    settings: { version: 1, maxWorkers: 2 } as AiTaskViewProps["settings"],
    onSignInDone: vi.fn(),
    onSignOut: vi.fn(),
    onSaveModel: vi.fn(async () => {}),
    onSaveStageModel: vi.fn(async () => {}),
    onSaveLimit: vi.fn(async () => {}),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("AiTaskView", () => {
  it("shows nothing without a task", async () => {
    const tui = await renderTui(<AiTaskView {...props()} />);

    expect(tui.frame().trim()).toBe("");
  });

  it("asks before a sign-out and signs out on confirm", async () => {
    const p = props({ task: { kind: "signOut" } });
    const tui = await renderTui(<AiTaskView {...p} />);

    expect(tui.frame()).toContain("Sign out of acme?");

    await tui.press("y");

    expect(p.onSignOut).toHaveBeenCalledWith("acme");
  });

  it("shows the model picker of a role and the worker limit", async () => {
    const model = await renderTui(<AiTaskView {...props({ task: { kind: "model", role: "worker" } })} />);

    expect(model.frame()).toContain("AI › Worker model");

    const limit = await renderTui(<AiTaskView {...props({ task: { kind: "limit" } })} />);

    expect(limit.frame()).toContain("AI › Worker limit");
  });

  it("shows the override picker of a Stage with No override, and removes the override with it", async () => {
    const stage = { key: "BACKLOG", label: "Backlog" } as Stage;
    const p = props({
      task: { kind: "stageModel", stage },
      status: {
        providers: [provider],
        models: [{ provider: "acme", modelId: "fast-1", name: "", thinkingLevels: [] }],
      },
      settings: {
        version: 1,
        maxWorkers: 2,
        workerModel: { provider: "acme", modelId: "deep-1" },
        stageWorkerModels: { BACKLOG: { provider: "acme", modelId: "fast-1" } },
      },
    });
    const tui = await renderTui(<AiTaskView {...p} />);

    expect(tui.frame()).toContain("AI › Worker model › Backlog");
    expect(tui.frame()).toContain("No override");
    expect(tui.frame()).not.toContain("Pi default");
    expect(tui.frame()).toMatch(/▌\s*acme\/fast-1/);

    await tui.type("No override");
    await tui.press(keys.enter);

    expect(p.onSaveStageModel).toHaveBeenCalledWith(stage, null);
  });
});
