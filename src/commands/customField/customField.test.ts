import { describe, expect, it } from "vitest";
import { listCustomFields } from "../../services/customField/customField.js";
import { getStory } from "../../services/story/story.js";
import { useTestProject } from "../../services/testProject/testProject.js";
import { runCli } from "../testCli/testCli.js";

describe("custom field commands", () => {
  const project = useTestProject();
  const cli = (...args: string[]) => runCli(args, project.ctx.cwd);

  describe("add-custom-field", () => {
    it("adds a field with a key from the label", async () => {
      const result = await cli("add-custom-field", "--label", "Story Points", "--type", "number");
      expect(result).toEqual({
        stdout: "Added custom field story_points (Story Points, number)",
        stderr: "",
        exitCode: 0,
      });
    });

    it("adds a select field with its options and a custom key", async () => {
      const result = await cli(
        "add-custom-field",
        ...["--label", "Priority", "--type", "select", "--key", "prio", "--option", "low", "--option", "high"],
      );
      expect(result.stdout).toBe("Added custom field prio (Priority, select [low, high])");
      expect(await listCustomFields(project.ctx)).toEqual([
        { key: "prio", label: "Priority", type: "select", options: ["low", "high"] },
      ]);
    });

    it("rejects an unknown type", async () => {
      const result = await cli("add-custom-field", "--label", "X", "--type", "color");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Expected one of string, number, boolean, url, date, select.");
    });
  });

  describe("update-custom-field", () => {
    it("renames a field in every story", async () => {
      await cli("add-custom-field", "--label", "Points", "--type", "string");
      await cli("create-story", "--title", "A", "--field", "points=3");
      const result = await cli(
        "update-custom-field",
        "points",
        "--rename",
        "size",
        "--label",
        "Size",
        "--type",
        "number",
      );
      expect(result.stdout).toBe("Updated custom field size (Size, number)");
      expect((await getStory({ id: "ROW-01" }, project.ctx)).fields).toEqual({ size: 3 });
    });

    it("fails for an unknown field", async () => {
      const result = await cli("update-custom-field", "nope", "--label", "X");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/^Error: /);
    });
  });

  it("remove-custom-field removes a field from every story", async () => {
    await cli("add-custom-field", "--label", "Points", "--type", "number");
    await cli("create-story", "--title", "A", "--field", "points=3");
    expect((await cli("remove-custom-field", "points")).stdout).toBe("Removed custom field points");
    expect(await listCustomFields(project.ctx)).toEqual([]);
    expect((await getStory({ id: "ROW-01" }, project.ctx)).fields).toEqual({});
  });
});
