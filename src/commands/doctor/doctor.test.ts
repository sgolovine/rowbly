import { rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../../services/testProject/testProject.js";
import { runCli } from "../testCli/testCli.js";

describe("doctor command", () => {
  const project = useTestProject();

  it("reports a clean project", async () => {
    expect(await runCli(["doctor"], project.ctx.cwd)).toEqual({
      stdout: "No problems found.",
      stderr: "",
      exitCode: 0,
    });
  });

  it("lists each problem, suggests --fix and sets exit code 1", async () => {
    await rm(join(project.paths.stagesDir, "DONE.md"));
    await project.write("stories/ROW-01.md", "---\ntitle: One\nstage: NOPE\n---\n");
    const result = await runCli(["doctor"], project.ctx.cwd);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.split("\n")).toEqual([
      "error   .rowbly/stages/DONE.md: Stage DONE has no file (fix: Create an empty one)",
      'error   .rowbly/stories/ROW-01.md: Unknown stage "NOPE". Stages: BACKLOG, DONE',
      "",
      "Run `rowbly doctor --fix` to fix 1 of them.",
    ]);
  });

  it("fixes problems with --fix", async () => {
    await rm(join(project.paths.stagesDir, "DONE.md"));
    const result = await runCli(["doctor", "--fix"], project.ctx.cwd);
    expect(result).toEqual({
      stdout: "fixed   .rowbly/stages/DONE.md: Stage DONE has no file",
      stderr: "",
      exitCode: 0,
    });
    expect(await project.read("stages/DONE.md")).toBe("");
  });

  it("reports a tracked skill that is missing, with exit code 1, and restores it with --fix", async () => {
    await runCli(["install-skill", "review", "--harness", "cursor"], project.ctx.cwd);
    await rm(join(project.paths.root, ".cursor"), { recursive: true });
    const file = join(".cursor", "skills", "review");
    const report = await runCli(["doctor"], project.ctx.cwd);
    expect(report.exitCode).toBe(1);
    expect(report.stdout).toContain(`error   ${file}: Skill review for cursor is missing (fix: Install it again)`);

    const fixed = await runCli(["doctor", "--fix"], project.ctx.cwd);
    expect(fixed.exitCode).toBe(0);
    expect(fixed.stdout).toBe(`fixed   ${file}: Skill review for cursor is missing`);
    expect(await runCli(["doctor"], project.ctx.cwd)).toMatchObject({ exitCode: 0, stdout: "No problems found." });
  });

  it("keeps its report and exit code 1 when a skills folder cannot be created", async () => {
    await runCli(["install-skill", "review", "--harness", "cursor"], project.ctx.cwd);
    await rm(join(project.paths.root, ".cursor", "skills"), { recursive: true });
    await symlink("missing", join(project.paths.root, ".cursor", "skills"));
    await rm(join(project.paths.stagesDir, "DONE.md"));

    const plain = await runCli(["doctor"], project.ctx.cwd);
    expect(plain.exitCode).toBe(1);
    expect(plain.stdout).toContain("Run `rowbly doctor --fix` to fix 1 of them.");

    const fixed = await runCli(["--json", "doctor", "--fix"], project.ctx.cwd);
    expect(fixed.exitCode).toBe(1);
    expect(JSON.parse(fixed.stdout)).toMatchObject({
      ok: false,
      issues: [
        { file: join(".rowbly", "stages", "DONE.md"), fixed: true },
        { file: join(".cursor", "skills", "review"), fixed: false },
      ],
    });
  });

  it("prints the report as JSON with --json", async () => {
    await rm(join(project.paths.stagesDir, "DONE.md"));
    const result = await runCli(["--json", "doctor"], project.ctx.cwd);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, issues: [{ file: ".rowbly/stages/DONE.md" }] });
    expect(result.exitCode).toBe(1);
  });
});
