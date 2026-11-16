import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig, writeConfig } from "../config/config.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { createStory, getStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import {
  collapsedStageKeys,
  createStage,
  deleteStage,
  getStage,
  listStages,
  lookupStage,
  unknownStageIssues,
  updateStage,
} from "./stage.js";

describe("lookupStage and unknownStageIssues", () => {
  const config = {
    projectName: "R",
    projectKey: "R",
    customFields: [],
    stages: [{ key: "BACKLOG", label: "Backlog", enabled: true }],
  };

  it("finds a stage in any case and records an issue when it is missing", () => {
    expect(lookupStage(config, " backlog ")?.key).toBe("BACKLOG");
    expect(unknownStageIssues(config, " backlog ", ["stage"])).toEqual([]);
    expect(lookupStage(config, "NOPE")).toBeUndefined();
    expect(unknownStageIssues(config, "NOPE", ["stage"])).toEqual([
      { path: ["stage"], message: 'Unknown stage "NOPE". Stages: BACKLOG' },
    ]);
  });
});

describe("collapsedStageKeys", () => {
  it("gives the keys of the stages with expandedByDefault false; a stage without the key is expanded", () => {
    expect(
      collapsedStageKeys([
        { key: "A", label: "A", enabled: true },
        { key: "B", label: "B", enabled: true, expandedByDefault: false },
        { key: "C", label: "C", enabled: false, expandedByDefault: true },
        { key: "D", label: "D", enabled: false, expandedByDefault: false },
      ]),
    ).toEqual(["B", "D"]);
    expect(collapsedStageKeys([])).toEqual([]);
  });
});

