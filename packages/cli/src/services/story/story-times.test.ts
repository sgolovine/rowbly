import { describe, expect, it } from "vitest";
import { addCustomField } from "../custom-field/custom-field.js";
import { useTestProject } from "../test-project/test-project.js";
import { createStory, deleteStory, getStory, searchStories, touchStory, updateStory } from "./story.js";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const T1 = "2025-01-02T03:04:05.678Z";
const T2 = "2025-02-03T04:05:06.789Z";

describe("story times", () => {
  const project = useTestProject();
  const at = (iso: string) => ({ ...project.ctx, now: () => new Date(iso) });
  const times = async (id: string) => {
    const { createdAt, updatedAt } = await getStory({ id }, project.ctx);
    return { createdAt, updatedAt };
  };

  it("createStory writes createdAt and updatedAt with the same UTC value, after dependsOn and before the fields", async () => {
    await addCustomField({ label: "Owner", type: "string" }, project.ctx);
    await createStory({ title: "One" }, at(T1));
    const story = await createStory({ title: "Two", dependsOn: ["ROW-01"] }, at(T1));
    expect(story).toMatchObject({ createdAt: T1, updatedAt: T1 });
    expect(await project.read("stories/BACKLOG/ROW-02.md")).toBe(
      `---\ntitle: Two\nstage: BACKLOG\nuid: ${story.uid}\ndependsOn:\n  - ROW-01\ncreatedAt: ${T1}\nupdatedAt: ${T1}\nowner: null\n---\n\n`,
    );
    expect((await searchStories({}, project.ctx)).map((s) => s.createdAt)).toEqual([T1, T1]);
  });

  it.each([
    ["title", { title: "New" }],
    ["stage", { stage: "DONE" }],
    ["description", { description: "New body" }],
    ["custom field", { fields: { owner: "Ann" } }],
    ["dependencies", { addDependsOn: ["ROW-02"] }],
    ["images", { attachments: [{ name: "a.png", bytes: png }] }],
  ])("updateStory with a change of the %s sets updatedAt and keeps createdAt", async (_name, change) => {
    await addCustomField({ label: "Owner", type: "string" }, project.ctx);
    await createStory({ title: "One" }, at(T1));
    await createStory({ title: "Two" }, at(T1));
    const updated = await updateStory({ id: "ROW-01", ...change }, at(T2));
    expect(updated).toMatchObject({ createdAt: T1, updatedAt: T2 });
    expect(await times("ROW-01")).toEqual({ createdAt: T1, updatedAt: T2 });
  });

  it("an update that does not change the file keeps updatedAt", async () => {
    await createStory({ title: "One" }, at(T1));
    await createStory({ title: "Two", dependsOn: ["ROW-01"] }, at(T1));
    const before = await project.read("stories/BACKLOG/ROW-02.md");
    const story = await updateStory({ id: "ROW-02", addDependsOn: ["ROW-01"], removeDependsOn: ["ROW-09"] }, at(T2));
    expect(story.updatedAt).toBe(T1);
    await updateStory({ id: "ROW-02", title: "Two" }, at(T2));
    expect(await project.read("stories/BACKLOG/ROW-02.md")).toBe(before);
  });

  it("the other stories of the stage keep updatedAt and their bytes when a story moves", async () => {
    for (const title of ["One", "Two", "Three"]) {
      await createStory({ title }, at(T1));
    }
    await createStory({ title: "Shipped", stage: "DONE" }, at(T1));
    const before = await Promise.all(
      ["BACKLOG/ROW-01.md", "BACKLOG/ROW-02.md", "DONE/ROW-04.md"].map((path) => project.read(`stories/${path}`)),
    );
    const moved = await updateStory({ id: "ROW-03", stage: "DONE" }, at(T2));
    expect(moved.position).toBe(1);
    expect(await times("ROW-03")).toEqual({ createdAt: T1, updatedAt: T2 });
    const after = await Promise.all(
      ["BACKLOG/ROW-01.md", "BACKLOG/ROW-02.md", "DONE/ROW-04.md"].map((path) => project.read(`stories/${path}`)),
    );
    expect(after).toEqual(before);
    expect((await getStory({ id: "ROW-04" }, project.ctx)).position).toBe(2);
  });

  it("reads a story without times or with invalid times as null, and an update adds only updatedAt", async () => {
    await project.write("stories/ROW-01.md", "---\ntitle: Old\nstage: BACKLOG\n---\n\nBody\n");
    await project.write("stories/ROW-02.md", "---\ntitle: Bad\nstage: BACKLOG\ncreatedAt: nope\nupdatedAt: 5\n---\n");
    expect(await times("ROW-01")).toEqual({ createdAt: null, updatedAt: null });
    expect(await times("ROW-02")).toEqual({ createdAt: null, updatedAt: null });
    await updateStory({ id: "ROW-01", title: "Older" }, at(T2));
    expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(
      `---\ntitle: Older\nstage: BACKLOG\nupdatedAt: ${T2}\n---\n\nBody\n`,
    );
  });

  it("a delete sets updatedAt of each story that loses the dependency", async () => {
    await createStory({ title: "One" }, at(T1));
    await createStory({ title: "Two", dependsOn: ["ROW-01"] }, at(T1));
    await createStory({ title: "Three" }, at(T1));
    await deleteStory({ id: "ROW-01" }, at(T2));
    expect(await times("ROW-02")).toEqual({ createdAt: T1, updatedAt: T2 });
    expect(await times("ROW-03")).toEqual({ createdAt: T1, updatedAt: T1 });
  });

  it("touchStory sets updatedAt only", async () => {
    await createStory({ title: "One", description: "Body" }, at(T1));
    await touchStory({ id: "1" }, at(T2));
    expect(await getStory({ id: "ROW-01" }, project.ctx)).toMatchObject({
      title: "One",
      description: "Body",
      createdAt: T1,
      updatedAt: T2,
    });
  });
});
