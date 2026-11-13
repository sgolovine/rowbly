import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import * as factory from "../../../services/factory/factory.js";
import { listKnownProjects, RC_FILE, recordProject } from "../../../services/known-project/known-project.js";
import { getProject, initProject } from "../../../services/project/project.js";
import { createStage, listStages } from "../../../services/stage/stage.js";
import { createStory, searchStories } from "../../../services/story/story.js";
import { useTempDir, useTestProject } from "../../../services/test-project/test-project.js";
import type { Layout } from "../../hooks/index.js";
import { LayoutContext } from "../../hooks/index.js";
import { keys, renderTui, settle } from "../../testing/index.js";
import { Shell } from "./shell.js";

// The real status by default; a test can replace it. Pi must not load: the Factory controls ask it about providers.
vi.mock("../../../services/factory/factory.js", async (original) => {
  const actual = await original<typeof import("../../../services/factory/factory.js")>();
  return { ...actual, getFactoryStatus: vi.fn(actual.getFactoryStatus) };
});
vi.mock("../../../services/agent-auth/agent-auth.js", async (original) => ({
  ...(await original<typeof import("../../../services/agent-auth/agent-auth.js")>()),
  authRuntime: vi.fn(async () => {
    throw new Error("Pi is not loaded in this test");
  }),
}));

afterEach(() => {
  cleanup();
  vi.mocked(factory.getFactoryStatus).mockReset();
});

/** A version 1 factory state with one `running` attempt for each `[story, stage, model]`. */
function factoryState(...workers: [story: string, stage: string, model: string][]): string {
  const attempts = workers.map(([story, stage, model]) => ({
    story,
    stage,
    workerId: `w-${story}`,
    model,
    status: "running",
  }));
  return JSON.stringify({ version: 1, updatedAt: null, scan: { count: 1, stages: {} }, attempts });
}

/** Renders the shell and waits for the services to read the project. */
async function open(ctx: { cwd: string }) {
  const tui = await renderTui(<Shell ctx={ctx} />);
  await settle(100);
  await tui.press();
  return tui;
}

/** Renders the shell in a terminal of the size `layout`. */
async function openSized(ctx: { cwd: string }, layout: Layout) {
  const tui = await renderTui(
    <LayoutContext.Provider value={layout}>
      <Shell ctx={ctx} />
    </LayoutContext.Provider>,
  );
  await settle(100);
  await tui.press();
  return tui;
}

