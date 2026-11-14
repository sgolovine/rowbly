import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getPrompt } from "../../services/prompts/prompts.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { runCli } from "../test-cli/test-cli.js";

describe("rowbly prompt", () => {
  const project = useTestProject();
  const cli = (...args: string[]) => runCli(args, project.ctx.cwd);

  it("lists the three user prompts and their state", async () => {
    await project.write("prompts/WORKER.md", "Use pnpm.\n");
    await rm(join(project.paths.promptsDir, "SUPERVISOR.md"));

    const { stdout, exitCode } = await cli("prompt", "list");

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^system\s+empty\s+The supervisor and all workers\./m);
    expect(stdout).toMatch(/^supervisor\s+missing\s+/m);
    expect(stdout).toMatch(/^worker\s+1 lines\s+All workers, in all Stages\./m);
  });

  it("prints the text of a prompt", async () => {
    await project.write("prompts/SYSTEM.md", "Run the tests first.\n");
    expect(await cli("prompt", "get", "system")).toEqual({ stdout: "Run the tests first.", stderr: "", exitCode: 0 });
  });

  it("says so when a prompt has no text or no file", async () => {
    await rm(join(project.paths.promptsDir, "WORKER.md"));
    expect((await cli("prompt", "get", "worker")).stdout).toBe("(no prompt)");
  });

  it("prints the prompt as JSON with --json", async () => {
    await project.write("prompts/SUPERVISOR.md", "Start one worker.\n");
    expect(JSON.parse((await cli("prompt", "get", "supervisor", "--json")).stdout)).toEqual({
      name: "supervisor",
      label: "Supervisor",
      path: join(project.paths.promptsDir, "SUPERVISOR.md"),
      exists: true,
      text: "Start one worker.",
    });
  });

  it("sets a prompt from --text and creates a missing folder", async () => {
    await rm(project.paths.promptsDir, { recursive: true });

    const result = await cli("prompt", "set", "worker", "--text", "Use pnpm.");

    expect(result).toEqual({ stdout: "Updated the Worker prompt", stderr: "", exitCode: 0 });
    expect((await getPrompt("worker", project.ctx)).text).toBe("Use pnpm.");
  });

  it("sets a prompt from --file", async () => {
    await writeFile(join(project.paths.root, "prompt.md"), "From a file.\n");
    await cli("prompt", "set", "system", "--file", "prompt.md");
    expect((await getPrompt("system", project.ctx)).text).toBe("From a file.");
  });

  it("rejects an unknown prompt name and a set without text", async () => {
    expect((await cli("prompt", "get", "stage")).exitCode).toBe(1);
    expect((await cli("prompt", "set", "worker")).exitCode).toBe(1);
  });

  it("fails outside a project", async () => {
    expect((await runCli(["prompt", "list"], "/")).exitCode).toBe(1);
  });
});