describe("stage", () => {
  const project = useTestProject();
  const keys = async () => (await listStages(project.ctx)).map((stage) => stage.key);

  it("lists the default stages with prompts and positions", async () => {
    const stages = await listStages(project.ctx);
    expect(stages.map(({ key, position, enabled }) => ({ key, position, enabled }))).toEqual([
      { key: "BACKLOG", position: 1, enabled: true },
      { key: "DONE", position: 2, enabled: true },
    ]);
    expect(stages[0]?.prompt).toMatch(/not been started/);
  });

  it("getStage returns an empty prompt when the file is missing", async () => {
    await createStage({ label: "Review" }, project.ctx);
    await updateStage({ key: "REVIEW", prompt: "" }, project.ctx);
    expect((await getStage({ key: "review" }, project.ctx)).prompt).toBe("");
    await expect(getStage({ key: "NOPE" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
  });

  describe("createStage", () => {
    it("adds the stage at the end with a key from the label", async () => {
      const stage = await createStage({ label: "In Progress", prompt: " Work on it " }, project.ctx);
      expect(stage).toEqual({
        key: "IN_PROGRESS",
        label: "In Progress",
        enabled: true,
        prompt: "Work on it",
        position: 3,
      });
      expect(await project.read("stages/IN_PROGRESS.md")).toBe("Work on it\n");
    });

    it("inserts at a position", async () => {
      await createStage({ label: "Review", key: "rev", position: 2, enabled: false }, project.ctx);
      expect(await keys()).toEqual(["BACKLOG", "REV", "DONE"]);
      expect((await getStage({ key: "REV" }, project.ctx)).enabled).toBe(false);
    });

    it("rejects invalid input and duplicates", async () => {
      const error = await createStage({ label: " ", key: "1", position: 9 }, project.ctx).catch((e: unknown) => e);
      expect((error as ValidationError).details.issues).toMatchObject([
        { path: ["label"] },
        { path: ["key"] },
        { path: ["position"] },
      ]);
      await expect(createStage({ label: "Done" }, project.ctx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("updateStage", () => {
    it("changes the label, enabled flag, prompt and position", async () => {
      const stage = await updateStage(
        { key: "DONE", label: "Shipped", enabled: false, prompt: "Ship", position: 1 },
        project.ctx,
      );
      expect(stage).toEqual({ key: "DONE", label: "Shipped", enabled: false, prompt: "Ship", position: 1 });
      expect(await keys()).toEqual(["DONE", "BACKLOG"]);
    });

    it("renames the key, the prompt file and the stories in the stage", async () => {
      await createStory({ title: "T" }, project.ctx);
      await updateStage({ key: "BACKLOG", newKey: "todo" }, project.ctx);
      expect(await keys()).toEqual(["TODO", "DONE"]);
      expect((await readdir(project.paths.stagesDir)).sort()).toEqual(["DONE.md", "TODO.md"]);
      expect((await getStory({ id: "1" }, project.ctx)).stage).toBe("TODO");
      expect((await getStage({ key: "TODO" }, project.ctx)).prompt).toMatch(/not been started/);
    });

    it("moves the story files of the stage to the folder of the new key", async () => {
      await createStory({ title: "One" }, project.ctx);
      await createStory({ title: "Two" }, project.ctx);
      await createStory({ title: "Three", stage: "DONE" }, project.ctx);
      await updateStage({ key: "BACKLOG", newKey: "TODO" }, project.ctx);
      expect(await readdir(project.paths.storiesDir)).toEqual(["DONE", "TODO"]);
      expect(await readdir(join(project.paths.storiesDir, "TODO"))).toEqual(["ROW-01.md", "ROW-02.md"]);
      expect(await readdir(join(project.paths.storiesDir, "DONE"))).toEqual(["ROW-03.md"]);
      expect((await getStory({ id: "2" }, project.ctx)).path).toBe(join(project.paths.storiesDir, "TODO", "ROW-02.md"));
    });

    it("keeps expandedByDefault on a label change, a rename, an enable change and a move", async () => {
      const config = await readConfig(project.paths);
      await writeConfig(project.paths, {
        ...config,
        stages: config.stages.map((s) => (s.key === "BACKLOG" ? { ...s, expandedByDefault: false } : s)),
      });
      await updateStage({ key: "BACKLOG", label: "Ideas" }, project.ctx);
      await updateStage({ key: "BACKLOG", newKey: "IDEAS" }, project.ctx);
      await updateStage({ key: "IDEAS", enabled: false, position: 2 }, project.ctx);
      const stage = await getStage({ key: "IDEAS" }, project.ctx);
      expect(stage).toMatchObject({ key: "IDEAS", label: "Ideas", enabled: false, expandedByDefault: false });
      expect(lookupStage(await readConfig(project.paths), "IDEAS")?.expandedByDefault).toBe(false);
      expect((await getStage({ key: "DONE" }, project.ctx)).expandedByDefault).toBeUndefined();
    });

    it("rejects invalid input and a key that exists", async () => {
      await expect(updateStage({ key: "DONE", label: "" }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      await expect(updateStage({ key: "DONE", position: 3 }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      await expect(updateStage({ key: "DONE", newKey: "BACKLOG" }, project.ctx)).rejects.toBeInstanceOf(ConflictError);
      await expect(updateStage({ key: "NOPE" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("deleteStage", () => {
    it("deletes an empty stage and its file", async () => {
      expect(await deleteStage({ key: "DONE" }, project.ctx)).toEqual({ key: "DONE", movedStories: 0 });
      expect(await keys()).toEqual(["BACKLOG"]);
      expect(await readdir(project.paths.stagesDir)).toEqual(["BACKLOG.md"]);
    });

    it("refuses to delete a stage with stories unless they move", async () => {
      await createStory({ title: "T" }, project.ctx);
      const error = await deleteStage({ key: "BACKLOG" }, project.ctx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details.stories).toEqual(["ROW-01"]);

      expect(await deleteStage({ key: "BACKLOG", moveStoriesTo: "done" }, project.ctx)).toEqual({
        key: "BACKLOG",
        movedStories: 1,
      });
      expect((await getStory({ id: "1" }, project.ctx)).stage).toBe("DONE");
    });

    it("moves the story files to the folder of the target stage", async () => {
      await createStory({ title: "One" }, project.ctx);
      await createStory({ title: "Two", stage: "DONE" }, project.ctx);
      await deleteStage({ key: "BACKLOG", moveStoriesTo: "DONE" }, project.ctx);
      expect(await readdir(project.paths.storiesDir)).toEqual(["DONE"]);
      expect(await readdir(join(project.paths.storiesDir, "DONE"))).toEqual(["ROW-01.md", "ROW-02.md"]);
    });

    it("rejects moving stories to the same or an unknown stage", async () => {
      await expect(deleteStage({ key: "DONE", moveStoriesTo: "DONE" }, project.ctx)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(deleteStage({ key: "DONE", moveStoriesTo: "NOPE" }, project.ctx)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("keeps the last stage", async () => {
      await deleteStage({ key: "DONE" }, project.ctx);
      await expect(deleteStage({ key: "BACKLOG" }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
      expect((await readConfig(project.paths)).stages).toHaveLength(1);
    });
  });

  describe("story times", () => {
    const at = (iso: string) => ({ ...project.ctx, now: () => new Date(iso) });
    const updatedAt = async (id: string) => (await getStory({ id }, project.ctx)).updatedAt;

    it("a rename and a delete set updatedAt only of each story that they move", async () => {
      await createStory({ title: "A", stage: "BACKLOG" }, at("2025-01-01T00:00:00.000Z"));
      await createStory({ title: "B", stage: "DONE" }, at("2025-01-01T00:00:00.000Z"));
      await updateStage({ key: "BACKLOG", newKey: "TODO" }, at("2025-02-02T00:00:00.000Z"));
      expect(await updatedAt("ROW-01")).toBe("2025-02-02T00:00:00.000Z");
      expect(await updatedAt("ROW-02")).toBe("2025-01-01T00:00:00.000Z");
      await deleteStage({ key: "DONE", moveStoriesTo: "TODO" }, at("2025-03-03T00:00:00.000Z"));
      expect(await updatedAt("ROW-01")).toBe("2025-02-02T00:00:00.000Z");
      expect(await updatedAt("ROW-02")).toBe("2025-03-03T00:00:00.000Z");
    });
  });
});
