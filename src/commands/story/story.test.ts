import { describe, expect, it } from "vitest";
import { addCustomField } from "../../services/customField/customField.js";
import { getStory } from "../../services/story/story.js";
import { useTestProject } from "../../services/testProject/testProject.js";
import { runCli } from "../testCli/testCli.js";

describe("story commands", () => {
  const project = useTestProject();
  const cli = (...args: string[]) => runCli(args, project.ctx.cwd);

  describe("create-story", () => {
    it("creates a story with fields", async () => {
      await addCustomField({ label: "Points", type: "number" }, project.ctx);
      const result = await cli("create-story", "--title", "First", "--stage", "done", "--field", "points=3");
      expect(result).toEqual({ stdout: "Created ROW-01 in DONE", stderr: "", exitCode: 0 });
      expect(await getStory({ id: "ROW-01" }, project.ctx)).toMatchObject({ stage: "DONE", fields: { points: 3 } });
    });

    it("requires --title", async () => {
      const result = await cli("create-story");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("required option '--title <title>' not specified");
    });

    it("rejects a --field without a key", async () => {
      const result = await cli("create-story", "--title", "T", "--field", "points");
      expect(result).toEqual({ stdout: "", stderr: 'Error: --field expects key=value, got "points"', exitCode: 1 });
    });

    it("prints every issue of an invalid story", async () => {
      const result = await cli("create-story", "--title", " ", "--stage", "NOPE");
      expect(result.exitCode).toBe(1);
      expect(result.stderr.split("\n").filter((line) => line.startsWith("  - "))).toHaveLength(2);
    });
  });

  describe("update-story", () => {
    it("updates a story and clears a field with an empty value", async () => {
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await cli("create-story", "--title", "First", "--field", "owner=sam");
      const result = await cli("update-story", "ROW-01", "--title", "Renamed", "--stage", "DONE", "--field", "owner=");
      expect(result.stdout).toBe("Updated ROW-01");
      expect(await getStory({ id: "ROW-01" }, project.ctx)).toMatchObject({
        title: "Renamed",
        stage: "DONE",
        fields: { owner: null },
      });
    });

    it("moves a story to a position in its stage", async () => {
      await cli("create-story", "--title", "First");
      await cli("create-story", "--title", "Second");
      expect((await cli("update-story", "ROW-02", "--position", "1")).stdout).toBe("Updated ROW-02");
      expect((await getStory({ id: "ROW-01" }, project.ctx)).position).toBe(2);
      expect((await cli("update-story", "ROW-02", "--position", "0")).exitCode).not.toBe(0);
    });

    it("fails for an unknown story", async () => {
      const result = await cli("update-story", "ROW-09", "--title", "X");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/^Error: /);
    });
  });

  it("delete-story deletes a story", async () => {
    await cli("create-story", "--title", "First");
    expect((await cli("delete-story", "ROW-01")).stdout).toBe("Deleted ROW-01");
    expect((await cli("get-story", "ROW-01")).exitCode).toBe(1);
  });

  describe("get-story", () => {
    it("shows the stage label, every field and the description", async () => {
      await addCustomField({ label: "Points", type: "number" }, project.ctx);
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await cli("create-story", "--title", "First", "--description", "Some *text*", "--field", "points=5");
      expect((await cli("get-story", "ROW-01")).stdout).toBe(
        "ROW-01  First\nStage: Backlog (BACKLOG)\nPoints: 5\nOwner: —\n\nSome *text*",
      );
    });

    it("prints the story as JSON with --json", async () => {
      await cli("create-story", "--title", "First");
      const result = await cli("--json", "get-story", "ROW-01");
      expect(JSON.parse(result.stdout)).toMatchObject({ id: "ROW-01", title: "First", stage: "BACKLOG" });
    });
  });

  describe("search-stories", () => {
    it("lists the stories that match", async () => {
      await cli("create-story", "--title", "Login page");
      await cli("create-story", "--title", "Logout", "--stage", "DONE");
      await cli("create-story", "--title", "Settings");
      expect((await cli("search-stories", "log")).stdout).toBe(
        "ROW-01   BACKLOG        Login page\nROW-02   DONE           Logout",
      );
      expect((await cli("search-stories", "--stage", "DONE")).stdout).toBe("ROW-02   DONE           Logout");
    });

    it("filters by field value", async () => {
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await cli("create-story", "--title", "A", "--field", "owner=sam");
      await cli("create-story", "--title", "B", "--field", "owner=kim");
      expect((await cli("search-stories", "--field", "owner=kim")).stdout).toBe("ROW-02   BACKLOG        B");
    });

    it("says when nothing matches", async () => {
      expect((await cli("search-stories", "nothing")).stdout).toBe("No stories found.");
    });
  });
});
