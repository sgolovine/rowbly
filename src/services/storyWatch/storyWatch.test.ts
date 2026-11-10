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
