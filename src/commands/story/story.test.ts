import { describe, expect, it } from "vitest";
import { addCustomField } from "../../services/customField/customField.js";
import { getStory } from "../../services/story/story.js";
import { useTestProject } from "../../services/testProject/testProject.js";
import { runCli } from "../testCli/testCli.js";

describe("story commands", () => {
  const project = useTestProject();
  const cli = (...args: string[]) => runCli(args, project.ctx.cwd);

  describe("story create", () => {
    it("creates a story with fields", async () => {
      await addCustomField({ label: "Points", type: "number" }, project.ctx);
      const result = await cli("story", "create", "--title", "First", "--stage", "done", "--field", "points=3");
      expect(result).toEqual({ stdout: "Created ROW-01 in DONE", stderr: "", exitCode: 0 });
      expect(await getStory({ id: "ROW-01" }, project.ctx)).toMatchObject({ stage: "DONE", fields: { points: 3 } });
    });

    it("requires --title", async () => {
      const result = await cli("story", "create");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("required option '--title <title>' not specified");
    });

    it("rejects a --field without a key", async () => {
      const result = await cli("story", "create", "--title", "T", "--field", "points");
      expect(result).toEqual({ stdout: "", stderr: 'Error: --field expects key=value, got "points"', exitCode: 1 });
    });

    it("prints every issue of an invalid story", async () => {
      const result = await cli("story", "create", "--title", " ", "--stage", "NOPE");
      expect(result.exitCode).toBe(1);
      expect(result.stderr.split("\n").filter((line) => line.startsWith("  - "))).toHaveLength(2);
    });
  });

  describe("story update", () => {
    it("updates a story and clears a field with an empty value", async () => {
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await cli("story", "create", "--title", "First", "--field", "owner=sam");
      const result = await cli(
        "story",
        "update",
        "ROW-01",
        "--title",
        "Renamed",
        "--stage",
        "DONE",
        "--field",
        "owner=",
      );
      expect(result.stdout).toBe("Updated ROW-01");
      expect(await getStory({ id: "ROW-01" }, project.ctx)).toMatchObject({
        title: "Renamed",
        stage: "DONE",
        fields: { owner: null },
      });
    });

    it("moves a story to a position in its stage", async () => {
      await cli("story", "create", "--title", "First");
      await cli("story", "create", "--title", "Second");
      expect((await cli("story", "update", "ROW-02", "--position", "1")).stdout).toBe("Updated ROW-02");
      expect((await getStory({ id: "ROW-01" }, project.ctx)).position).toBe(2);
      expect((await cli("story", "update", "ROW-02", "--position", "0")).exitCode).not.toBe(0);
    });

    it("fails for an unknown story", async () => {
      const result = await cli("story", "update", "ROW-09", "--title", "X");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/^Error: /);
    });
  });

  it("story delete deletes a story", async () => {
    await cli("story", "create", "--title", "First");
    expect((await cli("story", "delete", "ROW-01")).stdout).toBe("Deleted ROW-01");
    expect((await cli("story", "get", "ROW-01")).exitCode).toBe(1);
  });

  describe("story get", () => {
    it("shows the stage label, every field and the description", async () => {
      await addCustomField({ label: "Points", type: "number" }, project.ctx);
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await cli("story", "create", "--title", "First", "--description", "Some *text*", "--field", "points=5");
      expect((await cli("story", "get", "ROW-01")).stdout).toBe(
        "ROW-01  First\nStage: Backlog (BACKLOG)\nPoints: 5\nOwner: —\n\nSome *text*",
      );
    });

    it("prints the story as JSON with --json", async () => {
      await cli("story", "create", "--title", "First");
      const result = await cli("--json", "story", "get", "ROW-01");
      expect(JSON.parse(result.stdout)).toMatchObject({ id: "ROW-01", title: "First", stage: "BACKLOG" });
    });
  });

  describe("story search", () => {
    it("lists the stories that match", async () => {
      await cli("story", "create", "--title", "Login page");
      await cli("story", "create", "--title", "Logout", "--stage", "DONE");
      await cli("story", "create", "--title", "Settings");
      expect((await cli("story", "search", "log")).stdout).toBe(
        "ROW-01   BACKLOG        Login page\nROW-02   DONE           Logout",
      );
      expect((await cli("story", "search", "--stage", "DONE")).stdout).toBe("ROW-02   DONE           Logout");
    });

    it("filters by field value", async () => {
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await cli("story", "create", "--title", "A", "--field", "owner=sam");
      await cli("story", "create", "--title", "B", "--field", "owner=kim");
      expect((await cli("story", "search", "--field", "owner=kim")).stdout).toBe("ROW-02   BACKLOG        B");
    });

    it("says when nothing matches", async () => {
      expect((await cli("story", "search", "nothing")).stdout).toBe("No stories found.");
    });
  });

  describe("removed agent locks", () => {
    it.each(["lock", "unlock"])("gives an unknown-command error for story %s", async (name) => {
      await cli("story", "create", "--title", "First");
      const result = await cli("story", name, "ROW-01");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`unknown command '${name}'`);
    });

    it("gives only the Story keys in story get --json", async () => {
      await cli("story", "create", "--title", "First");
      const story = JSON.parse((await cli("story", "get", "ROW-01", "--json")).stdout);
      expect(Object.keys(story).sort()).toEqual([
        "attachmentCount",
        "description",
        "fields",
        "id",
        "number",
        "path",
        "position",
        "stage",
        "title",
      ]);
    });
  });
});
