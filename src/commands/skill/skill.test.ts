import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pathExists } from "../../services/files/files.js";
import { useTestProject } from "../../services/testProject/testProject.js";
import { runCli } from "../testCli/testCli.js";

describe("skill commands", () => {
  const project = useTestProject();
  const at = (path: string) => join(project.paths.root, path);
  const cli = (...args: string[]) => runCli(args, project.ctx.cwd);

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("installs a bundled skill for each harness", async () => {
    const result = await cli("skill", "install", "develop", "--harness", "claude-code", "--harness", "cursor");
    expect(result).toEqual({
      stdout: [
        `Installed develop for claude-code: ${at(".claude/skills/develop")}`,
        `Installed develop for cursor: ${at(".cursor/skills/develop")}`,
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
    expect(await pathExists(at(".claude/skills/develop/SKILL.md"))).toBe(true);
    expect(await readFile(at(".cursor/skills/develop/references/rowbly_reference.md"), "utf8")).toContain("rowbly");
    expect(JSON.parse(await project.read("rowbly.config.json")).skills).toEqual([
      { name: "develop", harnesses: ["claude-code", "cursor"] },
    ]);
  });

  it("copies the scripts of a skill", async () => {
    expect((await cli("skill", "install", "factory", "--harness", "codex")).exitCode).toBe(0);
    expect(await pathExists(at(".agents/skills/factory/scripts/watch-stages.mjs"))).toBe(true);
  });

  it("says when a skill is already installed", async () => {
    await cli("skill", "install", "review", "--harness", "codex");
    expect((await cli("skill", "install", "review", "--harness", "codex")).stdout).toBe(
      `review is already installed for codex: ${at(".agents/skills/review")}`,
    );
  });

  it("requires --harness on skill install", async () => {
    const result = await cli("skill", "install", "review");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--harness <id>");
  });

  it("gives the bundled names for an unknown skill", async () => {
    expect(await cli("skill", "install", "../x", "--harness", "codex")).toEqual({
      stdout: "",
      stderr: 'Error: Unknown skill "../x"\nHint: Bundled skills: develop, factory, refine, review',
      exitCode: 1,
    });
  });

  it("rejects the shared reference file", async () => {
    expect((await cli("skill", "install", "rowbly_reference.md", "--harness", "codex")).exitCode).toBe(1);
    expect(await pathExists(at(".agents"))).toBe(false);
  });

  it("prints a typed error as JSON for a bad harness", async () => {
    const result = await cli("--json", "skill", "install", "review", "--harness", "vim");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "VALIDATION", message: "Unknown harness: vim" },
    });
  });

  it("lists the installed skills, as text and as JSON", async () => {
    expect((await cli("skill", "list")).stdout).toBe("No skills installed.");
    await cli("skill", "install", "review", "--harness", "codex", "--harness", "cursor");
    await cli("skill", "remove", "review", "--harness", "cursor");
    expect((await cli("skill", "list")).stdout).toBe("review  codex");

    const json = await cli("--json", "skill", "list");
    expect(JSON.parse(json.stdout)).toEqual([
      {
        name: "review",
        harnesses: [{ harness: "codex", path: at(".agents/skills/review"), installed: true }],
      },
    ]);
  });

  it("marks a harness whose copy is missing", async () => {
    await cli("skill", "install", "review", "--harness", "codex");
    await rm(at(".agents/skills/review"), { recursive: true });
    expect((await cli("skill", "list")).stdout).toBe("review  codex (missing)");
  });

  it("removes a skill", async () => {
    await cli("skill", "install", "review", "--harness", "codex");
    expect((await cli("skill", "remove", "review")).stdout).toBe(
      `Removed review from codex: ${at(".agents/skills/review")}`,
    );
    expect(await pathExists(at(".agents/skills/review"))).toBe(false);
    expect(JSON.parse(await project.read("rowbly.config.json")).skills).toBeUndefined();
  });

  it("gives exit code 1 and a JSON error for a skill that is not installed", async () => {
    const result = await cli("--json", "skill", "remove", "review");
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("gives exit code 1 for a conflict", async () => {
    await mkdir(at(".cursor/skills/review"), { recursive: true });
    const result = await cli("skill", "install", "review", "--harness", "cursor");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Hint: Move or delete it");
  });
});
