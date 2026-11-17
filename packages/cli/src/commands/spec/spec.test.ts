import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { updateProject } from "../../services/project/project.js";
import { getSpec } from "../../services/spec/spec.js";
import { createStory } from "../../services/story/story.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { runCli } from "../test-cli/test-cli.js";

describe("spec commands", () => {
  const project = useTestProject();
  const cli = (...args: string[]) => runCli(args, project.ctx.cwd);

  beforeEach(async () => {
    await updateProject({ features: { specs: true } }, project.ctx);
    await createStory({ title: "Login" }, project.ctx);
    await createStory({ title: "Logout" }, project.ctx);
  });

  it("creates a spec with a body from a file, shows it and lists it", async () => {
    await writeFile(join(project.ctx.cwd as string, "scope.md"), "## Scope\n\nSSO only.\n");
    const created = await cli(
      "spec",
      "create",
      "--title",
      "Login page",
      "--story",
      "ROW-01",
      "--body-file",
      "scope.md",
    );
    expect(created).toEqual({ stdout: "Created spec login-page for ROW-01", stderr: "", exitCode: 0 });
    expect((await cli("spec", "get", "login-page")).stdout).toBe(
      "login-page  Login page\nStories: ROW-01\n\n## Scope\n\nSSO only.",
    );
    expect((await cli("spec", "list", "--story", "ROW-02")).stdout).toBe("No specs found.");
    expect((await cli("spec", "list")).stdout).toMatch(/^login-page +ROW-01 +Login page$/);
    const json = JSON.parse((await cli("--json", "spec", "list", "--story", "ROW-01")).stdout);
    expect(json).toMatchObject([{ slug: "login-page", title: "Login page", stories: ["ROW-01"] }]);
  });

  it("updates, links, unlinks and deletes a spec", async () => {
    await cli("spec", "create", "--title", "Design", "--story", "ROW-01", "--body", "Old");
    expect((await cli("spec", "update", "design", "--title", "New", "--body", "Body")).stdout).toBe(
      "Updated spec design",
    );
    expect((await cli("spec", "link", "design", "ROW-02")).stdout).toBe("Linked spec design to ROW-01, ROW-02");
    expect((await cli("spec", "unlink", "design", "ROW-01")).stdout).toBe(
      "Unlinked spec design; it stays linked to ROW-02",
    );
    expect(await getSpec({ slug: "design" }, project.ctx)).toMatchObject({
      title: "New",
      body: "Body",
      stories: ["ROW-02"],
    });
    const last = await cli("spec", "unlink", "design", "ROW-02");
    expect(last.exitCode).toBe(1);
    expect(last.stderr).toContain("Hint: Link it to another Story first, or run `rowbly spec delete design`.");
    expect((await cli("spec", "delete", "design")).stdout).toBe("Deleted spec design");
    expect((await cli("spec", "get", "design")).exitCode).toBe(1);
  });

  it("needs a story and refuses --body with --body-file", async () => {
    expect((await cli("spec", "create", "--title", "T")).stderr).toContain("required option '--story <id>'");
    const both = await cli("spec", "create", "--title", "T", "--story", "1", "--body", "x", "--body-file", "y");
    expect(both).toEqual({ stdout: "", stderr: "Error: Use --body or --body-file, not both", exitCode: 1 });
  });

  it("tells how to turn specs on", async () => {
    await updateProject({ features: { specs: false } }, project.ctx);
    const result = await cli("spec", "list");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Hint: Run `rowbly project update --specs on`");
  });
});
