import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { addTag } from "../tag/tag.js";
import { useTestProject } from "../test-project/test-project.js";
import { createStory, getStory, searchStories, updateStory } from "./story.js";

/** The text of a story file without the times and the uid. */
function withoutTimes(text: string): string {
  return text.replace(/^(uid|createdAt|updatedAt): .*\n/gm, "");
}

describe("story tags", () => {
  const project = useTestProject();
  const readUntimed = async (path: string) => withoutTimes(await project.read(path));

  async function addTags(): Promise<void> {
    await addTag({ label: "Front end", value: "frontend" }, project.ctx);
    await addTag({ label: "Back end", value: "backend" }, project.ctx);
    await addTag({ label: "Docs", value: "docs" }, project.ctx);
  }

  describe("createStory", () => {
    it("saves the tags once, after dependsOn, and gives them on the story", async () => {
      await addTags();
      await createStory({ title: "One" }, project.ctx);
      const story = await createStory(
        { title: "Two", dependsOn: ["ROW-01"], tags: ["frontend", " backend", "frontend"] },
        project.ctx,
      );
      expect(story.tags).toEqual(["frontend", "backend"]);
      expect(await readUntimed("stories/BACKLOG/ROW-02.md")).toBe(
        "---\ntitle: Two\nstage: BACKLOG\ndependsOn:\n  - ROW-01\ntags:\n  - frontend\n  - backend\n---\n\n",
      );
    });

    it("gives [] and writes no key for a story without tags", async () => {
      const story = await createStory({ title: "One", tags: [] }, project.ctx);
      expect(story.tags).toEqual([]);
      expect(await readUntimed("stories/BACKLOG/ROW-01.md")).toBe("---\ntitle: One\nstage: BACKLOG\n---\n\n");
    });

    it("rejects a value that is not a tag of the project and writes nothing", async () => {
      await addTags();
      const error = await createStory({ title: "One", tags: ["frontend", "nope"] }, project.ctx).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details.issues).toEqual([
        { path: ["tags"], message: 'Unknown tag "nope". Tags: frontend, backend, docs' },
      ]);
      expect(await searchStories({}, project.ctx)).toEqual([]);
    });
  });

  describe("updateStory", () => {
    it("replaces the list with tags, and [] removes the key", async () => {
      await addTags();
      await createStory({ title: "One", tags: ["frontend"] }, project.ctx);
      expect((await updateStory({ id: "ROW-01", tags: ["docs", "backend"] }, project.ctx)).tags).toEqual([
        "docs",
        "backend",
      ]);
      await updateStory({ id: "ROW-01", tags: [] }, project.ctx);
      expect(await readUntimed("stories/BACKLOG/ROW-01.md")).toBe("---\ntitle: One\nstage: BACKLOG\n---\n\n");
    });

    it("adds and removes only the given values, and keeps the list without tag input", async () => {
      await addTags();
      await createStory({ title: "One", tags: ["frontend"] }, project.ctx);
      const added = await updateStory({ id: "ROW-01", addTags: ["backend", "frontend"] }, project.ctx);
      expect(added.tags).toEqual(["frontend", "backend"]);
      const changed = await updateStory({ id: "ROW-01", addTags: ["docs"], removeTags: ["frontend"] }, project.ctx);
      expect(changed.tags).toEqual(["backend", "docs"]);
      expect((await updateStory({ id: "ROW-01", title: "New" }, project.ctx)).tags).toEqual(["backend", "docs"]);
    });

    it("changes nothing for an add of a value in the list or a remove of a missing value", async () => {
      await addTags();
      await createStory({ title: "One", tags: ["frontend"] }, project.ctx);
      const before = await project.read("stories/BACKLOG/ROW-01.md");
      await updateStory({ id: "ROW-01", addTags: ["frontend"], removeTags: ["docs"] }, project.ctx);
      expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(before);
    });

    it("rejects an unknown value and tags together with addTags or removeTags", async () => {
      await addTags();
      await createStory({ title: "One", tags: ["frontend"] }, project.ctx);
      const before = await project.read("stories/BACKLOG/ROW-01.md");
      await expect(updateStory({ id: "ROW-01", tags: ["nope"] }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      await expect(updateStory({ id: "ROW-01", addTags: ["nope"] }, project.ctx)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        updateStory({ id: "ROW-01", tags: ["docs"], addTags: ["backend"] }, project.ctx),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        updateStory({ id: "ROW-01", tags: [], removeTags: ["frontend"] }, project.ctx),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(before);
    });
  });

  it("reads a list with items that are not strings without the bad items", async () => {
    await createStory({ title: "One" }, project.ctx);
    await project.write("stories/BACKLOG/ROW-01.md", "---\ntitle: One\nstage: BACKLOG\ntags:\n  - a\n  - 3\n---\n");
    expect((await getStory({ id: "ROW-01" }, project.ctx)).tags).toEqual(["a"]);
  });

  describe("searchStories", () => {
    const ids = (stories: { id: string }[]) => stories.map((story) => story.id).sort();

    it("gives only the stories that have all of the tags", async () => {
      await addTags();
      await createStory({ title: "One", tags: ["frontend"] }, project.ctx);
      await createStory({ title: "Two", tags: ["frontend", "backend"] }, project.ctx);
      await createStory({ title: "Three" }, project.ctx);
      expect(ids(await searchStories({ tags: ["frontend"] }, project.ctx))).toEqual(["ROW-01", "ROW-02"]);
      expect(ids(await searchStories({ tags: ["frontend", "backend"] }, project.ctx))).toEqual(["ROW-02"]);
      expect(ids(await searchStories({ tags: ["docs"] }, project.ctx))).toEqual([]);
      expect(ids(await searchStories({ tags: [] }, project.ctx))).toEqual(["ROW-01", "ROW-02", "ROW-03"]);
    });

    it("rejects a value that is not a tag of the project", async () => {
      await expect(searchStories({ tags: ["nope"] }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