describe("Shell", () => {
  const project = useTestProject();

  describe("live refresh", () => {
    /** Waits until a change from outside the TUI is on the screen. */
    const showsSoon = async (tui: Awaited<ReturnType<typeof open>>, text: string) => {
      for (let i = 0; i < 40 && !tui.frame().includes(text); i++) await settle(25);
      expect(tui.frame()).toContain(text);
    };

    /** Waits until `text` is gone from the screen. */
    const goneSoon = async (tui: Awaited<ReturnType<typeof open>>, text: string) => {
      for (let i = 0; i < 40 && tui.frame().includes(text); i++) await settle(25);
      expect(tui.frame()).not.toContain(text);
    };

    it("shows and removes the factory activity of a change from another process", async () => {
      await createStory({ title: "First story" }, project.ctx);
      const tui = await open(project.ctx as { cwd: string });
      expect(tui.frame()).not.toContain("▶");
      await project.write("state.json", factoryState(["ROW-01", "BACKLOG", "claude"]));
      await showsSoon(tui, "▶ claude");
      await project.write("state.json", factoryState());
      await goneSoon(tui, "▶");
    });

    it("keeps the cursor on the selected Story", async () => {
      await createStory({ title: "First story" }, project.ctx);
      await createStory({ title: "Second story" }, project.ctx);
      const tui = await open(project.ctx as { cwd: string });
      await tui.press(keys.down);
      expect(tui.frame()).toMatch(/▌\s*ROW-02/);
      await project.write("state.json", factoryState(["ROW-01", "BACKLOG", "claude"]));
      await showsSoon(tui, "▶ claude");
      expect(tui.frame()).toMatch(/▌\s*ROW-02/);
    });

    it("keeps an open Modal and what the user typed", async () => {
      await createStory({ title: "First story" }, project.ctx);
      const tui = await open(project.ctx as { cwd: string });
      await tui.press("n");
      await tui.type("Draft");
      await project.write("state.json", factoryState(["ROW-01", "BACKLOG", "claude"]));
      await settle(300);
      await tui.press();
      expect(tui.frame()).toContain("New Story");
      expect(tui.frame()).toContain("Draft");
    });

    it("keeps the list when a Story file is invalid for a moment", async () => {
      await createStory({ title: "First story" }, project.ctx);
      const tui = await open(project.ctx as { cwd: string });
      await writeFile(join(project.paths.storiesDir, "ROW-01.md"), "---\ntitle: [\n---\n");
      await settle(300);
      await tui.press();
      expect(tui.frame()).toContain("First story");
      expect(tui.frame()).not.toContain("could not read");
    });

    it("keeps the row on one line in a terminal of 80 columns", async () => {
      await createStory({ title: "A title that is long enough to reach the Stage in the row" }, project.ctx);
      await project.write("state.json", factoryState(["ROW-01", "BACKLOG", "a-very-long-agent-name"]));
      const tui = await openSized(project.ctx as { cwd: string }, { width: 80, height: 24 });
      const row = tui
        .frame()
        .split("\n")
        .find((line) => line.includes("ROW-01"));
      expect(row).toContain("▶ a-very-long…");
      expect(row).toContain("Backlog");
    });
  });

  describe("factory controls", () => {
    it("keeps the board usable without a provider or a runtime, and f opens the Factory controls", async () => {
      await createStory({ title: "First story" }, project.ctx);
      const tui = await open(project.ctx as { cwd: string });
      expect(tui.frame()).toContain("ROW-01");
      expect(tui.frame()).toMatch(/Factory off {2}f/);
      await tui.press("f");
      await settle(50);
      await tui.press();
      expect(tui.frame()).toMatch(/Status\s+Stopped/);
      expect(tui.frame()).toContain("limit 4");
      await tui.press(keys.escape);
      expect(tui.frame()).not.toContain("Stopped");
      await tui.press(keys.enter);
      expect(tui.frame()).toContain("Threads");
    });

    it("opens the AI settings from the Factory controls with a", async () => {
      await createStory({ title: "First story" }, project.ctx);
      const tui = await open(project.ctx as { cwd: string });
      await tui.press("f");
      await settle(50);
      await tui.press("a");
      await settle(50);
      await tui.press();
      expect(tui.frame()).toContain("Rowbly › Settings");
      expect(tui.frame()).toContain("╭─AI─");
      expect(tui.frame()).toMatch(/Worker limit\s+4/);
      expect(tui.frame()).toMatch(/▌ AI/);
      expect(tui.frame()).not.toContain("Status");
    });

    it("updates the counts of the header quietly when the factory writes its status", async () => {
      await createStory({ title: "First story" }, project.ctx);
      const tui = await open(project.ctx as { cwd: string });
      expect(tui.frame()).toContain("Factory off");
      vi.mocked(factory.getFactoryStatus).mockResolvedValue({
        version: 1,
        phase: "ready",
        liveness: "alive",
        responsive: true,
        workers: { running: 1, pending: 1, waiting: 0, limit: 4 },
      } as FactoryStatus);
      await mkdir(join(project.paths.dir, "runtime"), { recursive: true });
      await writeFile(join(project.paths.dir, "runtime/status.json"), "{}\n");
      for (let i = 0; i < 40 && !tui.frame().includes("1/4 · 1 pending"); i++) await settle(25);
      expect(tui.frame()).toContain("Factory 1/4 · 1 pending");
      expect(tui.frame()).not.toContain("Loading");
    });
  });

  describe("factory state file", () => {
    const showsSoon = async (tui: Awaited<ReturnType<typeof open>>, text: string, shown = true) => {
      for (let i = 0; i < 40 && tui.frame().includes(text) !== shown; i++) await settle(25);
      expect(tui.frame().includes(text)).toBe(shown);
    };
    const count = (frame: string, text: string) => frame.split(text).length - 1;

    it("shows no status line when the file does not exist, and the header shows the stopped factory", async () => {
      await createStory({ title: "First story" }, project.ctx);
      const tui = await open(project.ctx as { cwd: string });
      expect(tui.frame()).not.toContain("Factory activity");
      expect(tui.frame()).toContain("Factory off");
      expect(tui.frame()).not.toContain("▶");
    });

    it("shows no status line for a valid file", async () => {
      await createStory({ title: "First story" }, project.ctx);
      await project.write("state.json", factoryState(["ROW-01", "BACKLOG", "claude"]));
      const tui = await open(project.ctx as { cwd: string });
      expect(tui.frame()).toContain("▶ claude");
      expect(tui.frame()).not.toContain("Factory activity");
    });

    it("shows a warning with the path for a corrupt file, and still shows the Stories", async () => {
      await createStory({ title: "First story" }, project.ctx);
      await project.write("state.json", "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> main\n");
      const tui = await openSized(project.ctx as { cwd: string }, { width: 160, height: 24 });
      expect(tui.frame()).toContain("First story");
      expect(tui.frame()).toContain(
        `! Factory activity is unavailable: ${join(project.paths.dir, "state.json")}: The file has Git conflict markers`,
      );
    });

    it("removes the indicators when the file becomes invalid and shows them again when it is valid, with no toast", async () => {
      await createStory({ title: "First story" }, project.ctx);
      await project.write("state.json", factoryState(["ROW-01", "BACKLOG", "claude"]));
      const tui = await openSized(project.ctx as { cwd: string }, { width: 160, height: 24 });
      expect(tui.frame()).toContain("▶ claude");
      await project.write("state.json", "{ nope");
      await showsSoon(tui, "▶ claude", false);
      await showsSoon(tui, "Factory activity is unavailable");
      expect(count(tui.frame(), "not valid JSON")).toBe(1);
      await project.write("state.json", factoryState(["ROW-01", "BACKLOG", "claude"]));
      await showsSoon(tui, "▶ claude");
      expect(tui.frame()).not.toContain("Factory activity");
      expect(tui.frame()).not.toContain("not valid JSON");
    });

    it("creates and moves a Story while the file is corrupt", async () => {
      await createStory({ title: "Alpha" }, project.ctx);
      await project.write("state.json", "{ nope");
      const tui = await open(project.ctx as { cwd: string });
      await tui.press("n");
      await tui.type("Bravo");
      await tui.press(keys.ctrl("s"));
      await settle(100);
      await tui.press();
      expect((await searchStories({}, project.ctx)).map((s) => s.title)).toEqual(["Alpha", "Bravo"]);
      await tui.press(keys.ctrlShiftDown);
      await settle(100);
      expect((await searchStories({ stage: "DONE" }, project.ctx)).length).toBe(1);
      expect(await project.read("state.json")).toBe("{ nope");
    });
  });

  describe("responsive layout", () => {
    it("keeps the Stage sidebar beside the Story list when the terminal is wide", async () => {
      const tui = await openSized(project.ctx as { cwd: string }, { width: 100, height: 24 });
      expect(tui.locate("╭─Stages").y).toBe(tui.locate("Rowbly › All Stages").y);
    });

    it("puts the Stage sidebar above the Story list when the terminal is narrow", async () => {
      await createStory({ title: "First story" }, project.ctx);
      const tui = await openSized(project.ctx as { cwd: string }, { width: 60, height: 24 });
      expect(tui.locate("╭─Stages").y).toBeLessThan(tui.locate("Rowbly › All Stages").y);
      expect(tui.locate("╭─Stages").x).toBe(tui.locate("Rowbly › All Stages").x - 2);
      expect(tui.frame()).toContain("First story");
      await tui.press(keys.tab, keys.down);
      expect(tui.frame()).toContain("Rowbly › Backlog");
    });

    it("keeps the Stage sidebar beside the list when a narrow terminal is too short for both", async () => {
      const tui = await openSized(project.ctx as { cwd: string }, { width: 60, height: 12 });
      expect(tui.locate("╭─Stages").y).toBe(tui.locate("Rowbly › All Stages").y);
    });

    it("keeps the selected Stage in view when the stacked sidebar is too short for every Stage", async () => {
      for (const label of ["One", "Two", "Three", "Four", "Five", "Six"]) await createStage({ label }, project.ctx);
      const tui = await openSized(project.ctx as { cwd: string }, { width: 60, height: 24 });
      expect(tui.frame()).toContain("more");
      await tui.press(keys.tab, keys.down, keys.down, keys.down, keys.down, keys.down, keys.down);
      expect(tui.frame()).toMatch(/▌ \w+/);
      expect(tui.frame()).toMatch(/Rowbly › \w+/);
    });

    it("opens a Modal over the whole main area when the terminal is narrow", async () => {
      const tui = await openSized(project.ctx as { cwd: string }, { width: 60, height: 24 });
      await tui.press("n");
      expect(tui.frame()).toContain("New Story");
      // The Modal starts above the top edge of the Story list, so it is not limited to the list.
      expect(tui.locate("╭─New Story").y).toBeLessThan(tui.locate("╭─R").y);
    });
  });

  it("shows the header, the Stage sidebar, the Story list and the footer", async () => {
    await createStory({ title: "First story" }, project.ctx);
    await createStory({ title: "Shipped story", stage: "DONE" }, project.ctx);
    const frame = (await open(project.ctx as { cwd: string })).frame();
    expect(frame).toContain("Find Stories");
    expect(frame).toMatch(/\+ New Story\s+n/);
    expect(frame).toContain("╭─Stages");
    expect(frame).toMatch(/▌ All Stages/);
    expect(frame).toMatch(/Backlog\s+✎/);
    expect(frame).toMatch(/Done\s+✎/);
    expect(frame).toContain("+ New Stage");
    expect(frame).toContain("Rowbly › All Stages");
    expect(frame).toMatch(/▌ {3}ROW-01 First story\s+● Backlog/);
    expect(frame).toMatch(/ROW-02 Shipped story\s+● Done/);
    expect(frame).toContain("n new Story");
    expect(frame).toMatch(/v\d+\.\d+\.\d+/);
  });

  it("filters the Stories by the Stage that is selected in the sidebar", async () => {
    await createStory({ title: "First story" }, project.ctx);
    await createStory({ title: "Shipped story", stage: "DONE" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    // The first ✎ is on the row of Backlog; a click on its name selects it.
    const backlog = tui.locate("✎");
    await tui.mouse("press", 4, backlog.y);
    await tui.mouse("release", 4, backlog.y);
    expect(tui.frame()).toContain("Rowbly › Backlog");
    expect(tui.frame()).toContain("First story");
    expect(tui.frame()).not.toContain("Shipped story");
    await tui.press("]");
    expect(tui.frame()).toContain("Rowbly › Done");
    expect(tui.frame()).toContain("Shipped story");
    expect(tui.frame()).not.toContain("First story");
    await tui.press("]");
    expect(tui.frame()).toContain("Rowbly › All Stages");
    expect(tui.frame()).toContain("First story");
  });

  it("moves the focus to the sidebar with tab, and selects Stages there with the arrow keys", async () => {
    const tui = await open(project.ctx as { cwd: string });
    await tui.press(keys.tab);
    expect(tui.frame()).toContain("n new Stage");
    expect(tui.frame()).toMatch(/\+ New Stage\s+n/);
    await tui.press(keys.down);
    expect(tui.frame()).toContain("Rowbly › Backlog");
    expect(tui.frame()).toContain("e edit Stage");
    await tui.press(keys.escape);
    expect(tui.frame()).toContain("n new Story");
  });

  it("hides and shows the sidebar with ctrl+b", async () => {
    const tui = await open(project.ctx as { cwd: string });
    await tui.press(keys.ctrl("b"));
    expect(tui.frame()).not.toContain("╭─Stages");
    expect(tui.frame()).toContain("ctrl+b show Stages");
    await tui.press(keys.ctrl("b"));
    expect(tui.frame()).toContain("╭─Stages");
  });

  it("creates a Story in the New Story modal", async () => {
    const tui = await open(project.ctx as { cwd: string });
    await tui.press("n");
    expect(tui.frame()).toContain("New Story");
    expect(tui.frame()).toContain("Description");
    await tui.type("Write the docs");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    await tui.press();
    const stories = await searchStories({}, project.ctx);
    expect(stories.map((s) => s.title)).toEqual(["Write the docs"]);
    expect(tui.frame()).toMatch(/▌ {3}ROW-01 Write the docs/);
  });

  it("creates a Stage from the sidebar and selects it", async () => {
    const tui = await open(project.ctx as { cwd: string });
    await tui.click("+ New Stage");
    expect(tui.frame()).toContain("Prompt");
    await tui.type("Review");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx)).map((s) => s.key)).toEqual(["BACKLOG", "DONE", "REVIEW"]);
    expect(tui.frame()).toContain("Rowbly › Review");
  });

  it("edits a Stage from its ✎", async () => {
    await createStage({ label: "Review" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    await tui.click("✎");
    expect(tui.frame()).toContain("Edit Stage › Backlog");
    await tui.press(keys.backspace.repeat(7));
    await tui.type("Ideas");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx))[0]?.label).toBe("Ideas");
  });

  it("moves the selected Stage with shift+↑/↓ and J/K, and keeps it selected", async () => {
    await createStage({ label: "Review" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    await tui.press(keys.tab, keys.down);
    expect(tui.frame()).toContain("shift+↑/↓ move Stage");
    await tui.press(keys.shiftDown);
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx)).map((s) => s.key)).toEqual(["DONE", "BACKLOG", "REVIEW"]);
    expect(tui.frame()).toContain("Rowbly › Backlog");
    await tui.press("J");
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx)).map((s) => s.key)).toEqual(["DONE", "REVIEW", "BACKLOG"]);
    // The last Stage cannot go further down.
    await tui.press(keys.shiftDown, "K");
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx)).map((s) => s.key)).toEqual(["DONE", "BACKLOG", "REVIEW"]);
    await tui.press(keys.shiftUp);
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx)).map((s) => s.key)).toEqual(["BACKLOG", "DONE", "REVIEW"]);
    expect(tui.frame()).toContain("Rowbly › Backlog");
  });

  /** The Stories of each Stage, in order. */
  const board = async () => {
    const stories = await searchStories({}, project.ctx);
    return Object.fromEntries(
      (await listStages(project.ctx)).map((s) => [
        s.key,
        stories.filter((story) => story.stage === s.key).map((story) => story.title),
      ]),
    );
  };
  /** Presses `input`, then waits for the service to write and for the list to read the project again. */
  const step = async (tui: Awaited<ReturnType<typeof open>>, input: string) => {
    await tui.press(input);
    await settle(50);
    await tui.press();
  };

  it("moves the selected Story up and down its Stage with shift+↑/↓ and J/K, and past the end into the next Stage", async () => {
    await createStory({ title: "Alpha" }, project.ctx);
    await createStory({ title: "Bravo" }, project.ctx);
    await createStory({ title: "Charlie", stage: "DONE" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    expect(tui.frame()).toContain("shift+↑/↓ move Story");
    await step(tui, keys.shiftDown);
    expect(await board()).toEqual({ BACKLOG: ["Bravo", "Alpha"], DONE: ["Charlie"] });
    expect(tui.frame()).toMatch(/▌ {3}ROW-01 Alpha/);
    // The last Story of a Stage goes to the top of the next Stage.
    await step(tui, keys.shiftDown);
    expect(await board()).toEqual({ BACKLOG: ["Bravo"], DONE: ["Alpha", "Charlie"] });
    expect(tui.frame()).toMatch(/▾ Done \(2\).*\n.*▌ {3}ROW-01 Alpha/);
    await step(tui, "J");
    expect(await board()).toEqual({ BACKLOG: ["Bravo"], DONE: ["Charlie", "Alpha"] });
    // The last Story of the last Stage cannot go further down.
    await step(tui, keys.shiftDown);
    expect(await board()).toEqual({ BACKLOG: ["Bravo"], DONE: ["Charlie", "Alpha"] });
    await step(tui, "K");
    await step(tui, keys.shiftUp);
    // The first Story of a Stage goes to the bottom of the previous Stage.
    expect(await board()).toEqual({ BACKLOG: ["Bravo", "Alpha"], DONE: ["Charlie"] });
    expect(tui.frame()).toMatch(/▌ {3}ROW-01 Alpha/);
  });

  it("moves the selected Story to the previous or next Stage with ctrl+shift+↑/↓", async () => {
    await createStage({ label: "Review" }, project.ctx);
    await createStory({ title: "Alpha" }, project.ctx);
    await createStory({ title: "Bravo" }, project.ctx);
    await createStory({ title: "Charlie", stage: "DONE" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    await step(tui, keys.ctrlShiftDown);
    expect(await board()).toEqual({ BACKLOG: ["Bravo"], DONE: ["Alpha", "Charlie"], REVIEW: [] });
    await step(tui, keys.ctrlShiftDown);
    expect(await board()).toEqual({ BACKLOG: ["Bravo"], DONE: ["Charlie"], REVIEW: ["Alpha"] });
    // A Stage filter follows the Story to its new Stage.
    await tui.press("]", "]", "]");
    expect(tui.frame()).toContain("Rowbly › Review");
    await step(tui, keys.ctrlShiftUp);
    expect(await board()).toEqual({ BACKLOG: ["Bravo"], DONE: ["Charlie", "Alpha"], REVIEW: [] });
    expect(tui.frame()).toContain("Rowbly › Done");
    expect(tui.frame()).toMatch(/▌ ROW-01 Alpha/);
  });

  it("moves a Story when it is dragged to another row of the list", async () => {
    await createStory({ title: "Alpha" }, project.ctx);
    await createStory({ title: "Bravo" }, project.ctx);
    await createStory({ title: "Charlie", stage: "DONE" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    const drag = async (from: string, to: string) => {
      const start = tui.locate(from);
      const end = tui.locate(to);
      await tui.mouse("press", start.x, start.y);
      await tui.mouse("move", end.x, end.y);
      await tui.mouse("release", end.x, end.y);
      await settle(50);
      await tui.press();
    };
    // Dragged down, a Story lands below the Story under the pointer; dragged up, above it.
    await drag("Alpha", "Charlie");
    expect(await board()).toEqual({ BACKLOG: ["Bravo"], DONE: ["Charlie", "Alpha"] });
    expect(tui.frame()).toMatch(/▌ {3}ROW-01 Alpha/);
    await drag("Alpha", "Charlie");
    expect(await board()).toEqual({ BACKLOG: ["Bravo"], DONE: ["Alpha", "Charlie"] });
    // A Story dropped on a Stage heading goes to the top of that Stage.
    await drag("Charlie", "Backlog (1)");
    expect(await board()).toEqual({ BACKLOG: ["Charlie", "Bravo"], DONE: ["Alpha"] });
    await drag("Charlie", "Bravo");
    expect(await board()).toEqual({ BACKLOG: ["Bravo", "Charlie"], DONE: ["Alpha"] });
  });

  it("moves a Stage when it is dragged to another row of the sidebar", async () => {
    await createStage({ label: "Review" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    // The Story list also shows the Stage names, so find the rows in the sidebar column.
    const row = (label: string) =>
      tui
        .frame()
        .split("\n")
        .findIndex((line) => line.startsWith(`│   ${label} `));
    const review = row("Review");
    const backlog = row("Backlog");
    await tui.mouse("press", 4, review);
    await tui.mouse("move", 4, backlog);
    expect(tui.frame()).toMatch(/› Backlog/);
    await tui.mouse("release", 4, backlog);
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx)).map((s) => s.key)).toEqual(["REVIEW", "BACKLOG", "DONE"]);
  });

  it("finds a Story with the fuzzy finder, selects it in the list and opens it", async () => {
    await createStory({ title: "Alpha" }, project.ctx);
    await createStory({ title: "Bravo" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    await tui.press(keys.ctrl("p"));
    expect(tui.frame()).toContain("2 Stories");
    await tui.type("brv");
    expect(tui.frame()).toContain("1 Story");
    await tui.press(keys.enter);
    expect(tui.frame()).not.toContain("1 Story");
    expect(tui.frame()).toContain("Edit ROW-02");
    await tui.press(keys.escape);
    expect(tui.frame()).not.toContain("Edit ROW-02");
    expect(tui.frame()).toMatch(/▌ {3}ROW-02 Bravo/);
  });

  it("deletes the selected Story with d after a confirmation and selects the next Story", async () => {
    await createStory({ title: "Alpha" }, project.ctx);
    await createStory({ title: "Bravo" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    await tui.press("?");
    expect(tui.frame()).toMatch(/d +delete/);
    await tui.press(keys.escape, "d");
    expect(tui.frame()).toContain("Delete ROW-01 Alpha? You cannot undo this.");
    await tui.press("n");
    expect(tui.frame()).not.toContain("You cannot undo this.");
    await tui.press("d", "y");
    await settle(50);
    await tui.press();
    expect((await searchStories({}, project.ctx)).map((s) => s.id)).toEqual(["ROW-02"]);
    expect(tui.frame()).not.toContain("ROW-01 Alpha");
    expect(tui.frame()).toMatch(/▌ {3}ROW-02 Bravo/);
  });

  it("deletes the open Story with ctrl+d", async () => {
    await createStory({ title: "Alpha" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    await tui.press(keys.enter);
    expect(tui.frame()).toContain("Edit ROW-01");
    await tui.press(keys.ctrl("d"), "y");
    await settle(50);
    await tui.press();
    expect(await searchStories({}, project.ctx)).toEqual([]);
    expect(tui.frame()).not.toContain("Edit ROW-01");
  });

  it("edits the selected Story with enter", async () => {
    await createStory({ title: "Alpha" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    expect(tui.frame()).toContain("enter edit Story");
    await tui.press(keys.enter);
    expect(tui.frame()).toContain("Edit ROW-01");
    await tui.type(" two");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    await tui.press();
    expect((await searchStories({}, project.ctx)).map((s) => s.title)).toEqual(["Alpha two"]);
    expect(tui.frame()).not.toContain("Edit ROW-01");
    expect(tui.frame()).toMatch(/▌ {3}ROW-01 Alpha two/);
  });

  it("selects a Story on the first click and opens it for editing on the second click", async () => {
    await createStory({ title: "Alpha" }, project.ctx);
    await createStory({ title: "Bravo" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    await tui.click("Bravo");
    expect(tui.frame()).not.toContain("Edit ROW-02");
    expect(tui.frame()).toMatch(/▌ {3}ROW-02 Bravo/);
    await tui.click("Bravo");
    expect(tui.frame()).toContain("Edit ROW-02");
  });

  it("groups All Stages into sections that expand and collapse", async () => {
    await createStory({ title: "First story" }, project.ctx);
    await createStory({ title: "Shipped story", stage: "DONE" }, project.ctx);
    const tui = await open(project.ctx as { cwd: string });
    expect(tui.frame()).toMatch(/▾ Backlog \(1\)/);
    expect(tui.frame()).toMatch(/▾ Done \(1\)/);
    // `←` on a Story collapses its section and selects the heading.
    await tui.press(keys.left);
    expect(tui.frame()).toMatch(/▌ ▸ Backlog \(1\)/);
    expect(tui.frame()).not.toContain("First story");
    expect(tui.frame()).toContain("enter expand");
    await tui.press(keys.enter);
    expect(tui.frame()).toMatch(/▌ ▾ Backlog \(1\)/);
    expect(tui.frame()).toContain("First story");
    // A click on a selected heading collapses it.
    await tui.press(keys.down, keys.down);
    await tui.click("Done (1)");
    expect(tui.frame()).toMatch(/▸ Done \(1\)/);
    expect(tui.frame()).not.toContain("Shipped story");
    // A Stage filter shows the Stories without headings.
    await tui.press("]", "]");
    expect(tui.frame()).toContain("Rowbly › Done");
    expect(tui.frame()).toMatch(/▌ ROW-02 Shipped story/);
  });

  it("opens Settings with , and with the header Button, and shows a rename in the Story list", async () => {
    const tui = await open(project.ctx as { cwd: string });
    await tui.press(",");
    expect(tui.frame()).toContain("Rowbly › Settings");
    expect(tui.frame()).toContain("Custom Fields");
    await tui.press(keys.enter, "e");
    await tui.type(" 2");
    await tui.press(keys.ctrl("s"));
    await settle(100);
    await tui.press(keys.escape, keys.escape);
    expect(tui.frame()).not.toContain("Settings ›");
    expect(tui.frame()).toContain("Rowbly 2 › All Stages");
    await tui.click("Settings");
    expect(tui.frame()).toContain("Rowbly 2 › Settings");
  });

  it("shows the keys in Help", async () => {
    const tui = await open(project.ctx as { cwd: string });
    await tui.press("?");
    expect(tui.frame()).toContain("edit a text field full screen");
    await tui.press("?");
    expect(tui.frame()).not.toContain("edit a text field full screen");
  });
});

describe("Shell with several Projects", () => {
  const dir = useTempDir();

  async function seed() {
    const ctx = (name: string) => ({ cwd: join(dir.path, name), home: dir.path });
    for (const name of ["Alpha", "Beta"]) {
      await mkdir(ctx(name).cwd);
      await initProject({ name, key: "AB" }, ctx(name));
    }
    await createStory({ title: "Beta story" }, ctx("Beta"));
    await writeFile(join(ctx("Beta").cwd, ".rowbly", "state.json"), factoryState(["AB-01", "BACKLOG", "beta-agent"]));
    return ctx;
  }

  it("records the Project that opens, and keeps the other keys of the file", async () => {
    const ctx = await seed();
    await writeFile(join(dir.path, RC_FILE), '{"me":"sunny"}');
    await open(ctx("Alpha"));
    await settle(50);
    expect(JSON.parse(await readFile(join(dir.path, RC_FILE), "utf8"))).toEqual({
      me: "sunny",
      projects: [{ path: ctx("Alpha").cwd, name: "Alpha" }],
    });
  });

  it("switches to another Project with p and shows its Stories", async () => {
    const ctx = await seed();
    await recordProject({ path: ctx("Beta").cwd, name: "Beta" }, ctx("Beta"));
    const tui = await open(ctx("Alpha"));
    await settle(50);
    await tui.press("p");
    await settle(50);
    await tui.press();
    expect(tui.frame()).toMatch(/Alpha · current/);
    await tui.press(keys.enter);
    await settle(100);
    await tui.press();
    expect(tui.frame()).toContain("Beta › All Stages");
    expect(tui.frame()).toContain("Beta story");
    // The activity comes from the state file of the new Project.
    expect(tui.frame()).toContain("▶ beta-agent");
    expect(tui.frame()).not.toContain("Factory activity");
    expect((await listKnownProjects(ctx("Beta"))).map((p) => p.name)).toEqual(["Beta", "Alpha"]);
  });

  it("opens the switcher from the header without a Project in the directory", async () => {
    const ctx = await seed();
    await recordProject({ path: ctx("Beta").cwd, name: "Beta" }, ctx("Beta"));
    const tui = await open({ cwd: dir.path, home: dir.path } as { cwd: string });
    await tui.click("No Project");
    await settle(50);
    await tui.press(keys.enter);
    await settle(100);
    await tui.press();
    expect(tui.frame()).toContain("Beta › All Stages");
  });
});

describe("Shell without a project", () => {
  const dir = useTempDir();

  it("shows the onboarding steps on the screen, with no Modal", async () => {
    const tui = await open({ cwd: dir.path });
    expect(tui.frame()).toContain("╭─Set up Rowbly");
    expect(tui.frame()).toContain("No Rowbly project in this directory.");
    expect(tui.frame()).toContain("Use defaults");
    expect(tui.frame()).toContain("Customize");
    expect(tui.frame()).not.toContain("+ New Project");
    expect(tui.frame()).not.toContain("+ New Story");
    expect(tui.toasts.list()).toEqual([]);
  });

  it("shows the onboarding steps in a subfolder of a project, not the parent project", async () => {
    await initProject({ name: "Parent", key: "PAR" }, { cwd: dir.path });
    const sub = join(dir.path, "child");
    await mkdir(sub);
    const tui = await open({ cwd: sub });
    expect(tui.frame()).toContain("╭─Set up Rowbly");
    expect(tui.frame()).not.toContain("Parent");
  });

  it("creates a project from the defaults and opens it", async () => {
    const ctx = { cwd: dir.path, home: dir.path };
    const tui = await open(ctx);
    await tui.press(keys.enter);
    await settle(50);
    await tui.press();
    expect(tui.frame()).toContain("Summary");
    await tui.press(keys.enter);
    // The setup copies the Stage prompts and the skills, so the time to the board depends on the disk.
    await vi.waitFor(() => expect(tui.frame()).toContain("╭─Stages"), { timeout: 5000, interval: 50 });
    expect(await getProject(ctx)).toMatchObject({ projectName: basename(dir.path) });
    // The Shell records the Project after the board shows.
    await vi.waitFor(async () =>
      expect((await listKnownProjects(ctx)).map((p) => p.name)).toEqual([basename(dir.path)]),
    );
  });

  it("does not quit or open the switcher when q and p are typed in a text field", async () => {
    const tui = await open({ cwd: dir.path, home: dir.path } as { cwd: string });
    await tui.press(keys.down, keys.enter);
    await settle(50);
    await tui.press();
    await tui.type("qp");
    expect(tui.frame()).toContain("Project name and key");
    expect(tui.frame()).toContain("qp");
  });
});
