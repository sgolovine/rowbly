import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getProject } from "../../services/project/project.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { runCli } from "../test-cli/test-cli.js";

describe("project commands", () => {
  describe("project update", () => {
    const project = useTestProject();

    it("turns specs on and off", async () => {
      const cwd = project.ctx.cwd;
      expect((await runCli(["project", "update", "--specs", "on"], cwd)).stdout).toBe(
        `Updated Rowbly (ROW) in ${cwd}\nSpecs: on`,
      );
      expect((await getProject(project.ctx)).features).toEqual({ specs: true });
      await runCli(["project", "update", "--specs", "off"], cwd);
      expect((await getProject(project.ctx)).features).toEqual({ specs: false });
      expect((await runCli(["project", "update", "--specs", "yes"], cwd)).stderr).toContain("Expected on or off.");
    });

    it("updates the name and key", async () => {
      const cwd = project.ctx.cwd;
      const result = await runCli(["project", "update", "--name", "Renamed", "--key", "NEW"], cwd);
      expect(result.stdout).toBe(`Updated Renamed (NEW) in ${cwd}`);
      expect(result.exitCode).toBe(0);
    });

    it("fails outside a project", async () => {
      const result = await runCli(["project", "update", "--name", "X"], "/");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/^Error: /);
    });
  });

  describe("project get-instructions", () => {
    const project = useTestProject();
    const cli = (...args: string[]) => runCli(args, project.ctx.cwd);

    it("prints the text of ROWBLY.md", async () => {
      await project.write("ROWBLY.md", "Run the tests first.\n");
      expect(await cli("project", "get-instructions")).toEqual({
        stdout: "Run the tests first.",
        stderr: "",
        exitCode: 0,
      });
    });

    it("says so when there is no ROWBLY.md", async () => {
      await rm(project.paths.instructionsFile);
      expect((await cli("project", "get-instructions")).stdout).toBe("(no instructions)");
    });

    it("prints the path and the text with --json", async () => {
      await project.write("ROWBLY.md", "Run the tests first.\n");
      expect(JSON.parse((await cli("project", "get-instructions", "--json")).stdout)).toEqual({
        path: project.paths.instructionsFile,
        instructions: "Run the tests first.",
      });
    });

    it("fails outside a project", async () => {
      expect((await runCli(["project", "get-instructions"], "/")).exitCode).toBe(1);
    });
  });
});
