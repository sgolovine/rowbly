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
});
