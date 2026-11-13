import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { createStory, getStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { addCustomField, listCustomFields, removeCustomField, updateCustomField } from "./custom-field.js";

describe("customField", () => {
  const project = useTestProject();

  describe("addCustomField", () => {
    it("adds the field to the config and to every story as null", async () => {
      await createStory({ title: "T" }, project.ctx);
      const field = await addCustomField({ label: " Due Date ", type: "date" }, project.ctx);
      expect(field).toEqual({ key: "due_date", label: "Due Date", type: "date" });
      expect(await listCustomFields(project.ctx)).toEqual([field]);
      expect(await project.read("stories/ROW-01.md")).toContain("due_date: null");
    });

    it("keeps the options of a select field", async () => {
      const field = await addCustomField({ label: "P", key: "prio", type: "select", options: ["a"] }, project.ctx);
      expect(field).toEqual({ key: "prio", label: "P", type: "select", options: ["a"] });
    });

    it("rejects invalid input and duplicates", async () => {
      const error = await addCustomField({ label: "", key: "Title", type: "select" }, project.ctx).catch(
        (e: unknown) => e,
      );
      expect((error as ValidationError).details.issues).toMatchObject([
        { path: ["label"] },
        { path: ["key"] },
        { path: ["options"] },
      ]);
      await expect(addCustomField({ label: "title", type: "string" }, project.ctx)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(addCustomField({ label: "X", type: "nope" as "string" }, project.ctx)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await expect(addCustomField({ label: "Owner", type: "string" }, project.ctx)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });
  });

  describe("updateCustomField", () => {
    it("renames the field in the config and in every story", async () => {
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await createStory({ title: "T", fields: { owner: "sam" } }, project.ctx);
      const field = await updateCustomField({ key: "owner", newKey: "assignee", label: "Assignee" }, project.ctx);
      expect(field).toEqual({ key: "assignee", label: "Assignee", type: "string" });
      expect((await getStory({ id: "1" }, project.ctx)).fields).toEqual({ assignee: "sam" });
      expect(await project.read("stories/ROW-01.md")).not.toContain("owner");
    });

    it("converts existing values to the new type", async () => {
      await addCustomField({ label: "Points", type: "string" }, project.ctx);
      await createStory({ title: "T", fields: { points: "3" } }, project.ctx);
      await updateCustomField({ key: "points", type: "number" }, project.ctx);
      expect((await getStory({ id: "1" }, project.ctx)).fields.points).toBe(3);
    });

    it("drops the options when a select field changes type", async () => {
      await addCustomField({ label: "P", type: "select", options: ["a"] }, project.ctx);
      expect(await updateCustomField({ key: "p", type: "string" }, project.ctx)).toEqual({
        key: "p",
        label: "P",
        type: "string",
      });
    });

    it("changes nothing when an existing value does not fit", async () => {
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await createStory({ title: "T", fields: { owner: "sam" } }, project.ctx);
      const before = await project.read("stories/ROW-01.md");
      const error = await updateCustomField({ key: "owner", type: "number" }, project.ctx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details.issues).toMatchObject([{ path: ["ROW-01"] }]);
      expect(await project.read("stories/ROW-01.md")).toBe(before);
      expect((await listCustomFields(project.ctx))[0]?.type).toBe("string");
    });

    it("rejects invalid input, a key that exists and an unknown field", async () => {
      await addCustomField({ label: "A", type: "string" }, project.ctx);
      await addCustomField({ label: "B", type: "string" }, project.ctx);
      await expect(updateCustomField({ key: "a", label: " " }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      await expect(updateCustomField({ key: "a", newKey: "Bad" }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      await expect(updateCustomField({ key: "a", type: "select" }, project.ctx)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(updateCustomField({ key: "a", newKey: "b" }, project.ctx)).rejects.toBeInstanceOf(ConflictError);
      await expect(updateCustomField({ key: "c" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("removeCustomField", () => {
    it("removes the field from the config and from every story", async () => {
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await createStory({ title: "T", fields: { owner: "sam" } }, project.ctx);
      expect(await removeCustomField({ key: "owner" }, project.ctx)).toEqual({
        key: "owner",
        label: "Owner",
        type: "string",
      });
      expect(await listCustomFields(project.ctx)).toEqual([]);
      expect(await project.read("stories/ROW-01.md")).not.toContain("owner");
    });

    it("throws NotFoundError for an unknown field", async () => {
      await expect(removeCustomField({ key: "nope" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
