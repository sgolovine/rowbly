import { rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../errors/errors.js";
import { createStory, lockStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../testProject/testProject.js";
import { watchStories } from "./storyWatch.js";

describe("watchStories", () => {
  const project = useTestProject();
  const empty = useTempDir();

  it("calls back one time for one change to a story", async () => {
    await createStory({ title: "T" }, project.ctx);
    const onChange = vi.fn();
    const stop = await watchStories(onChange, project.ctx);
    await lockStory({ id: "ROW-01", agent: "claude" }, project.ctx);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    await sleep(200);
    expect(onChange).toHaveBeenCalledOnce();
    stop();
  });

  it("does not call back after the stop, also for a change that it already saw", async () => {
    await createStory({ title: "T" }, project.ctx);
    const onChange = vi.fn();
    const stop = await watchStories(onChange, project.ctx);
    await lockStory({ id: "ROW-01", agent: "claude" }, project.ctx);
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

  it("fails without a project", async () => {
    await expect(watchStories(() => {}, { cwd: empty.path })).rejects.toBeInstanceOf(NotFoundError);
  });
});
