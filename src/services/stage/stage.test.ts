import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readConfig } from "../config/config.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { createStory, getStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { createStage, deleteStage, findStage, getStage, listStages, updateStage } from "./stage.js";

describe("findStage", () => {
  const config = {
    projectName: "R",
    projectKey: "R",
    customFields: [],
    stages: [{ key: "BACKLOG", label: "Backlog", enabled: true }],
  };

  it("finds a stage in any case and records an issue when it is missing", () => {
    const issues: { path: (string | number)[]; message: string }[] = [];
    expect(findStage(config, " backlog ", ["stage"], issues)?.key).toBe("BACKLOG");
    expect(findStage(config, "NOPE", ["stage"], issues)).toBeUndefined();
    expect(issues).toEqual([{ path: ["stage"], message: 'Unknown stage "NOPE". Stages: BACKLOG' }]);
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
});
