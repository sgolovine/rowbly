import { describe, expect, it } from "vitest";
import { addCustomField } from "../custom-field/custom-field.js";
import { useTestProject } from "../test-project/test-project.js";
import { createStory, getStory, getStoryDetails, searchStories, updateStory } from "./story.js";

/** A lower-case UUID v4. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("story uid", () => {
  const project = useTestProject();

  it("createStory writes a lower-case UUID, and two new Stories get different values", async () => {
    const one = await createStory({ title: "One" }, project.ctx);
    const two = await createStory({ title: "Two" }, project.ctx);
    expect(one.uid).toMatch(UUID);
    expect(two.uid).toMatch(UUID);
    expect(one.uid).not.toBe(two.uid);
    expect(await project.read("stories/BACKLOG/ROW-01.md")).toContain(`\nuid: ${one.uid}\n`);
  });

  it("getStory, getStoryDetails and searchStories give the uid of a new Story", async () => {
    const created = await createStory({ title: "One" }, project.ctx);
    expect((await getStory({ id: "ROW-01" }, project.ctx)).uid).toBe(created.uid);
    expect((await getStoryDetails({ id: "ROW-01" }, project.ctx)).uid).toBe(created.uid);
    expect((await searchStories({}, project.ctx)).map((story) => story.uid)).toEqual([created.uid]);
  });

  it.each([
    ["title", { title: "New" }],
    ["description", { description: "New body" }],
    ["stage", { stage: "DONE" }],
    ["custom field", { fields: { owner: "sam" } }],
  ])("an update of the %s keeps the uid", async (_name, change) => {
    await addCustomField({ label: "Owner", type: "string" }, project.ctx);
    const created = await createStory({ title: "One" }, project.ctx);
    const updated = await updateStory({ id: "ROW-01", ...change }, project.ctx);
    expect(updated.uid).toBe(created.uid);
    expect((await getStory({ id: "ROW-01" }, project.ctx)).uid).toBe(created.uid);
  });

  it("loads a Story file without uid, and gives uid as undefined", async () => {
    await project.write("stories/BACKLOG/ROW-01.md", "---\ntitle: Old\nstage: BACKLOG\n---\n");
    const story = await getStory({ id: "ROW-01" }, project.ctx);
    expect(story.uid).toBeUndefined();
    expect("uid" in story).toBe(false);
  });

  it("an update of a Story without uid does not add one", async () => {
    await project.write("stories/BACKLOG/ROW-01.md", "---\ntitle: Old\nstage: BACKLOG\n---\n");
    await updateStory({ id: "ROW-01", title: "New" }, project.ctx);
    expect(await project.read("stories/BACKLOG/ROW-01.md")).not.toContain("uid");
  });
});
