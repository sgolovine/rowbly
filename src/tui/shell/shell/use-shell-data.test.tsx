import { writeFile } from "node:fs/promises";
import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listKnownProjects } from "../../../services/known-project/known-project.js";
import { listStages } from "../../../services/stage/stage.js";
import { createStory, searchStories, updateStory } from "../../../services/story/story.js";
import { useTempDir, useTestProject } from "../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { renderTui, settle } from "../../testing/index.js";
import { type ShellData, useShellData } from "./use-shell-data.js";

vi.mock("../../../services/story/story.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/story/story.js")>();

  return { ...actual, searchStories: vi.fn(actual.searchStories) };
});

afterEach(cleanup);

const stateFile = (attempts: unknown[]) =>
  JSON.stringify({ version: 1, updatedAt: null, scan: { count: 1, stages: {} }, attempts });

const attempt = (story: string, stage: string, status: string) => ({
  story,
  stage,
  workerId: "worker-1",
  model: "claude-opus",
  status,
});

function boardText(shell: ShellData): string {
  if (shell.data.loading) {
    return "loading";
  }

  return shell.data.data ? `${shell.data.data.project.projectName}: ${shell.data.data.stories.length}` : "none";
}

/** Shows the board, and gives the last data to the test. */
function Probe({ ctx, onData }: { ctx: ServiceContext; onData(shell: ShellData): void }) {
  const shell = useShellData(ctx);

  onData(shell);

  return <Text>{boardText(shell)}</Text>;
}

describe("useShellData", () => {
  const project = useTestProject();
  const empty = useTempDir();

  it("reads the board, records the Project and reads the board again on reload", async () => {
    const seen: ShellData[] = [];
    const tui = await renderTui(<Probe ctx={project.ctx} onData={(shell) => seen.push(shell)} />);

    await settle(100);
    expect(tui.frame()).toContain("Rowbly: 0");
    // The hook records the Project after the board shows.
    await vi.waitFor(async () =>
      expect((await listKnownProjects({})).some((known) => known.path === project.ctx.cwd)).toBe(true),
    );

    await createStory({ title: "One" }, project.ctx);
    seen.at(-1)?.reload();
    await settle(100);
    await tui.press();
    expect(tui.frame()).toContain("Rowbly: 1");
  });

  it("gives null in a directory without a Project", async () => {
    const tui = await renderTui(<Probe ctx={{ cwd: empty.path }} onData={() => {}} />);

    await settle(100);
    await tui.press();
    expect(tui.frame()).toContain("none");
  });

  it("reads only the activity again after a write of the state file", async () => {
    const story = await createStory({ title: "One" }, project.ctx);
    const seen: ShellData[] = [];
    const activity = () => seen.at(-1)?.data.data?.activity.stories[story.id];
    await renderTui(<Probe ctx={project.ctx} onData={(shell) => seen.push(shell)} />);
    await vi.waitFor(() => expect(seen.at(-1)?.data.data?.stories).toHaveLength(1));
    await settle(150);
    vi.mocked(searchStories).mockClear();

    await writeFile(project.paths.stateFile, stateFile([attempt(story.id, story.stage, "running")]));
    await vi.waitFor(() => expect(activity()).toEqual({ kind: "active", label: "claude-opus" }));
    expect(seen.at(-1)?.data.loading).toBe(false);

    await writeFile(project.paths.stateFile, stateFile([attempt(story.id, story.stage, "completed")]));
    await vi.waitFor(() => expect(activity()).toBeUndefined());

    await writeFile(project.paths.stateFile, stateFile([attempt(story.id, story.stage, "running")]));
    await vi.waitFor(() => expect(activity()).toBeDefined());
    await writeFile(project.paths.stateFile, stateFile([]));
    await vi.waitFor(() => expect(activity()).toBeUndefined());
    await settle(150);
    expect(searchStories).not.toHaveBeenCalled();
  });

  it("reads the board again after a change of a Story, and computes the activity for the new Stories", async () => {
    const story = await createStory({ title: "One" }, project.ctx);
    const other = (await listStages(project.ctx)).find((stage) => stage.key !== story.stage);
    const seen: ShellData[] = [];
    const activity = () => seen.at(-1)?.data.data?.activity.stories[story.id];
    await writeFile(project.paths.stateFile, stateFile([attempt(story.id, story.stage, "running")]));
    await renderTui(<Probe ctx={project.ctx} onData={(shell) => seen.push(shell)} />);
    await vi.waitFor(() => expect(activity()).toEqual({ kind: "active", label: "claude-opus" }));
    vi.mocked(searchStories).mockClear();

    await updateStory({ id: story.id, stage: other?.key }, project.ctx);
    await vi.waitFor(() => expect(seen.at(-1)?.data.data?.stories[0]?.stage).toBe(other?.key));
    expect(searchStories).toHaveBeenCalled();
    expect(activity()).toBeUndefined();
  });
});
