import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../errors/errors.js";
import { createStory, updateStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { readStoryChanges, storyFileChanges, watchFactoryState, watchStories } from "./story-watch.js";

describe("watchStories", () => {
  const project = useTestProject();
  const empty = useTempDir();

  it("calls back one time for one change to a story", async () => {
    await createStory({ title: "T" }, project.ctx);
    const onChange = vi.fn();
    const stop = await watchStories(onChange, project.ctx);
    await updateStory({ id: "ROW-01", title: "U" }, project.ctx);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    await sleep(200);
    expect(onChange).toHaveBeenCalledOnce();
    stop();
  });

  it("gives the changed Story file, and ignores the temporary file of the write", async () => {
    const story = await createStory({ title: "T" }, project.ctx);
    const onChange = vi.fn();
    const stop = await watchStories(onChange, project.ctx);
    try {
      await updateStory({ id: "ROW-01", title: "U" }, project.ctx);
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
      const changes = onChange.mock.calls[0]?.[0];
      expect(storyFileChanges(project.paths, changes)).toEqual([story.path]);
      expect(await readStoryChanges(changes, project.ctx)).toMatchObject([
        { path: story.path, story: { id: "ROW-01", title: "U" } },
      ]);
    } finally {
      stop();
    }
  });

  it("does not call back after the stop, also for a change that it already saw", async () => {
    await createStory({ title: "T" }, project.ctx);
    const onChange = vi.fn();
    const stop = await watchStories(onChange, project.ctx);
    await updateStory({ id: "ROW-01", title: "U" }, project.ctx);
    await sleep(20);
    stop();
    await sleep(200);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("survives the removal of the stories folder", async () => {
    const stop = await watchStories(() => {}, project.ctx);
    await rm(project.paths.storiesDir, { recursive: true });
    await sleep(50);
    stop();
  });

  it("ignores runtime watcher floods and retains state activity invalidation", async () => {
    await mkdir(project.paths.runtimeDir);
    const onChange = vi.fn();
    const stop = await watchStories(onChange, project.ctx);
    try {
      await Promise.all(
        Array.from({ length: 30 }, (_, index) => writeFile(join(project.paths.runtimeDir, `${index}.json`), "{}")),
      );
      await sleep(200);
      expect(onChange).not.toHaveBeenCalled();
      await writeFile(project.paths.stateFile, "{}");
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    } finally {
      stop();
    }
  });

  it("lets the manager exclude its own state transactions", async () => {
    const onChange = vi.fn();
    const stop = await watchStories(onChange, project.ctx, { includeState: false });
    try {
      await writeFile(project.paths.stateFile, "{}");
      await sleep(200);
      expect(onChange).not.toHaveBeenCalled();
      await createStory({ title: "External edit" }, project.ctx);
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    } finally {
      stop();
    }
  });

  it("fails without a project", async () => {
    await expect(watchStories(() => {}, { cwd: empty.path })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("watchFactoryState", () => {
  const project = useTestProject();
  const empty = useTempDir();

  it("calls back one time after a write of the state file", async () => {
    const onChange = vi.fn();
    const stop = await watchFactoryState(onChange, project.ctx);
    try {
      await writeFile(project.paths.stateFile, "{}");
      await writeFile(project.paths.stateFile, '{"version":1}');
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
      await sleep(200);
      expect(onChange).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });

  it("does not call back after a change to a Story file or to a runtime file", async () => {
    await mkdir(project.paths.runtimeDir);
    const onChange = vi.fn();
    const stop = await watchFactoryState(onChange, project.ctx);
    try {
      await createStory({ title: "T" }, project.ctx);
      await updateStory({ id: "ROW-01", title: "U" }, project.ctx);
      await writeFile(join(project.paths.runtimeDir, "status.json"), "{}");
      await sleep(200);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("does not call back after the stop", async () => {
    const onChange = vi.fn();
    const stop = await watchFactoryState(onChange, project.ctx);
    stop();
    await writeFile(project.paths.stateFile, "{}");
    await sleep(200);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("fails without a project", async () => {
    await expect(watchFactoryState(() => {}, { cwd: empty.path })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("attachment file watch", () => {
  const project = useTestProject();
  it("refreshes saved counts after an attachment add", async () => {
    const { addAttachment } = await import("../attachment/attachment.js");
    await createStory({ title: "T" }, project.ctx);
    const onChange = vi.fn();
    const stop = await watchStories(onChange, project.ctx);
    try {
      await addAttachment(
        { story: "1", image: { name: "image.png", bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) } },
        project.ctx,
      );
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    } finally {
      stop();
    }
  });
});

describe("storyFileChanges", () => {
  const project = useTestProject();
  const temp = ".0b7c6f3e-2d4a-4f1e-9c8b-5a6d7e8f9a0b.tmp";

  it("gives the Story files in the Story folder and in its Stage folders", () => {
    expect(
      storyFileChanges(project.paths, [
        "stories/IN_DEVELOPMENT/ROW-01.md",
        "stories/ROW-02.md",
        "stories/IN_DEVELOPMENT/ROW-01.md",
      ]),
    ).toEqual([
      join(project.paths.storiesDir, "IN_DEVELOPMENT", "ROW-01.md"),
      join(project.paths.storiesDir, "ROW-02.md"),
    ]);
  });

  it("ignores the temporary file of an atomic write", () => {
    expect(storyFileChanges(project.paths, [`stories/BACKLOG/${temp}`])).toEqual([]);
    expect(storyFileChanges(project.paths, [`stories/BACKLOG/${temp}`, "stories/BACKLOG/ROW-01.md"])).toEqual([
      join(project.paths.storiesDir, "BACKLOG", "ROW-01.md"),
    ]);
  });

  it("asks for a full read for a change with no name", () => {
    expect(storyFileChanges(project.paths, ["stories/BACKLOG/ROW-01.md", null])).toBeUndefined();
  });

  it.each([
    "config.json",
    "stories",
    "stories/BACKLOG",
    "stories/BACKLOG/notes.md",
    "stories/BACKLOG/deep/ROW-01.md",
    "stages/BACKLOG.md",
    "specs/design.md",
    "prompts/WORKER.md",
    "attachments/ROW-01",
    "attachments/ROW-01/image.png",
  ])("asks for a full read for a change of %s", (change) => {
    expect(storyFileChanges(project.paths, ["stories/BACKLOG/ROW-01.md", change])).toBeUndefined();
  });
});

describe("readStoryChanges", () => {
  const project = useTestProject();

  it("reads each changed Story, and gives undefined for a deleted file", async () => {
    const story = await createStory({ title: "T" }, project.ctx);
    const gone = join(project.paths.storiesDir, "BACKLOG", "ROW-09.md");
    const changes = [relative(project.paths.dir, story.path), relative(project.paths.dir, gone)];

    expect(await readStoryChanges(changes, project.ctx)).toMatchObject([
      { path: story.path, story: { id: "ROW-01", title: "T" } },
      { path: gone, story: undefined },
    ]);
  });

  it("asks for a full read when a change is not a Story file", async () => {
    expect(await readStoryChanges(["config.json"], project.ctx)).toBeUndefined();
  });

  it("asks for a full read when the read of one Story fails", async () => {
    await writeFile(join(project.paths.storiesDir, "ROW-03.md"), "---\ntitle: Bad\nstage: NOWHERE\n---\n");

    expect(await readStoryChanges(["stories/ROW-03.md"], project.ctx)).toBeUndefined();
  });
});
