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

    it("turns the compact Thread mode on and off", async () => {
      const cwd = project.ctx.cwd;
      expect((await runCli(["project", "update", "--compact-threads", "off"], cwd)).stdout).toBe(
        `Updated Rowbly (ROW) in ${cwd}\nCompact threads: off`,
      );
      expect((await getProject(project.ctx)).display).toEqual({ compactThreads: false });
      const json = await runCli(["project", "update", "--compact-threads", "on", "--json"], cwd);
      expect(JSON.parse(json.stdout)).toMatchObject({ projectKey: "ROW", display: { compactThreads: true } });
      expect((await getProject(project.ctx)).display).toEqual({ compactThreads: true });
      const bad = await runCli(["project", "update", "--compact-threads", "yes"], cwd);
      expect(bad.stderr).toContain("Expected on or off.");
      expect(bad.exitCode).not.toBe(0);
    });

    it("sets and removes the time zone, and rejects an unknown zone", async () => {
      const cwd = project.ctx.cwd;
      expect((await runCli(["project", "update", "--time-zone", "Europe/Berlin"], cwd)).stdout).toBe(
        `Updated Rowbly (ROW) in ${cwd}\nCompact threads: on\nTime zone: Europe/Berlin`,
      );
      expect((await getProject(project.ctx)).display).toEqual({ timeZone: "Europe/Berlin" });
      const bad = await runCli(["--json", "project", "update", "--time-zone", "Mars/Olympus"], cwd);
      expect(bad.exitCode).toBe(1);
      expect(JSON.parse(bad.stderr).error.code).toBe("VALIDATION");
      expect((await getProject(project.ctx)).display).toEqual({ timeZone: "Europe/Berlin" });
      expect((await runCli(["project", "update", "--time-zone", ""], cwd)).exitCode).toBe(0);
      expect((await getProject(project.ctx)).display).toEqual({});
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
