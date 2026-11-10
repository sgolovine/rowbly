import { describe, expect, it } from "vitest";
import { getStage, listStages } from "../../services/stage/stage.js";
import { getStory } from "../../services/story/story.js";
import { useTestProject } from "../../services/testProject/testProject.js";
import { runCli } from "../testCli/testCli.js";

describe("stage commands", () => {
  const project = useTestProject();
  const cli = (...args: string[]) => runCli(args, project.ctx.cwd);
  const stageKeys = async () => (await listStages(project.ctx)).map((stage) => stage.key);

  describe("stage create", () => {
    it("creates a stage at the end by default", async () => {
      const result = await cli("stage", "create", "--label", "In Progress", "--prompt", "Work on it");
      expect(result).toEqual({ stdout: "Created stage IN_PROGRESS at position 3", stderr: "", exitCode: 0 });
      expect(await getStage({ key: "IN_PROGRESS" }, project.ctx)).toMatchObject({
        enabled: true,
        prompt: "Work on it",
      });
    });

    it("uses --key, --position and --disable", async () => {
      const result = await cli("stage", "create", "--label", "Review", "--key", "QA", "--position", "2", "--disable");
      expect(result.stdout).toBe("Created stage QA at position 2");
      expect(await stageKeys()).toEqual(["BACKLOG", "QA", "DONE"]);
      expect((await getStage({ key: "QA" }, project.ctx)).enabled).toBe(false);
    });

    it("rejects a position that is not a whole number from 1", async () => {
      const result = await cli("stage", "create", "--label", "X", "--position", "0");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Expected a position");
    });
  });

  describe("stage update", () => {
    it("renames a stage and moves its stories", async () => {
      await cli("story", "create", "--title", "First");
      const result = await cli("stage", "update", "BACKLOG", "--rename", "TODO", "--label", "To do", "--position", "2");
      expect(result.stdout).toBe("Updated stage TODO");
      expect(await stageKeys()).toEqual(["DONE", "TODO"]);
      expect((await getStory({ id: "ROW-01" }, project.ctx)).stage).toBe("TODO");
    });

    it("enables and disables a stage", async () => {
      await cli("stage", "update", "DONE", "--disable");
      expect((await getStage({ key: "DONE" }, project.ctx)).enabled).toBe(false);
      await cli("stage", "update", "DONE", "--enable");
      expect((await getStage({ key: "DONE" }, project.ctx)).enabled).toBe(true);
    });

    it("ignores --enable together with --disable", async () => {
      await cli("stage", "update", "DONE", "--enable", "--disable");
      expect((await getStage({ key: "DONE" }, project.ctx)).enabled).toBe(true);
    });

    it("fails for an unknown stage", async () => {
      const result = await cli("stage", "update", "NOPE", "--label", "X");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/^Error: /);
    });
  });

  describe("stage delete", () => {
    it("deletes an empty stage", async () => {
      await cli("stage", "create", "--label", "Review");
      expect((await cli("stage", "delete", "REVIEW")).stdout).toBe("Deleted stage REVIEW");
      expect(await stageKeys()).toEqual(["BACKLOG", "DONE"]);
    });

    it("moves the stories with --move-to", async () => {
      await cli("story", "create", "--title", "A");
      await cli("story", "create", "--title", "B");
      expect((await cli("stage", "delete", "BACKLOG", "--move-to", "DONE")).stdout).toBe(
        "Deleted stage BACKLOG; moved 2 stories",
      );
      expect((await getStory({ id: "ROW-02" }, project.ctx)).stage).toBe("DONE");
    });

    it("fails for a stage with stories and no --move-to", async () => {
      await cli("story", "create", "--title", "A");
      const result = await cli("stage", "delete", "BACKLOG");
      expect(result.exitCode).toBe(1);
      expect(await stageKeys()).toEqual(["BACKLOG", "DONE"]);
    });
  });

  describe("stage get", () => {
    it("shows a stage and its prompt", async () => {
      expect((await cli("stage", "get", "DONE")).stdout).toBe(
        "DONE  Done\nPosition: 2\nEnabled: yes\n\nThis story is complete. No further work is needed.",
      );
    });

    it("says when a stage has no prompt", async () => {
      await cli("stage", "create", "--label", "Review", "--disable");
      expect((await cli("stage", "get", "REVIEW")).stdout).toBe(
        "REVIEW  Review\nPosition: 3\nEnabled: no\n\n(no prompt)",
      );
    });
  });
});
