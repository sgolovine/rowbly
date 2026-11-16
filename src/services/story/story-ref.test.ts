import { rename } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import {
  createStory,
  listStoryRefs,
  matchStoryRef,
  recordRef,
  refersToStory,
  resolveStoryRef,
  storyUidField,
} from "./story.js";

const UID_A = "11111111-1111-4111-8111-111111111111";
const UID_B = "22222222-2222-4222-8222-222222222222";

describe("matchStoryRef", () => {
  const stories = [{ id: "ROW-01", uid: UID_A }, { id: "ROW-02", uid: UID_B }, { id: "ROW-03" }];

  it("gives the Story with the uid first, also when the ID is different", () => {
    expect(matchStoryRef(stories, { id: "ROW-02", uid: UID_A })).toBe(stories[0]);
    expect(matchStoryRef(stories, { id: "ROW-09", uid: UID_B })).toBe(stories[1]);
  });

  it("gives the Story with the ID when the reference has no uid or no Story has the uid", () => {
    expect(matchStoryRef(stories, { id: "ROW-02" })).toBe(stories[1]);
    expect(matchStoryRef(stories, { id: "ROW-03", uid: "33333333-3333-4333-8333-333333333333" })).toBe(stories[2]);
  });

  it("gives undefined when neither the uid nor the ID matches", () => {
    expect(matchStoryRef(stories, { id: "ROW-09" })).toBeUndefined();
  });

  it("tells if a reference finds a given Story", () => {
    expect(refersToStory(stories, { id: "ROW-01", uid: UID_B }, stories[1] as (typeof stories)[number])).toBe(true);
    expect(refersToStory(stories, { id: "ROW-01", uid: UID_B }, stories[0] as (typeof stories)[number])).toBe(false);
  });

  it("makes the reference of a record, without a uid key for a record without a storyUid", () => {
    expect(recordRef("ROW-01", UID_A)).toEqual({ id: "ROW-01", uid: UID_A });
    expect(recordRef("ROW-01", undefined)).toEqual({ id: "ROW-01" });
    expect("uid" in recordRef("ROW-01", undefined)).toBe(false);
  });

  it("gives a storyUid key only for a Story with a uid", () => {
    expect(storyUidField({ uid: UID_A })).toEqual({ storyUid: UID_A });
    expect(storyUidField({})).toEqual({});
    expect("storyUid" in storyUidField({ uid: undefined })).toBe(false);
  });
});

describe("resolveStoryRef", () => {
  const project = useTestProject();

  /** Removes the `uid` line of a Story file, as in a file of an older build. */
  async function removeUid(path: string): Promise<void> {
    await project.write(path, (await project.read(path)).replace(/\nuid: [^\n]*\n/, "\n"));
  }

  it("finds a Story by its uid after the Story file gets a new number", async () => {
    const first = await createStory({ title: "First" }, project.ctx);
    await rename(project.path("stories/BACKLOG/ROW-01.md"), project.path("stories/BACKLOG/ROW-07.md"));
    await createStory({ title: "Second" }, project.ctx);

    const found = await resolveStoryRef({ id: "ROW-01", uid: first.uid }, project.ctx);

    expect(found).toMatchObject({ id: "ROW-07", uid: first.uid, title: "First" });
  });

  it("finds a Story by its uid when a different Story has the old ID", async () => {
    const first = await createStory({ title: "First" }, project.ctx);
    await rename(project.path("stories/BACKLOG/ROW-01.md"), project.path("stories/BACKLOG/ROW-05.md"));
    await createStory({ title: "Takes the old number" }, project.ctx);
    await rename(project.path("stories/BACKLOG/ROW-06.md"), project.path("stories/BACKLOG/ROW-01.md"));

    expect(await resolveStoryRef({ id: "ROW-01", uid: first.uid }, project.ctx)).toMatchObject({ id: "ROW-05" });
    expect(await resolveStoryRef({ id: "ROW-01" }, project.ctx)).toMatchObject({ title: "Takes the old number" });
  });

  it("finds a Story by its ID without a uid, or with a uid that no Story has", async () => {
    await createStory({ title: "First" }, project.ctx);

    expect(await resolveStoryRef({ id: "ROW-01" }, project.ctx)).toMatchObject({ title: "First" });
    expect(await resolveStoryRef({ id: "1", uid: UID_A }, project.ctx)).toMatchObject({ title: "First" });
  });

  it("finds a Story without a uid by its ID, and throws NOT_FOUND when no Story matches", async () => {
    await createStory({ title: "Old" }, project.ctx);
    await removeUid("stories/BACKLOG/ROW-01.md");

    const found = await resolveStoryRef({ id: "ROW-01", uid: UID_A }, project.ctx);

    expect(found.title).toBe("Old");
    expect("uid" in found).toBe(false);
    await expect(resolveStoryRef({ id: "ROW-09", uid: UID_A }, project.ctx)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lists the ID and the uid of each Story, without a uid key for a Story without a uid", async () => {
    const first = await createStory({ title: "First" }, project.ctx);
    await createStory({ title: "Old" }, project.ctx);
    await removeUid("stories/BACKLOG/ROW-02.md");

    expect(await listStoryRefs(project.ctx)).toEqual([{ id: "ROW-01", uid: first.uid }, { id: "ROW-02" }]);
  });
});
