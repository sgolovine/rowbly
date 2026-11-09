import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { updateProject } from "../../services/project/project.js";
import { getSpec } from "../../services/spec/spec.js";
import { createStory } from "../../services/story/story.js";
import { useTestProject } from "../../services/testProject/testProject.js";
import { runCli } from "../testCli/testCli.js";

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
    const created = await cli("create-spec", "--title", "Login page", "--story", "ROW-01", "--body-file", "scope.md");
    expect(created).toEqual({ stdout: "Created spec login-page for ROW-01", stderr: "", exitCode: 0 });
    expect((await cli("get-spec", "login-page")).stdout).toBe(
      "login-page  Login page\nStories: ROW-01\n\n## Scope\n\nSSO only.",
    );
    expect((await cli("list-specs", "--story", "ROW-02")).stdout).toBe("No specs found.");
    expect((await cli("list-specs")).stdout).toMatch(/^login-page +ROW-01 +Login page$/);
    const json = JSON.parse((await cli("--json", "list-specs", "--story", "ROW-01")).stdout);
    expect(json).toMatchObject([{ slug: "login-page", title: "Login page", stories: ["ROW-01"] }]);
  });

  it("updates, links, unlinks and deletes a spec", async () => {
    await cli("create-spec", "--title", "Design", "--story", "ROW-01", "--body", "Old");
    expect((await cli("update-spec", "design", "--title", "New", "--body", "Body")).stdout).toBe("Updated spec design");
    expect((await cli("link-spec", "design", "ROW-02")).stdout).toBe("Linked spec design to ROW-01, ROW-02");
    expect((await cli("unlink-spec", "design", "ROW-01")).stdout).toBe(
      "Unlinked spec design; it stays linked to ROW-02",
    );
    expect(await getSpec({ slug: "design" }, project.ctx)).toMatchObject({
      title: "New",
      body: "Body",
      stories: ["ROW-02"],
    });
    const last = await cli("unlink-spec", "design", "ROW-02");
    expect(last.exitCode).toBe(1);
    expect(last.stderr).toContain("Hint: Link it to another Story first, or run `rowbly delete-spec design`.");
    expect((await cli("delete-spec", "design")).stdout).toBe("Deleted spec design");
    expect((await cli("get-spec", "design")).exitCode).toBe(1);
  });

  it("needs a story and refuses --body with --body-file", async () => {
    expect((await cli("create-spec", "--title", "T")).stderr).toContain("required option '--story <id>'");
    const both = await cli("create-spec", "--title", "T", "--story", "1", "--body", "x", "--body-file", "y");
    expect(both).toEqual({ stdout: "", stderr: "Error: Use --body or --body-file, not both", exitCode: 1 });
  });

  it("tells how to turn specs on", async () => {
    await updateProject({ features: { specs: false } }, project.ctx);
    const result = await cli("list-specs");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Hint: Run `rowbly update-project --specs on`");
  });
});
