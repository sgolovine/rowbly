import { afterEach, describe, expect, it } from "vitest";
import { createProgram, runCli } from "../testCli/testCli.js";

describe("registerCommands", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("registers every subcommand", () => {
    expect(createProgram().commands.map((command) => command.name())).toEqual([
      "init",
      "update-project",
      "get-instructions",
      "doctor",
      "create-story",
      "update-story",
      "delete-story",
      "get-story",
      "lock-story",
      "unlock-story",
      "search-stories",
      "create-stage",
      "update-stage",
      "delete-stage",
      "get-stage",
      "add-custom-field",
      "update-custom-field",
      "remove-custom-field",
      "create-spec",
      "update-spec",
      "delete-spec",
      "get-spec",
      "list-specs",
      "link-spec",
      "unlink-spec",
    ]);
  });

  it("adds the global --json and -C options", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("-C, --cwd <dir>");
  });

  it("rejects an unknown command", async () => {
    const result = await runCli(["nope"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown command 'nope'");
  });
});
