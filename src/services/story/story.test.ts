import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addCustomField } from "../custom-field/custom-field.js";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { updateStage } from "../stage/stage.js";
import { useTestProject } from "../test-project/test-project.js";
import { createStory, deleteStory, getStory, searchStories, updateStory } from "./story.js";

describe("story", () => {
  const project = useTestProject();

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
        title: "First",
        stage: "DONE",
        position: 1,
        description: "Body",
        fields: { points: null, priority: null, owner: null },
        path: join(project.paths.storiesDir, "ROW-01.md"),
      });
      expect(await project.read("stories/ROW-01.md")).toBe(
        "---\ntitle: First\nstage: DONE\npoints: null\npriority: null\nowner: null\n---\n\nBody\n",
      );
    });

    it("numbers stories after the highest number", async () => {
      await project.write("stories/ROW-07.md", "---\ntitle: Seven\nstage: BACKLOG\n---\n");
      expect((await createStory({ title: "Next" }, project.ctx)).id).toBe("ROW-08");
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

    it("does not write an invalid update", async () => {
      await addFields();
      await createStory({ title: "T" }, project.ctx);
      const before = await project.read("stories/ROW-01.md");
      await expect(updateStory({ id: "1", title: " ", fields: { priority: "mid" } }, project.ctx)).rejects.toThrow(
        ValidationError,
      );
      expect(await project.read("stories/ROW-01.md")).toBe(before);
    });
  });

  describe("updateStory with a position", () => {
    async function seed(): Promise<void> {
      for (const title of ["One", "Two", "Three"]) await createStory({ title }, project.ctx);
      await createStory({ title: "Shipped", stage: "DONE" }, project.ctx);
    }
    const order = async (stage: string) =>
      (await searchStories({ stage }, project.ctx)).map((story) => `${story.position}:${story.title}`);

    it("moves a story inside its stage and rewrites the positions", async () => {
      await seed();
      const story = await updateStory({ id: "ROW-03", position: 1 }, project.ctx);
      expect(story.position).toBe(1);
      expect(await order("BACKLOG")).toEqual(["1:Three", "2:One", "3:Two"]);
      expect(await project.read("stories/ROW-03.md")).toBe("---\ntitle: Three\nstage: BACKLOG\nposition: 1\n---\n\n");
      await updateStory({ id: "ROW-03", position: 99 }, project.ctx);
      expect(await order("BACKLOG")).toEqual(["1:One", "2:Two", "3:Three"]);
    });

    it("puts a story at the position in a different stage", async () => {
      await seed();
      await updateStory({ id: "ROW-02", stage: "DONE", position: 1 }, project.ctx);
      expect(await order("DONE")).toEqual(["1:Two", "2:Shipped"]);
      expect(await order("BACKLOG")).toEqual(["1:One", "2:Three"]);
    });

    it("rejects a position that is not a whole number from 1", async () => {
      await seed();
      await expect(updateStory({ id: "ROW-01", position: 0 }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      await expect(updateStory({ id: "ROW-01", position: 1.5 }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
    });

    it("puts a story last when it changes stage without a position", async () => {
      await seed();
      await updateStory({ id: "ROW-01", stage: "DONE" }, project.ctx);
      expect(await order("DONE")).toEqual(["1:Shipped", "2:One"]);
      expect((await getStory({ id: "ROW-01" }, project.ctx)).position).toBe(2);
    });
  });

  describe("deleteStory", () => {
    it("removes the file", async () => {
      await createStory({ title: "T" }, project.ctx);
      expect(await deleteStory({ id: "1" }, project.ctx)).toEqual({ id: "ROW-01" });
      await expect(getStory({ id: "1" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("searchStories", () => {
    async function seed(): Promise<void> {
      await addFields();
      await createStory({ title: "Login page", fields: { priority: "high", owner: "Sam" } }, project.ctx);
      await createStory({ title: "Logout", description: "Clear the session", stage: "DONE" }, project.ctx);
      await createStory({ title: "Signup", fields: { priority: "low", points: 2 } }, project.ctx);
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
