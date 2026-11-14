import { cleanup } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { ValidationError } from "../../../../services/errors/errors.js";
import * as factorySettings from "../../../../services/factory-settings/factory-settings.js";
import { updateFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { piCatalogKey, readPiCatalog, writePiCatalog } from "../../../../services/pi-catalog-cache/pi-catalog-cache.js";
import { createStage } from "../../../../services/stage/stage.js";
import { createStory } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui } from "../../../testing/index.js";
import { ModelsTab } from "./models-tab.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The Models tab test must not load Pi");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const runtime = {
  getAvailable: async () => [
    { provider: "acme", id: "deep-1", name: "Deep One", reasoning: true },
    { provider: "acme", id: "fast-1", name: "Fast One", reasoning: false },
  ],
  getProviders: () => [],
  listCredentials: async () => [],
} as unknown as AuthRuntime;

const fast = { provider: "acme", modelId: "fast-1" };
const sol = { provider: "openai", modelId: "gpt-sol" };

describe("ModelsTab", () => {
  const project = useTestProject();

  beforeEach(async () => {
    await createStory({ title: "Login" }, project.ctx);
    await createStage({ label: "Review", key: "REVIEW" }, project.ctx);
  });

  async function open(loadRuntime = vi.fn(async () => runtime)) {
    const onTask = vi.fn();
    const tui = await renderTui(
      <ModelsTab
        ctx={project.ctx}
        storyId="ROW-01"
        selected
        onHints={vi.fn()}
        onTask={onTask}
        loadRuntime={loadRuntime}
      />,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("● Backlog");
      expect(tui.frame()).not.toContain("Loading models");
    });
    return { tui, loadRuntime, onTask };
  }

  it("does not load Pi before the tab is shown, and loads it the first time it is shown", async () => {
    const loadRuntime = vi.fn(async () => runtime);
    const props = { ctx: project.ctx, storyId: "ROW-01", onHints: vi.fn(), onTask: vi.fn(), loadRuntime };
    const tui = await renderTui(<ModelsTab {...props} selected={false} />);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("● Backlog");
    });
    expect(loadRuntime).not.toHaveBeenCalled();
    await tui.rerender(<ModelsTab {...props} selected />);
    await vi.waitFor(() => expect(loadRuntime).toHaveBeenCalledOnce());
    await tui.rerender(<ModelsTab {...props} selected={false} />);
    await tui.rerender(<ModelsTab {...props} selected />);
    expect(loadRuntime).toHaveBeenCalledOnce();
  });

  it("shows a loading text until the models load, and an error toast when Pi does not load", async () => {
    const tui = await renderTui(
      <ModelsTab
        ctx={project.ctx}
        storyId="ROW-01"
        selected
        onHints={vi.fn()}
        onTask={vi.fn()}
        loadRuntime={() => new Promise<AuthRuntime>(() => {})}
      />,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Loading models…");
    });
    const failed = await renderTui(
      <ModelsTab
        ctx={project.ctx}
        storyId="ROW-01"
        selected
        onHints={vi.fn()}
        onTask={vi.fn()}
        loadRuntime={async () => {
          throw new Error("Pi did not load");
        }}
      />,
    );
    await vi.waitFor(() => expect(failed.toasts.list().some((t) => t.message.includes("Pi did not load"))).toBe(true));
    await failed.press(keys.enter);
    expect(failed.frame()).not.toContain("ROW-01 › Model");
  });

  it("shows the Story override, the Stage model or the worker model of each Stage", async () => {
    await updateFactorySettings(
      {
        stageWorkerModels: { DONE: sol },
        storyWorkerModels: { "ROW-01": { REVIEW: { ...fast, thinkingLevel: "low" } } },
      },
      project.ctx,
    );
    const { tui } = await open();
    expect(tui.frame()).toMatch(/● Backlog\s+Worker model: Pi default/);
    expect(tui.frame()).toMatch(/● Done\s+Stage model: openai\/gpt-sol/);
    expect(tui.frame()).toMatch(/● Review\s+acme\/fast-1 · thinking low/);
  });

  it("sets and removes the Story override of a Stage, and keeps the other keys of factory.json", async () => {
    await updateFactorySettings(
      { maxWorkers: 3, workerModel: sol, storyWorkerModels: { "ROW-09": { DONE: sol } } },
      project.ctx,
    );
    const { tui, onTask } = await open();
    await tui.press(keys.down, keys.enter);
    expect(tui.frame()).toContain("ROW-01 › Model › Done");
    expect(tui.frame()).toContain("No override");
    await vi.waitFor(() => expect(onTask).toHaveBeenLastCalledWith(true));
    await tui.type("fast");
    await tui.press(keys.enter);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toMatch(/● Done\s+acme\/fast-1/);
    });
    expect(tui.frame()).not.toContain("ROW-01 › Model ›");
    expect(tui.toasts.list().map((t) => t.message)).toContain("Saved the Done model of ROW-01: acme/fast-1");
    expect(JSON.parse(await project.read("factory.json"))).toEqual({
      version: 1,
      maxWorkers: 3,
      workerModel: sol,
      storyWorkerModels: { "ROW-09": { DONE: sol }, "ROW-01": { DONE: fast } },
    });
    await tui.click("● Done");
    expect(tui.frame()).toContain("ROW-01 › Model › Done");
    await tui.type("No override");
    await tui.press(keys.enter);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toMatch(/● Done\s+Worker model: openai\/gpt-sol/);
    });
    expect(JSON.parse(await project.read("factory.json"))).toEqual({
      version: 1,
      maxWorkers: 3,
      workerModel: sol,
      storyWorkerModels: { "ROW-09": { DONE: sol } },
    });
  });

  it("shows a save error as a toast and keeps the picker open", async () => {
    vi.spyOn(factorySettings, "setWorkerOverride").mockRejectedValue(new ValidationError("Unknown stage"));
    const { tui } = await open();
    await tui.press(keys.enter);
    await tui.type("fast");
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(tui.toasts.list().map((t) => t.message)).toContain("Unknown stage"));
    expect(tui.frame()).toContain("ROW-01 › Model › Backlog");
  });

  describe("with the model cache", () => {
    const cached = { provider: "acme", modelId: "cached-1", name: "Cached One", thinkingLevels: ["off" as const] };

    async function writeCache(version?: string) {
      const key = await piCatalogKey(project.ctx, { version });
      await writePiCatalog({ models: [cached], providers: [] }, key, project.ctx);
    }

    function render(loadRuntime: () => Promise<AuthRuntime>) {
      return renderTui(
        <ModelsTab
          ctx={project.ctx}
          storyId="ROW-01"
          selected
          onHints={vi.fn()}
          onTask={vi.fn()}
          loadRuntime={loadRuntime}
        />,
      );
    }

    async function pickerShows(tui: Awaited<ReturnType<typeof render>>, text: string) {
      await vi.waitFor(async () => {
        await tui.press();
        expect(tui.frame()).not.toContain("Loading models");
      });
      await tui.press(keys.enter);
      await vi.waitFor(async () => {
        await tui.press();
        expect(tui.frame()).toContain(text);
      });
      await tui.press(keys.escape);
    }

    it("shows the models of a fresh cache and never loads Pi", async () => {
      await writeCache();
      const loadRuntime = vi.fn(async () => runtime);
      const tui = await render(loadRuntime);
      await pickerShows(tui, "cached-1");
      expect(tui.frame()).not.toContain("Loading models");
      expect(loadRuntime).not.toHaveBeenCalled();
    });

    it("shows the models of a stale cache first, then the refreshed models, and writes them to the cache", async () => {
      await writeCache("0.0.1-old");
      const pending = { resolve: (_: AuthRuntime) => {} };
      const loaded = new Promise<AuthRuntime>((resolve) => {
        pending.resolve = resolve;
      });
      const loadRuntime = vi.fn(() => loaded);
      const tui = await render(loadRuntime);
      await pickerShows(tui, "cached-1");
      expect(loadRuntime).toHaveBeenCalledOnce();
      pending.resolve(runtime);
      await vi.waitFor(async () =>
        expect((await readPiCatalog(project.ctx))?.models.map((m) => m.modelId)).toEqual(["deep-1", "fast-1"]),
      );
      await pickerShows(tui, "fast-1");
      expect(tui.frame()).not.toContain("cached-1");
      expect((await readPiCatalog(project.ctx))?.fresh).toBe(true);
      expect(loadRuntime).toHaveBeenCalledOnce();
    });

    it("loads Pi when the cache is missing, and writes the cache", async () => {
      const loadRuntime = vi.fn(async () => runtime);
      const tui = await render(loadRuntime);
      await pickerShows(tui, "fast-1");
      expect(loadRuntime).toHaveBeenCalledOnce();
      expect((await readPiCatalog(project.ctx))?.fresh).toBe(true);
    });

    it("keeps the cached models without an error toast when the refresh fails", async () => {
      await writeCache("0.0.1-old");
      const loadRuntime = vi.fn(async (): Promise<AuthRuntime> => {
        throw new Error("Pi did not load");
      });
      const tui = await render(loadRuntime);
      await vi.waitFor(() => expect(loadRuntime).toHaveBeenCalledOnce());
      await pickerShows(tui, "cached-1");
      expect(tui.toasts.list()).toEqual([]);
    });
  });
});
