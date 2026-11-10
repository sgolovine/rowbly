import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getProject } from "../../services/project/project.js";
import { useTempDir } from "../../services/testProject/testProject.js";
import { runCli } from "../testCli/testCli.js";

describe("init", () => {
  const dir = useTempDir();

  it("uses the defaults without a terminal and says where to edit them", async () => {
    const result = await runCli(["init", "--name", "Web App", "--key", "web"], dir.path);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Created Web App (WEB) in ${dir.path}`);
    expect(result.stdout).toContain("Stages: BACKLOG, IN_REFINEMENT, IN_DEVELOPMENT, IN_REVIEW, DONE");
    expect(result.stdout).toContain("Skills: develop, factory, refine, review");
    expect(result.stdout).toContain("Where to edit this later:");
    expect(result.stdout).not.toContain("Warning:");
    expect((await getProject({ cwd: dir.path })).customFields.map((field) => field.key)).toEqual([
      "worktree",
      "pull_request",
    ]);
  });

  it("prints the project as JSON with --json", async () => {
    const result = await runCli(["--json", "init", "--name", "Web"], dir.path);
    expect(JSON.parse(result.stdout)).toMatchObject({ projectName: "Web", projectKey: "WEB", root: dir.path });
  });

  it("takes the choices from flags", async () => {
    const args = ["init", "--stage", "Backlog", "--stage", "QA", "--skill", "factory", "--harness", "codex"];
    expect((await runCli(args, dir.path)).exitCode).toBe(0);
    const project = await getProject({ cwd: dir.path });
    expect(project.stages.map((stage) => stage.key)).toEqual(["BACKLOG", "QA", "DONE"]);
    expect(project.skills).toEqual([{ name: "factory", harnesses: ["codex"] }]);
  });

  it("installs no skills with --no-skills when no stage requires one", async () => {
    const result = await runCli(["init", "--stage", "QA", "--no-skills"], dir.path);
    expect((await getProject({ cwd: dir.path })).skills).toBeUndefined();
    expect(result.stdout).toContain('Warning: The factory requires the companion skill "factory"');
  });

  it("takes inline JSON, and a flag has priority over it", async () => {
    const input = JSON.stringify({ name: "From JSON", stages: ["QA"], skills: [] });
    await runCli(["init", "--input", input, "--name", "From flag"], dir.path);
    const project = await getProject({ cwd: dir.path });
    expect(project.projectName).toBe("From flag");
    expect(project.stages.map((stage) => stage.key)).toEqual(["BACKLOG", "QA", "DONE"]);
    expect(await readFile(join(dir.path, ".rowbly/stages/QA.md"), "utf8")).toContain("placeholder");
  });

  it("takes JSON from a file", async () => {
    const file = join(dir.path, "setup.json");
    await writeFile(file, JSON.stringify({ name: "From file", stages: ["QA"], skills: [] }));
    await runCli(["init", "--input", file], dir.path);
    expect((await getProject({ cwd: dir.path })).projectName).toBe("From file");
  });

  it("reports bad JSON and unknown keys", async () => {
    expect((await runCli(["init", "--input", "{nope"], dir.path)).stderr).toContain("not valid JSON");
    expect((await runCli(["init", "--input", '{"nmae":"x"}'], dir.path)).stderr).toContain('Unknown setup key "nmae"');
  });

  it("stops if a selected default stage requires a skill that is left out", async () => {
    const result = await runCli(["init", "--stage", "IN_REVIEW", "--no-skills"], dir.path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Skill "review" is required');
  });

  it("fails with a hint when a project exists", async () => {
    await runCli(["init"], dir.path);
    const result = await runCli(["init"], dir.path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^Error: .*\.rowbly already exists\nHint: Run `rowbly doctor`/);
  });
});
