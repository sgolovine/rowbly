import { rename } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread } from "./thread-change.js";
import { listThreads } from "./thread-list.js";

describe("thread list Story filter", () => {
  const p = useTestProject();

  const worker = (storyId: string, storyUid?: string) =>
    createThread(
      {
        role: "worker",
        storyId,
        ...(storyUid ? { storyUid } : {}),
        stage: "BACKLOG",
        cwd: p.paths.root,
        ownerToken: "owner",
      },
      p.ctx,
    );
  const ids = async (story: string) => (await listThreads({ story }, p.ctx)).threads.map((t) => t.id);

  it("finds the Threads of a Story by its uid after the Story file gets a new number", async () => {
    const first = await createStory({ title: "First" }, p.ctx);
    const thread = await worker("ROW-01", first.uid);
    await rename(p.path("stories/BACKLOG/ROW-01.md"), p.path("stories/BACKLOG/ROW-05.md"));
    const other = await createStory({ title: "Takes the old number" }, p.ctx);
    await rename(p.path(`stories/BACKLOG/${other.id}.md`), p.path("stories/BACKLOG/ROW-01.md"));
    const otherThread = await worker("ROW-01", other.uid);

    expect(await ids("ROW-05")).toEqual([thread.id]);
    expect(await ids("ROW-01")).toEqual([otherThread.id]);
  });

  it("finds a Thread by its Story ID without a storyUid, with an unknown storyUid, or for a deleted Story", async () => {
    await createStory({ title: "First" }, p.ctx);
    const old = await worker("ROW-01");
    const unknown = await worker("ROW-01", "99999999-9999-4999-8999-999999999999");
    const deleted = await worker("ROW-09", "88888888-8888-4888-8888-888888888888");

    expect(await ids("ROW-01")).toEqual(expect.arrayContaining([old.id, unknown.id]));
    expect(await ids("ROW-01")).toHaveLength(2);
    expect(await ids("ROW-09")).toEqual([deleted.id]);
  });
});
