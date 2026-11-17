import { describe, expect, it } from "vitest";
import { addCustomField } from "../../services/custom-field/custom-field.js";
import { createStory, getStory } from "../../services/story/story.js";
import { addTag } from "../../services/tag/tag.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { runCli } from "../test-cli/test-cli.js";

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

    it("has no --position option", async () => {
      await cli("story", "create", "--title", "First");
      const result = await cli("story", "update", "ROW-01", "--position", "2");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("unknown option '--position'");
      const help = await cli("story", "update", "--help");
      expect(help.stdout).toContain("--stage");
      expect(help.stdout).not.toContain("--position");
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

  it("story delete prints a warning for each downstream story", async () => {
    await createStory({ title: "Upstream" }, project.ctx);
    await createStory({ title: "Downstream", dependsOn: ["ROW-01"] }, project.ctx);
    expect((await cli("story", "delete", "ROW-01")).stdout).toBe(
      "Deleted ROW-01\nRemoved the dependency on ROW-01 from ROW-02",
    );
    await createStory({ title: "Again" }, project.ctx);
    const json = JSON.parse((await cli("story", "delete", "ROW-03", "--json")).stdout);
    expect(json).toEqual({ id: "ROW-03", warnings: [] });
  });

  describe("story get", () => {
    it("shows the stage label, every field and the description", async () => {
      await addCustomField({ label: "Points", type: "number" }, project.ctx);
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await cli("story", "create", "--title", "First", "--description", "Some *text*", "--field", "points=5");
      const { createdAt } = await getStory({ id: "ROW-01" }, project.ctx);
      expect((await cli("story", "get", "ROW-01")).stdout).toBe(
        `ROW-01  First\nStage: Backlog (BACKLOG)\nDepends on: none\nBlocks: none\nBlocked: no\nTags: none\nCreated: ${createdAt}\nUpdated: ${createdAt}\nPoints: 5\nOwner: —\n\nSome *text*`,
      );
    });

    it("shows — for a Story without times", async () => {
      await project.write("stories/ROW-01.md", "---\ntitle: Old\nstage: BACKLOG\n---\n");
      expect((await cli("story", "get", "ROW-01")).stdout).toContain("Created: —\nUpdated: —");
      expect(JSON.parse((await cli("story", "get", "ROW-01", "--json")).stdout)).toMatchObject({
        createdAt: null,
        updatedAt: null,
      });
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

  describe("story dependencies", () => {
    async function seed(count: number): Promise<void> {
      for (let i = 1; i <= count; i++) {
        await createStory({ title: `S${i}` }, project.ctx);
      }
    }

    const dependsOn = async (id: string) => (await getStory({ id }, project.ctx)).dependsOn;

    it("saves --depends-on in order on create", async () => {
      await seed(2);
      const result = await cli("story", "create", "--title", "X", "--depends-on", "ROW-02,ROW-01");
      expect(result.exitCode).toBe(0);
      expect(await dependsOn("ROW-03")).toEqual(["ROW-02", "ROW-01"]);
    });

    it("gives the same list for repeated flags and ignores spaces around a comma", async () => {
      await seed(3);
      await cli("story", "create", "--title", "X", "--depends-on", "ROW-01", "--depends-on", "ROW-02");
      await cli("story", "create", "--title", "Y", "--depends-on", " ROW-01 , ROW-02 ");
      expect(await dependsOn("ROW-04")).toEqual(["ROW-01", "ROW-02"]);
      expect(await dependsOn("ROW-05")).toEqual(["ROW-01", "ROW-02"]);
      expect(
        (await cli("story", "update", "ROW-01", "--depends-on", "ROW-03", "--depends-on", "ROW-02")).exitCode,
      ).toBe(0);
      expect(await dependsOn("ROW-01")).toEqual(["ROW-03", "ROW-02"]);
    });

    it("adds and removes one item with repeatable flags", async () => {
      await seed(4);
      await cli("story", "update", "ROW-04", "--depends-on", "ROW-01");
      await cli("story", "update", "ROW-04", "--add-dependency", "ROW-02", "--add-dependency", "ROW-03");
      expect(await dependsOn("ROW-04")).toEqual(["ROW-01", "ROW-02", "ROW-03"]);
      await cli("story", "update", "ROW-04", "--remove-dependency", "ROW-01", "--remove-dependency", "ROW-03");
      expect(await dependsOn("ROW-04")).toEqual(["ROW-02"]);
      const same = await cli(
        "story",
        "update",
        "ROW-04",
        "--add-dependency",
        "ROW-02",
        "--remove-dependency",
        "ROW-01",
      );
      expect(same.exitCode).toBe(0);
      expect(await dependsOn("ROW-04")).toEqual(["ROW-02"]);
    });

    it.each(["--add-dependency", "--remove-dependency"])("refuses --depends-on with %s", async (flag) => {
      await seed(2);
      const result = await cli("story", "update", "ROW-02", "--depends-on", "ROW-01", flag, "ROW-01");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("cannot be used with option");
      expect(await dependsOn("ROW-02")).toEqual([]);
    });

    it('removes the dependsOn key with --depends-on ""', async () => {
      await seed(1);
      await cli("story", "create", "--title", "Two", "--depends-on", "ROW-01");
      expect((await cli("story", "update", "ROW-02", "--depends-on", "")).exitCode).toBe(0);
      expect((await project.read("stories/BACKLOG/ROW-02.md")).replace(/^(uid|createdAt|updatedAt): .*\n/gm, "")).toBe(
        "---\ntitle: Two\nstage: BACKLOG\n---\n\n",
      );
    });

    it("gives exit 1 and the details of a cycle or an unknown ID, and changes no file", async () => {
      await seed(2);
      await cli("story", "update", "ROW-01", "--depends-on", "ROW-02");
      const before = await Promise.all(["ROW-01", "ROW-02"].map((id) => project.read(`stories/BACKLOG/${id}.md`)));
      const cycle = await cli("--json", "story", "update", "ROW-02", "--add-dependency", "ROW-01");
      expect(cycle.exitCode).toBe(1);
      expect(JSON.parse(cycle.stderr).error).toMatchObject({
        code: "VALIDATION",
        message: expect.stringContaining("ROW-02 → ROW-01 → ROW-02"),
        details: { cycle: ["ROW-02", "ROW-01", "ROW-02"] },
      });
      const unknown = await cli("--json", "story", "update", "ROW-02", "--depends-on", "ROW-09");
      expect(unknown.exitCode).toBe(1);
      expect(JSON.parse(unknown.stderr).error.details).toMatchObject({ unknown: ["ROW-09"] });
      expect(await Promise.all(["ROW-01", "ROW-02"].map((id) => project.read(`stories/BACKLOG/${id}.md`)))).toEqual(
        before,
      );
    });

    it("shows the dependency state in story get", async () => {
      const ctx = { ...project.ctx, now: () => new Date("2025-01-02T03:04:05.678Z") };
      await createStory({ title: "Done", stage: "DONE" }, ctx);
      await createStory({ title: "Open" }, ctx);
      await createStory({ title: "Down", dependsOn: ["ROW-01", "ROW-02"] }, ctx);
      expect((await cli("story", "get", "ROW-03")).stdout).toBe(
        "ROW-03  Down\nStage: Backlog (BACKLOG)\nDepends on: ROW-01, ROW-02\nBlocks: none\nBlocked: yes (ROW-02)\nTags: none\nCreated: 2025-01-02T03:04:05.678Z\nUpdated: 2025-01-02T03:04:05.678Z",
      );
      expect((await cli("story", "get", "ROW-01")).stdout).toContain("Depends on: none\nBlocks: ROW-03\nBlocked: no");
      const json = JSON.parse((await cli("--json", "story", "get", "ROW-03")).stdout);
      expect(json).toMatchObject({ dependsOn: ["ROW-01", "ROW-02"], blocks: [], waitingFor: ["ROW-02"] });
    });

    it("filters story search with --blocked or --ready", async () => {
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await createStory({ title: "Open upstream", fields: { owner: "sam" } }, project.ctx);
      await createStory({ title: "Blocked one", dependsOn: ["ROW-01"], fields: { owner: "sam" } }, project.ctx);
      await createStory({ title: "Ready one", stage: "DONE" }, project.ctx);
      expect((await cli("story", "search", "--blocked")).stdout).toBe("ROW-02   BACKLOG        Blocked one");
      expect((await cli("story", "search", "--ready", "--stage", "DONE")).stdout).toBe(
        "ROW-03   DONE           Ready one",
      );
      expect((await cli("story", "search", "one", "--ready")).stdout).toBe("ROW-03   DONE           Ready one");
      expect((await cli("story", "search", "--ready", "--field", "owner=sam")).stdout).toBe(
        "ROW-01   BACKLOG        Open upstream",
      );
      const both = await cli("story", "search", "--blocked", "--ready");
      expect(both.exitCode).toBe(1);
      expect(both.stderr).toContain("cannot be used with option");
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
        "blocks",
        "createdAt",
        "dependsOn",
        "description",
        "fields",
        "id",
        "number",
        "path",
        "position",
        "stage",
        "tags",
        "title",
        "uid",
        "updatedAt",
        "waitingFor",
      ]);
    });
  });

  describe("story tags", () => {
    const addTags = async () => {
      await addTag({ label: "Front end", value: "frontend" }, project.ctx);
      await addTag({ label: "Back end", value: "backend" }, project.ctx);
      await addTag({ label: "Docs", value: "docs" }, project.ctx);
    };

    it("story create --tag saves each value one time", async () => {
      await addTags();
      const result = await cli(
        "story",
        "create",
        "--title",
        "A",
        "--tag",
        "frontend",
        "--tag",
        "backend",
        "--tag",
        "frontend",
      );
      expect(result.exitCode).toBe(0);
      expect((await getStory({ id: "ROW-01" }, project.ctx)).tags).toEqual(["frontend", "backend"]);
      expect(await project.read("stories/BACKLOG/ROW-01.md")).toContain("tags:\n  - frontend\n  - backend\n");
    });

    it("story update --tag replaces the list, and --add-tag and --remove-tag change it", async () => {
      await addTags();
      await cli("story", "create", "--title", "A", "--tag", "frontend");
      await cli("story", "update", "ROW-01", "--tag", "docs", "--tag", "backend");
      expect((await getStory({ id: "ROW-01" }, project.ctx)).tags).toEqual(["docs", "backend"]);
      await cli("story", "update", "ROW-01", "--add-tag", "frontend", "--remove-tag", "docs");
      expect((await getStory({ id: "ROW-01" }, project.ctx)).tags).toEqual(["backend", "frontend"]);
      await cli("story", "update", "ROW-01", "--tag", "");
      expect(await project.read("stories/BACKLOG/ROW-01.md")).not.toContain("tags");
    });

    it("fails with a validation error for an unknown value or --tag with --add-tag or --remove-tag", async () => {
      await addTags();
      await cli("story", "create", "--title", "A");
      for (const args of [
        ["story", "create", "--title", "B", "--tag", "nope"],
        ["story", "update", "ROW-01", "--add-tag", "nope"],
        ["story", "update", "ROW-01", "--tag", "docs", "--add-tag", "backend"],
        ["story", "update", "ROW-01", "--tag", "docs", "--remove-tag", "backend"],
      ]) {
        const result = await cli("--json", ...args);
        expect(result.exitCode).toBe(1);
        expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
      }
      expect((await getStory({ id: "ROW-01" }, project.ctx)).tags).toEqual([]);
    });

    it("story get shows the tags, and --json gives the list", async () => {
      await addTags();
      await cli("story", "create", "--title", "A", "--tag", "docs");
      await cli("story", "create", "--title", "B");
      expect((await cli("story", "get", "ROW-01")).stdout).toContain("\nTags: docs\n");
      expect(JSON.parse((await cli("--json", "story", "get", "ROW-01")).stdout).tags).toEqual(["docs"]);
      expect(JSON.parse((await cli("--json", "story", "get", "ROW-02")).stdout).tags).toEqual([]);
    });

    it("story search --tag gives only the stories that have all of the tags", async () => {
      await addTags();
      await cli("story", "create", "--title", "A", "--tag", "frontend");
      await cli("story", "create", "--title", "B", "--tag", "frontend", "--tag", "backend");
      await cli("story", "create", "--title", "C");
      const search = async (...args: string[]) =>
        JSON.parse((await cli("--json", "story", "search", ...args)).stdout)
          .map((story: { id: string }) => story.id)
          .sort();
      expect(await search("--tag", "frontend")).toEqual(["ROW-01", "ROW-02"]);
      expect(await search("--tag", "frontend", "--tag", "backend")).toEqual(["ROW-02"]);
    });
  });
});
