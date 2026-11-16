import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addCustomField } from "../custom-field/custom-field.js";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { updateStage } from "../stage/stage.js";
import { useTestProject } from "../test-project/test-project.js";
import { createStory, deleteStory, getStory, searchStories, updateStory } from "./story.js";

/** The text of a story file without the times and the uid, for the tests that do not examine them. */
function withoutTimes(text: string): string {
  return text.replace(/^(uid|createdAt|updatedAt): .*\n/gm, "");
}

/** A lower-case UUID v4. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("story", () => {
  const project = useTestProject();
  const readUntimed = async (path: string) => withoutTimes(await project.read(path));

  async function addFields(): Promise<void> {
    await addCustomField({ label: "Points", type: "number" }, project.ctx);
    await addCustomField({ label: "Priority", type: "select", options: ["low", "high"] }, project.ctx);
    await addCustomField({ label: "Owner", type: "string" }, project.ctx);
  }

  describe("createStory", () => {
    it("creates a story in the first enabled stage with every field unset", async () => {
      await addFields();
      await updateStage({ key: "BACKLOG", enabled: false }, project.ctx);
      const story = await createStory({ title: " First ", description: "Body" }, project.ctx);
      expect(story).toEqual({
        attachmentCount: 0,
        id: "ROW-01",
        number: 1,
        uid: story.uid,
        title: "First",
        stage: "DONE",
        position: 1,
        dependsOn: [],
        tags: [],
        createdAt: story.createdAt,
        updatedAt: story.createdAt,
        description: "Body",
        fields: { points: null, priority: null, owner: null },
        path: join(project.paths.storiesDir, "DONE", "ROW-01.md"),
      });
      expect(story.uid).toMatch(UUID);
      expect(story.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      expect(await readUntimed("stories/DONE/ROW-01.md")).toBe(
        "---\ntitle: First\nstage: DONE\npoints: null\npriority: null\nowner: null\n---\n\nBody\n",
      );
    });

    it("numbers stories after the highest number", async () => {
      await project.write("stories/ROW-07.md", "---\ntitle: Seven\nstage: BACKLOG\n---\n");
      expect((await createStory({ title: "Next" }, project.ctx)).id).toBe("ROW-08");
      await project.write("stories/DONE/ROW-12.md", "---\ntitle: Twelve\nstage: DONE\n---\n");
      expect((await createStory({ title: "After" }, project.ctx)).id).toBe("ROW-13");
    });

    it("writes the file in the folder of its stage", async () => {
      const story = await createStory({ title: "T", stage: "BACKLOG" }, project.ctx);
      expect(story.path).toBe(join(project.paths.storiesDir, "BACKLOG", "ROW-01.md"));
      expect(await readUntimed("stories/BACKLOG/ROW-01.md")).toBe("---\ntitle: T\nstage: BACKLOG\n---\n\n");
      expect(await readdir(project.paths.storiesDir)).toEqual(["BACKLOG"]);
    });

    it("parses field text and accepts a stage key in any case", async () => {
      await addFields();
      const story = await createStory(
        { title: "T", stage: "done", fields: { points: "3", priority: "high" } },
        project.ctx,
      );
      expect(story.stage).toBe("DONE");
      expect(story.fields).toEqual({ points: 3, priority: "high", owner: null });
    });

    it("reports every invalid input", async () => {
      await addFields();
      const error = await createStory(
        { title: "", stage: "NOPE", fields: { points: "x", color: "red" } },
        project.ctx,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details.issues).toMatchObject([
        { path: ["stage"] },
        { path: ["title"] },
        { path: ["points"] },
        { path: ["color"], message: 'Unknown custom field "color"' },
      ]);
    });
  });

  describe("getStory", () => {
    it("accepts the ID in several forms", async () => {
      await createStory({ title: "T" }, project.ctx);
      for (const id of ["ROW-01", "row-1", "1", " 01 "]) {
        expect((await getStory({ id }, project.ctx)).id).toBe("ROW-01");
      }
    });

    it("throws NotFoundError for an unknown or foreign ID", async () => {
      await createStory({ title: "T" }, project.ctx);
      await expect(getStory({ id: "ROW-2" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getStory({ id: "WEB-1" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getStory({ id: "abc" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ValidationError for a story file that breaks the config", async () => {
      await project.write("stories/ROW-01.md", "---\nstage: NOPE\n---\n");
      const error = await getStory({ id: "1" }, project.ctx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).hint).toMatch(/rowbly doctor/);
    });
  });

  describe("updateStory", () => {
    it("changes only the given values", async () => {
      await addFields();
      await createStory({ title: "T", description: "Body", fields: { owner: "sam", points: 1 } }, project.ctx);
      const story = await updateStory({ id: "1", stage: "DONE", fields: { points: "" } }, project.ctx);
      expect(story).toMatchObject({
        title: "T",
        stage: "DONE",
        description: "Body",
        fields: { points: null, owner: "sam" },
      });
      expect(await getStory({ id: "1" }, project.ctx)).toEqual(story);
    });

    it("moves the file to the folder of the new stage", async () => {
      await createStory({ title: "One", description: "Body" }, project.ctx);
      await createStory({ title: "Two" }, project.ctx);
      const moved = await updateStory({ id: "1", stage: "DONE" }, project.ctx);
      expect(moved.path).toBe(join(project.paths.storiesDir, "DONE", "ROW-01.md"));
      expect(await readUntimed("stories/DONE/ROW-01.md")).toBe("---\ntitle: One\nstage: DONE\n---\n\nBody\n");
      expect(await readdir(join(project.paths.storiesDir, "BACKLOG"))).toEqual(["ROW-02.md"]);
      await updateStory({ id: "2", stage: "DONE" }, project.ctx);
      expect(await readdir(project.paths.storiesDir)).toEqual(["DONE"]);
      expect(await readdir(join(project.paths.storiesDir, "DONE"))).toEqual(["ROW-01.md", "ROW-02.md"]);
    });

    it("moves a file of the old flat layout to the folder of its stage on a write", async () => {
      await project.write("stories/ROW-01.md", "---\ntitle: One\nstage: BACKLOG\n---\n");
      const story = await updateStory({ id: "1", title: "Uno" }, project.ctx);
      expect(story.path).toBe(join(project.paths.storiesDir, "BACKLOG", "ROW-01.md"));
      expect(await readdir(project.paths.storiesDir)).toEqual(["BACKLOG"]);
    });

    it("does not write an invalid update", async () => {
      await addFields();
      await createStory({ title: "T" }, project.ctx);
      const before = await project.read("stories/BACKLOG/ROW-01.md");
      await expect(updateStory({ id: "1", title: " ", fields: { priority: "mid" } }, project.ctx)).rejects.toThrow(
        ValidationError,
      );
      expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(before);
    });
  });

  describe("board order", () => {
    const at = (iso: string) => ({ ...project.ctx, now: () => new Date(iso) });
    async function seed(): Promise<void> {
      await createStory({ title: "One" }, at("2025-01-01T00:00:00.000Z"));
      await createStory({ title: "Two" }, at("2025-01-02T00:00:00.000Z"));
      await createStory({ title: "Three" }, at("2025-01-03T00:00:00.000Z"));
      await createStory({ title: "Shipped", stage: "DONE" }, at("2025-01-04T00:00:00.000Z"));
    }
    const order = async (stage: string) =>
      (await searchStories({ stage }, project.ctx)).map((story) => `${story.position}:${story.title}`);

    it("puts a new story at position 1 of its stage", async () => {
      await seed();
      expect(await order("BACKLOG")).toEqual(["1:Three", "2:Two", "3:One"]);
      expect((await getStory({ id: "ROW-03" }, project.ctx)).position).toBe(1);
    });

    it("puts a story at position 1 of its stage after a change of the description", async () => {
      await seed();
      const story = await updateStory({ id: "ROW-01", description: "New" }, at("2025-02-01T00:00:00.000Z"));
      expect(story.position).toBe(1);
      expect(await order("BACKLOG")).toEqual(["1:One", "2:Three", "3:Two"]);
    });

    it("puts a story at position 1 of a different stage, and writes only its file", async () => {
      await seed();
      const before = await Promise.all(
        ["BACKLOG/ROW-01.md", "BACKLOG/ROW-03.md", "DONE/ROW-04.md"].map((path) => project.read(`stories/${path}`)),
      );
      const story = await updateStory({ id: "ROW-02", stage: "DONE" }, at("2025-02-01T00:00:00.000Z"));
      expect(story.position).toBe(1);
      expect(await order("DONE")).toEqual(["1:Two", "2:Shipped"]);
      expect(await order("BACKLOG")).toEqual(["1:Three", "2:One"]);
      expect((await getStory({ id: "ROW-02" }, project.ctx)).position).toBe(1);
      const after = await Promise.all(
        ["BACKLOG/ROW-01.md", "BACKLOG/ROW-03.md", "DONE/ROW-04.md"].map((path) => project.read(`stories/${path}`)),
      );
      expect(after).toEqual(before);
      expect(await readUntimed("stories/DONE/ROW-02.md")).toBe("---\ntitle: Two\nstage: DONE\n---\n\n");
    });

    it("keeps the place of a story after an update that does not change it", async () => {
      await seed();
      const story = await updateStory({ id: "ROW-01", title: "One" }, at("2025-02-01T00:00:00.000Z"));
      expect(story.position).toBe(3);
      expect(await order("BACKLOG")).toEqual(["1:Three", "2:Two", "3:One"]);
    });

    it("keeps an old position key in the file, and the key has no effect on the order", async () => {
      await project.write(
        "stories/BACKLOG/ROW-01.md",
        "---\ntitle: One\nstage: BACKLOG\nposition: 1\nupdatedAt: 2025-01-01T00:00:00.000Z\n---\n",
      );
      await project.write(
        "stories/BACKLOG/ROW-02.md",
        "---\ntitle: Two\nstage: BACKLOG\nposition: 2\nupdatedAt: 2025-01-02T00:00:00.000Z\n---\n",
      );
      expect(await order("BACKLOG")).toEqual(["1:Two", "2:One"]);
      await updateStory({ id: "ROW-01", title: "Uno" }, at("2025-02-01T00:00:00.000Z"));
      expect(await order("BACKLOG")).toEqual(["1:Uno", "2:Two"]);
      expect(await readUntimed("stories/BACKLOG/ROW-01.md")).toBe(
        "---\ntitle: Uno\nstage: BACKLOG\nposition: 1\n---\n\n",
      );
    });
  });

  describe("deleteStory", () => {
    it("removes the file", async () => {
      await createStory({ title: "T" }, project.ctx);
      expect(await deleteStory({ id: "1" }, project.ctx)).toEqual({ id: "ROW-01", warnings: [] });
      await expect(getStory({ id: "1" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
      expect(await readdir(project.paths.storiesDir)).toEqual([]);
    });
  });

  describe("dependencies", () => {
    async function seed(count: number): Promise<void> {
      for (let i = 1; i <= count; i++) {
        await createStory({ title: `S${i}` }, project.ctx);
      }
    }

    async function files(): Promise<string[]> {
      return Promise.all([1, 2, 3, 4].map((n) => project.read(`stories/BACKLOG/ROW-0${n}.md`).catch(() => "")));
    }

    it("reads a story without dependsOn as an empty list, and an update of the title adds no key", async () => {
      await project.write("stories/ROW-01.md", "---\ntitle: One\nstage: BACKLOG\nextra: 1\n---\n\nBody\n");
      expect((await getStory({ id: "ROW-01" }, project.ctx)).dependsOn).toEqual([]);
      await updateStory({ id: "ROW-01", title: "Uno" }, project.ctx);
      expect(await readUntimed("stories/BACKLOG/ROW-01.md")).toBe(
        "---\ntitle: Uno\nstage: BACKLOG\nextra: 1\n---\n\nBody\n",
      );
    });

    it("saves the list in order, without duplicates, in canonical form, after position and before the fields", async () => {
      await addFields();
      await seed(2);
      const created = await createStory({ title: "Three", dependsOn: ["2", "row-1", "ROW-02"] }, project.ctx);
      expect(created.dependsOn).toEqual(["ROW-02", "ROW-01"]);
      expect(await readUntimed("stories/BACKLOG/ROW-03.md")).toBe(
        "---\ntitle: Three\nstage: BACKLOG\ndependsOn:\n  - ROW-02\n  - ROW-01\npoints: null\npriority: null\nowner: null\n---\n\n",
      );
      await updateStory({ id: "ROW-03", dependsOn: ["row-1"] }, project.ctx);
      expect(await readUntimed("stories/BACKLOG/ROW-03.md")).toBe(
        "---\ntitle: Three\nstage: BACKLOG\ndependsOn:\n  - ROW-01\npoints: null\npriority: null\nowner: null\n---\n\n",
      );
    });

    it("keeps the list on an update without dependsOn, and removes the key for an empty list", async () => {
      await seed(1);
      await createStory({ title: "Two", dependsOn: ["ROW-01"] }, project.ctx);
      await updateStory({ id: "ROW-02", title: "Second" }, project.ctx);
      expect((await getStory({ id: "ROW-02" }, project.ctx)).dependsOn).toEqual(["ROW-01"]);
      await updateStory({ id: "ROW-02", dependsOn: [] }, project.ctx);
      expect(await readUntimed("stories/BACKLOG/ROW-02.md")).toBe("---\ntitle: Second\nstage: BACKLOG\n---\n\n");
    });

    it.each([
      [["ROW-99"], { unknown: ["ROW-99"] }, /Unknown Story: ROW-99/],
      [["ABC-01"], { otherProject: ["ABC-01"] }, /Not a Story of this Project: ABC-01/],
      [["3"], { self: ["ROW-03"] }, /ROW-03 cannot depend on itself/],
      [["ROW-01"], { cycle: ["ROW-03", "ROW-01", "ROW-03"] }, /ROW-03 → ROW-01 → ROW-03/],
    ])("rejects %j with a ValidationError and saves nothing", async (dependsOn, details, message) => {
      await seed(3);
      await updateStory({ id: "ROW-01", dependsOn: ["ROW-03"] }, project.ctx);
      const before = await files();
      const error = await updateStory({ id: "ROW-03", title: "Changed", dependsOn }, project.ctx).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toMatch(message);
      expect((error as ValidationError).details).toMatchObject(details);
      expect(await files()).toEqual(before);
    });

    it("rejects an invalid list on create and saves no file", async () => {
      await seed(1);
      const error = await createStory({ title: "Two", dependsOn: ["ROW-02"] }, project.ctx).catch((e: unknown) => e);
      expect((error as ValidationError).details).toMatchObject({ self: ["ROW-02"] });
      await expect(getStory({ id: "ROW-02" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("removes a deleted upstream story from each downstream story, with a warning for each", async () => {
      await seed(2);
      await createStory({ title: "Three", dependsOn: ["ROW-01", "ROW-02"] }, project.ctx);
      await createStory({ title: "Four", dependsOn: ["ROW-01"] }, project.ctx);
      expect(await deleteStory({ id: "ROW-01" }, project.ctx)).toEqual({
        id: "ROW-01",
        warnings: ["Removed the dependency on ROW-01 from ROW-03", "Removed the dependency on ROW-01 from ROW-04"],
      });
      expect((await getStory({ id: "ROW-03" }, project.ctx)).dependsOn).toEqual(["ROW-02"]);
      expect(await readUntimed("stories/BACKLOG/ROW-04.md")).toBe("---\ntitle: Four\nstage: BACKLOG\n---\n\n");
    });
  });

  describe("addDependsOn and removeDependsOn", () => {
    async function seed(count: number): Promise<void> {
      for (let i = 1; i <= count; i++) {
        await createStory({ title: `S${i}` }, project.ctx);
      }
    }

    it("adds and removes only the given IDs, and removes the key with the last ID", async () => {
      await seed(3);
      await createStory({ title: "Four", dependsOn: ["ROW-01"] }, project.ctx);
      const added = await updateStory({ id: "ROW-04", addDependsOn: ["3", "row-2"] }, project.ctx);
      expect(added.dependsOn).toEqual(["ROW-01", "ROW-03", "ROW-02"]);
      const removed = await updateStory({ id: "ROW-04", removeDependsOn: ["ROW-03", "ROW-01"] }, project.ctx);
      expect(removed.dependsOn).toEqual(["ROW-02"]);
      await updateStory({ id: "ROW-04", removeDependsOn: ["ROW-02"] }, project.ctx);
      expect(await readUntimed("stories/BACKLOG/ROW-04.md")).toBe("---\ntitle: Four\nstage: BACKLOG\n---\n\n");
    });

    it("changes nothing for an add of an ID in the list or a remove of a missing ID", async () => {
      await seed(2);
      await createStory({ title: "Three", dependsOn: ["ROW-01"] }, project.ctx);
      const before = await project.read("stories/BACKLOG/ROW-03.md");
      await updateStory({ id: "ROW-03", addDependsOn: ["ROW-01"], removeDependsOn: ["ROW-02"] }, project.ctx);
      expect(await project.read("stories/BACKLOG/ROW-03.md")).toBe(before);
    });

    it("validates the result as for dependsOn and saves nothing", async () => {
      await seed(2);
      await updateStory({ id: "ROW-01", dependsOn: ["ROW-02"] }, project.ctx);
      const before = await project.read("stories/BACKLOG/ROW-02.md");
      const cycle = await updateStory({ id: "ROW-02", addDependsOn: ["ROW-01"] }, project.ctx).catch((e: unknown) => e);
      expect((cycle as ValidationError).details).toMatchObject({ cycle: ["ROW-02", "ROW-01", "ROW-02"] });
      const unknown = await updateStory({ id: "ROW-02", addDependsOn: ["ROW-09"] }, project.ctx).catch(
        (e: unknown) => e,
      );
      expect((unknown as ValidationError).details).toMatchObject({ unknown: ["ROW-09"] });
      expect(await project.read("stories/BACKLOG/ROW-02.md")).toBe(before);
    });

    it("rejects dependsOn together with addDependsOn or removeDependsOn", async () => {
      await seed(2);
      await expect(
        updateStory({ id: "ROW-02", dependsOn: ["ROW-01"], addDependsOn: ["ROW-01"] }, project.ctx),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        updateStory({ id: "ROW-02", dependsOn: [], removeDependsOn: ["ROW-01"] }, project.ctx),
      ).rejects.toBeInstanceOf(ValidationError);
      expect((await getStory({ id: "ROW-02" }, project.ctx)).dependsOn).toEqual([]);
    });
  });

  describe("searchStories", () => {
    async function seed(): Promise<void> {
      await addFields();
      const at = (iso: string) => ({ ...project.ctx, now: () => new Date(iso) });
      await createStory(
        { title: "Login page", fields: { priority: "high", owner: "Sam" } },
        at("2025-01-03T00:00:00Z"),
      );
      await createStory(
        { title: "Logout", description: "Clear the session", stage: "DONE" },
        at("2025-01-02T00:00:00Z"),
      );
      await createStory({ title: "Signup", fields: { priority: "low", points: 2 } }, at("2025-01-01T00:00:00Z"));
    }
    const ids = (stories: { id: string }[]) => stories.map((story) => story.id);

    it("returns every story without filters, in board order", async () => {
      await seed();
      const stories = await searchStories({}, project.ctx);
      expect(ids(stories)).toEqual(["ROW-01", "ROW-03", "ROW-02"]);
      expect(stories.map((story) => story.position)).toEqual([1, 2, 1]);
    });

    it("matches every word of the query in any case", async () => {
      await seed();
      expect(ids(await searchStories({ query: "log" }, project.ctx))).toEqual(["ROW-01", "ROW-02"]);
      expect(ids(await searchStories({ query: "LOG session" }, project.ctx))).toEqual(["ROW-02"]);
      expect(ids(await searchStories({ query: "sam" }, project.ctx))).toEqual(["ROW-01"]);
      expect(ids(await searchStories({ query: "row-03" }, project.ctx))).toEqual(["ROW-03"]);
    });

    it("filters by stage and by field values", async () => {
      await seed();
      expect(ids(await searchStories({ stage: "done" }, project.ctx))).toEqual(["ROW-02"]);
      expect(ids(await searchStories({ fields: { priority: "high" } }, project.ctx))).toEqual(["ROW-01"]);
      expect(ids(await searchStories({ fields: { points: "2" } }, project.ctx))).toEqual(["ROW-03"]);
      expect(ids(await searchStories({ fields: { priority: "" } }, project.ctx))).toEqual(["ROW-02"]);
    });

    it("rejects an unknown stage or field", async () => {
      await expect(searchStories({ stage: "NOPE" }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      await expect(searchStories({ fields: { nope: 1 } }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
