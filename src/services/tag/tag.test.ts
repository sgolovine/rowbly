import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { createStory, getStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { addTag, listTags, removeTag, updateTag } from "./tag.js";

describe("tag", () => {
  const project = useTestProject();
  const config = async () => JSON.parse(await project.read("rowbly.config.json"));

  describe("addTag", () => {
    it("adds the tag to the config, in order", async () => {
      expect(await listTags(project.ctx)).toEqual([]);
      const tag = await addTag({ label: " Front end ", value: " frontend " }, project.ctx);
      await addTag({ label: "Back end", value: "back_end-2" }, project.ctx);
      expect(tag).toEqual({ value: "frontend", label: "Front end" });
      expect((await config()).tags).toEqual([
        { value: "frontend", label: "Front end" },
        { value: "back_end-2", label: "Back end" },
      ]);
      expect(await listTags(project.ctx)).toEqual((await config()).tags);
    });

    it("rejects an empty label, a bad value and a value that exists", async () => {
      const error = await addTag({ label: " ", value: "Front End" }, project.ctx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details.issues).toMatchObject([{ path: ["label"] }, { path: ["value"] }]);
      await expect(addTag({ label: "X", value: "-x" }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      await expect(addTag({ label: "X", value: "" }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      await addTag({ label: "Docs", value: "docs" }, project.ctx);
      await expect(addTag({ label: "Other", value: "docs" }, project.ctx)).rejects.toBeInstanceOf(ConflictError);
      expect(await listTags(project.ctx)).toEqual([{ value: "docs", label: "Docs" }]);
    });
  });

  describe("updateTag", () => {
    it("changes only the label; the value and the stories stay", async () => {
      await addTag({ label: "Docs", value: "docs" }, project.ctx);
      await createStory({ title: "One", tags: ["docs"] }, project.ctx);
      const before = await project.read("stories/BACKLOG/ROW-01.md");
      expect(await updateTag({ value: "docs", label: " Documentation " }, project.ctx)).toEqual({
        value: "docs",
        label: "Documentation",
      });
      expect(await listTags(project.ctx)).toEqual([{ value: "docs", label: "Documentation" }]);
      expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(before);
    });

    it("rejects an empty label and an unknown value", async () => {
      await addTag({ label: "Docs", value: "docs" }, project.ctx);
      await expect(updateTag({ value: "docs", label: "" }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      const error = await updateTag({ value: "nope", label: "X" }, project.ctx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toBe('Tag "nope" not found. Tags: docs');
    });
  });

  describe("removeTag", () => {
    it("removes the tag from the config and from each story that has it, in all stages", async () => {
      await addTag({ label: "Docs", value: "docs" }, project.ctx);
      await addTag({ label: "Front end", value: "frontend" }, project.ctx);
      await createStory({ title: "One", tags: ["docs"] }, project.ctx);
      await createStory({ title: "Two", stage: "DONE", tags: ["frontend", "docs"] }, project.ctx);
      await createStory({ title: "Three", tags: ["frontend"] }, project.ctx);
      await createStory({ title: "Four" }, project.ctx);
      const untouched = [
        await project.read("stories/BACKLOG/ROW-03.md"),
        await project.read("stories/BACKLOG/ROW-04.md"),
      ];
      const later = { ...project.ctx, now: () => new Date("2030-01-01T00:00:00.000Z") };

      expect(await removeTag({ value: "docs" }, later)).toEqual({ value: "docs", label: "Docs" });

      expect(await listTags(project.ctx)).toEqual([{ value: "frontend", label: "Front end" }]);
      const one = await getStory({ id: "ROW-01" }, project.ctx);
      expect(one.tags).toEqual([]);
      expect(one.updatedAt).toBe("2030-01-01T00:00:00.000Z");
      expect(await project.read("stories/BACKLOG/ROW-01.md")).not.toContain("tags");
      expect((await getStory({ id: "ROW-02" }, project.ctx)).tags).toEqual(["frontend"]);
      expect([
        await project.read("stories/BACKLOG/ROW-03.md"),
        await project.read("stories/BACKLOG/ROW-04.md"),
      ]).toEqual(untouched);
    });

    it("rejects an unknown value with the list of values", async () => {
      const error = await removeTag({ value: "nope" }, project.ctx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toBe('Tag "nope" not found. Tags: none');
    });
  });
});
