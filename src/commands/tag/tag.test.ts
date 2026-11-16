import { describe, expect, it } from "vitest";
import { getStory } from "../../services/story/story.js";
import { listTags } from "../../services/tag/tag.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { runCli } from "../test-cli/test-cli.js";

describe("tag commands", () => {
  const project = useTestProject();
  const cli = (...args: string[]) => runCli(args, project.ctx.cwd);

  it("tag add adds a tag to the config", async () => {
    const result = await cli("tag", "add", "--label", "Front end", "--value", "frontend");
    expect(result).toEqual({ stdout: "Added tag frontend (Front end)", stderr: "", exitCode: 0 });
    expect(JSON.parse(await project.read("rowbly.config.json")).tags).toEqual([
      { value: "frontend", label: "Front end" },
    ]);
  });

  it("tag add fails for a value that exists, an empty label or a bad value", async () => {
    await cli("tag", "add", "--label", "Docs", "--value", "docs");
    const conflict = await cli("--json", "tag", "add", "--label", "Other", "--value", "docs");
    expect(conflict.exitCode).toBe(1);
    expect(JSON.parse(conflict.stderr).error.code).toBe("CONFLICT");
    const invalid = await cli("--json", "tag", "add", "--label", "", "--value", "Bad Value");
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stderr).error.code).toBe("VALIDATION");
    expect(await listTags(project.ctx)).toEqual([{ value: "docs", label: "Docs" }]);
  });

  it("tag list shows the tags in config order, and --json gives value and label", async () => {
    expect((await cli("tag", "list")).stdout).toBe("No tags.");
    await cli("tag", "add", "--label", "Front end", "--value", "frontend");
    await cli("tag", "add", "--label", "Back end", "--value", "backend");
    expect((await cli("tag", "list")).stdout).toBe("frontend (Front end)\nbackend (Back end)");
    expect(JSON.parse((await cli("--json", "tag", "list")).stdout)).toEqual([
      { value: "frontend", label: "Front end" },
      { value: "backend", label: "Back end" },
    ]);
  });

  it("tag update changes only the label, and has no option for the value", async () => {
    await cli("tag", "add", "--label", "Docs", "--value", "docs");
    await cli("story", "create", "--title", "A", "--tag", "docs");
    const before = await project.read("stories/BACKLOG/ROW-01.md");
    expect((await cli("tag", "update", "docs", "--label", "Documentation")).stdout).toBe(
      "Updated tag docs (Documentation)",
    );
    expect(await listTags(project.ctx)).toEqual([{ value: "docs", label: "Documentation" }]);
    expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(before);
    const rename = await cli("tag", "update", "docs", "--label", "X", "--value", "other");
    expect(rename.exitCode).toBe(1);
    expect(rename.stderr).toContain("unknown option '--value'");
  });

  it("tag remove removes the tag from the config and from each story", async () => {
    await cli("tag", "add", "--label", "Docs", "--value", "docs");
    await cli("story", "create", "--title", "A", "--tag", "docs");
    expect((await cli("tag", "remove", "docs")).stdout).toBe("Removed tag docs");
    expect(await listTags(project.ctx)).toEqual([]);
    expect((await getStory({ id: "ROW-01" }, project.ctx)).tags).toEqual([]);
  });

  it("tag update and tag remove fail for an unknown value with the list of values", async () => {
    await cli("tag", "add", "--label", "Docs", "--value", "docs");
    for (const args of [
      ["tag", "update", "nope", "--label", "X"],
      ["tag", "remove", "nope"],
    ]) {
      const result = await cli("--json", ...args);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error).toMatchObject({
        code: "NOT_FOUND",
        message: 'Tag "nope" not found. Tags: docs',
      });
    }
  });
});
