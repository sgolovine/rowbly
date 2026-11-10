import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getProject } from "../../services/project/project.js";
import { useTestProject } from "../../services/testProject/testProject.js";
import { runCli } from "../testCli/testCli.js";

describe("project commands", () => {
  describe("update-project", () => {
    const project = useTestProject();

    it("turns specs on and off", async () => {
      const cwd = project.ctx.cwd;
      expect((await runCli(["update-project", "--specs", "on"], cwd)).stdout).toBe(
        `Updated Rowbly (ROW) in ${cwd}\nSpecs: on`,
      );
      expect((await getProject(project.ctx)).features).toEqual({ specs: true });
      await runCli(["update-project", "--specs", "off"], cwd);
      expect((await getProject(project.ctx)).features).toEqual({ specs: false });
      expect((await runCli(["update-project", "--specs", "yes"], cwd)).stderr).toContain("Expected on or off.");
    });

    it("updates the name and key", async () => {
      const cwd = project.ctx.cwd;
      const result = await runCli(["update-project", "--name", "Renamed", "--key", "NEW"], cwd);
      expect(result.stdout).toBe(`Updated Renamed (NEW) in ${cwd}`);
      expect(result.exitCode).toBe(0);
    });

    it("fails outside a project", async () => {
      const result = await runCli(["update-project", "--name", "X"], "/");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/^Error: /);
    });
  });

  describe("get-instructions", () => {
    const project = useTestProject();
    const cli = (...args: string[]) => runCli(args, project.ctx.cwd);

    it("prints the text of ROWBLY.md", async () => {
      await project.write("ROWBLY.md", "Run the tests first.\n");
      expect(await cli("get-instructions")).toEqual({ stdout: "Run the tests first.", stderr: "", exitCode: 0 });
    });

    it("says so when there is no ROWBLY.md", async () => {
      await rm(project.paths.instructionsFile);
      expect((await cli("get-instructions")).stdout).toBe("(no instructions)");
    });

    it("prints the path and the text with --json", async () => {
      await project.write("ROWBLY.md", "Run the tests first.\n");
      expect(JSON.parse((await cli("get-instructions", "--json")).stdout)).toEqual({
        path: project.paths.instructionsFile,
        instructions: "Run the tests first.",
      });
    });

    it("fails outside a project", async () => {
      expect((await runCli(["get-instructions"], "/")).exitCode).toBe(1);
    });
  });
});
