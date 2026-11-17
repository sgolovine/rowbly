import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathExists } from "../files/files.js";
import { useTestProject } from "../test-project/test-project.js";
import { doctor } from "./doctor.js";

describe("doctor prompt checks", () => {
  const project = useTestProject();
  const promptFile = (name: string) => join(project.paths.promptsDir, name);

  it("warns about each missing user prompt, and creates an empty one with --fix", async () => {
    await rm(project.paths.promptsDir, { recursive: true });

    const report = await doctor({}, project.ctx);

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([
      expect.objectContaining({ severity: "warning", message: "The Project prompt is missing", fixed: false }),
      expect.objectContaining({ file: join(".rowbly", "prompts", "WORKER.md"), fix: "Create an empty one" }),
    ]);

    const fixed = await doctor({ fix: true }, project.ctx);

    expect(fixed.issues.every((issue) => issue.fixed)).toBe(true);
    expect(await readFile(promptFile("WORKER.md"), "utf8")).toBe("");
    expect((await doctor({}, project.ctx)).issues).toEqual([]);
  });

  it("shows no warning when the old Supervisor prompt is missing", async () => {
    expect(await pathExists(promptFile("SUPERVISOR.md"))).toBe(false);
    expect((await doctor({}, project.ctx)).issues).toEqual([]);
  });

  it("warns about an old Supervisor prompt, with no fix, and does not delete it with --fix", async () => {
    await project.write("prompts/SUPERVISOR.md", "Start one worker.\n");

    const expected = {
      severity: "warning",
      message: "Rowbly does not use the Supervisor prompt. You can delete this file",
      file: join(".rowbly", "prompts", "SUPERVISOR.md"),
      fixed: false,
    };

    expect((await doctor({}, project.ctx)).issues).toEqual([expected]);
    expect((await doctor({ fix: true }, project.ctx)).issues).toEqual([expected]);
    expect(await readFile(promptFile("SUPERVISOR.md"), "utf8")).toBe("Start one worker.\n");
  });

  it("moves the text of an old ROWBLY.md to the Project prompt with --fix", async () => {
    await project.write("ROWBLY.md", "Use pnpm.\n");

    const report = await doctor({}, project.ctx);

    expect(report.issues).toEqual([
      expect.objectContaining({ file: join(".rowbly", "ROWBLY.md"), fix: "Move it to prompts/SYSTEM.md" }),
    ]);

    await doctor({ fix: true }, project.ctx);

    expect(await pathExists(project.paths.legacyInstructionsFile)).toBe(false);
    expect(await readFile(promptFile("SYSTEM.md"), "utf8")).toBe("Use pnpm.\n");
  });

  it("deletes an old ROWBLY.md that has only the default text", async () => {
    await project.write("ROWBLY.md", "# ROWBLY INSTRUCTIONS\n");
    await project.write("prompts/SYSTEM.md", "Keep this.\n");

    expect((await doctor({ fix: true }, project.ctx)).issues).toEqual([
      expect.objectContaining({ fix: "Delete it", fixed: true }),
    ]);
    expect(await pathExists(project.paths.legacyInstructionsFile)).toBe(false);
    expect(await readFile(promptFile("SYSTEM.md"), "utf8")).toBe("Keep this.\n");
  });

  it("does not replace a Project prompt that has text", async () => {
    await project.write("ROWBLY.md", "Old text.\n");
    await project.write("prompts/SYSTEM.md", "New text.\n");

    const report = await doctor({ fix: true }, project.ctx);

    expect(report.issues).toEqual([expect.objectContaining({ fixed: false })]);
    expect(report.issues[0]?.fix).toBeUndefined();
    expect(await readFile(promptFile("SYSTEM.md"), "utf8")).toBe("New text.\n");
    expect(await pathExists(project.paths.legacyInstructionsFile)).toBe(true);
  });
});
