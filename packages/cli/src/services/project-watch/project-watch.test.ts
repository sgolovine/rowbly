import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { createStory } from "../story/story.js";
import { watchFactoryState, watchStories } from "../story-watch/story-watch.js";
import { useTestProject } from "../test-project/test-project.js";
import { watchThreads } from "../thread/thread-watch.js";
import { runtimePaths } from "../workspace/workspace.js";
import { openWatches, watchRoutes } from "./project-watch.js";

describe("project watch registry", () => {
  const project = useTestProject();

  it("shares one handle for each watched path and closes all handles after the last stop", async () => {
    const runtime = runtimePaths(project.paths);
    await mkdir(join(project.paths.dir, "attachments"), { recursive: true });
    await mkdir(project.paths.specsDir, { recursive: true });
    await mkdir(runtime.threadsDir, { recursive: true });

    const stops = [
      await watchStories(() => {}, project.ctx),
      await watchStories(() => {}, project.ctx, { includeState: false }),
      await watchFactoryState(() => {}, project.ctx),
      await watchThreads(() => {}, project.ctx),
      await watchThreads(() => {}, project.ctx, { factory: true }),
    ];

    const watches = openWatches();
    const paths = watches.map((watch) => watch.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.toSorted()).toEqual(
      [
        project.paths.dir,
        project.paths.storiesDir,
        join(project.paths.dir, "attachments"),
        project.paths.specsDir,
        project.paths.stagesDir,
        project.paths.promptsDir,
        project.paths.runtimeDir,
        runtime.threadsDir,
      ].toSorted(),
    );
    expect(watches.find((watch) => watch.path === project.paths.dir)?.subscribers).toBe(5);
    expect(
      watches
        .filter((watch) => watch.recursive)
        .map((watch) => watch.path)
        .toSorted(),
    ).toEqual([project.paths.storiesDir, join(project.paths.dir, "attachments")].toSorted());

    stops.map((stop) => stop());
    expect(openWatches()).toEqual([]);
  });

  it("does not call back for writes of session histories and logs", async () => {
    const runtime = runtimePaths(project.paths);
    await mkdir(runtime.sessionsDir, { recursive: true });
    await mkdir(runtime.logsDir, { recursive: true });
    await mkdir(runtime.threadsDir, { recursive: true });

    const onChange = vi.fn();
    const stops = [
      await watchStories(onChange, project.ctx),
      await watchFactoryState(onChange, project.ctx),
      await watchThreads(onChange, project.ctx),
      await watchThreads(onChange, project.ctx, { factory: true }),
    ];

    try {
      await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          writeFile(join(index % 2 === 0 ? runtime.sessionsDir : runtime.logsDir, `${index}.jsonl`), "{}"),
        ),
      );
      await sleep(250);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      stops.map((stop) => stop());
    }
  });

  it("keeps the callbacks of a second subscriber after the first subscriber stops", async () => {
    await createStory({ title: "T" }, project.ctx);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = await watchStories(first, project.ctx);
    const stopSecond = await watchStories(second, project.ctx);

    try {
      stopFirst();
      await createStory({ title: "U" }, project.ctx);
      await vi.waitFor(() => expect(second).toHaveBeenCalled());
      expect(first).not.toHaveBeenCalled();
      expect(openWatches().find((watch) => watch.path === project.paths.storiesDir)?.subscribers).toBe(1);
    } finally {
      stopSecond();
    }
  });

  it("starts the watch of a child folder again after the folder comes back", async () => {
    const child = join(project.paths.dir, "child");
    const onChange = vi.fn();
    const stop = watchRoutes(
      [
        { path: project.paths.dir, recursive: false, accept: () => false },
        { path: child, recursive: false, accept: (filename) => filename === "a.txt" },
      ],
      onChange,
    );

    try {
      expect(openWatches().map((watch) => watch.path)).toEqual([project.paths.dir]);
      await mkdir(child);
      await vi.waitFor(() => expect(openWatches().map((watch) => watch.path)).toContain(child));
      await writeFile(join(child, "a.txt"), "1");
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

      await rm(child, { recursive: true });
      await vi.waitFor(() => expect(openWatches().map((watch) => watch.path)).not.toContain(child));
      await mkdir(child);
      await vi.waitFor(() => expect(openWatches().map((watch) => watch.path)).toContain(child));
      onChange.mockClear();
      await writeFile(join(child, "a.txt"), "2");
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    } finally {
      stop();
    }

    expect(openWatches()).toEqual([]);
  });

  it("gives the changed names of one quiet time to the callback, relative to the first route", async () => {
    const child = join(project.paths.dir, "child");
    await mkdir(child);
    const onChange = vi.fn();
    const stop = watchRoutes(
      [
        { path: project.paths.dir, recursive: false, accept: (filename) => filename === "a.txt" },
        { path: child, recursive: true, accept: () => true },
      ],
      onChange,
    );

    try {
      await writeFile(join(project.paths.dir, "a.txt"), "1");
      await writeFile(join(child, "b.txt"), "1");
      await writeFile(join(child, "b.txt"), "2");
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
      await sleep(150);

      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange.mock.calls[0]?.[0]).toEqual(["a.txt", join("child", "b.txt")]);

      onChange.mockClear();
      await writeFile(join(child, "c.txt"), "1");
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(onChange.mock.calls[0]?.[0]).toEqual([join("child", "c.txt")]);
    } finally {
      stop();
    }
  });

  it("gives null for an event with no name", async () => {
    const child = join(project.paths.dir, "child");
    const onChange = vi.fn();
    const stop = watchRoutes(
      [
        { path: project.paths.dir, recursive: false, accept: () => false },
        { path: child, recursive: false, accept: () => true },
      ],
      onChange,
    );

    try {
      // The watch of the new folder starts, and gives one event with no name for the files that it did not see.
      await mkdir(child);
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(onChange.mock.calls[0]?.[0]).toContain(null);
    } finally {
      stop();
    }
  });
});
