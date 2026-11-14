import { afterEach, describe, expect, it } from "vitest";
import { useTestProject } from "../../services/test-project/test-project.js";
import { runCli } from "../test-cli/test-cli.js";

describe("factory check commands", () => {
  const project = useTestProject();
  const cli = (...args: string[]) => runCli(["--json", "factory", ...args], project.paths.root);
  const settings = async () => JSON.parse(await project.read("factory.json"));

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("adds, updates, lists and removes a check", async () => {
    const added = await cli(
      "check",
      "add",
      "test",
      "--command",
      "pnpm test",
      "--narrow-command",
      "pnpm vitest related --run {files}",
      "--block",
      "vitest",
      "--block",
      "pnpm test",
    );
    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout)).toMatchObject({ key: "test", label: "test", memoryMb: 1024, timeoutMinutes: 30 });

    const updated = await cli(
      "check",
      "update",
      "test",
      "--label",
      "Tests",
      "--clear-narrow-command",
      "--memory-mb",
      "1500",
    );
    expect(JSON.parse(updated.stdout)).toMatchObject({ label: "Tests", memoryMb: 1500 });
    expect((await settings()).checks.items).toEqual([
      { key: "test", command: "pnpm test", block: ["vitest", "pnpm test"], label: "Tests", memoryMb: 1500 },
    ]);

    const list = await runCli(["factory", "check", "list"], project.paths.root);
    expect(list.stdout).toContain("test (Tests): pnpm test");

    const removed = await cli("check", "remove", "test");
    expect(JSON.parse(removed.stdout)).toEqual([]);
  });

  it("rejects a bad check and an unknown key without a change of factory.json", async () => {
    await cli("check", "add", "test", "--command", "pnpm test");
    const before = await project.read("factory.json");

    const bad = await cli("check", "add", "lint", "--command", "pnpm lint", "--timeout-minutes", "0");
    const missing = await cli("check", "remove", "build");

    expect(bad.exitCode).toBe(1);
    expect(JSON.parse(bad.stderr).error.code).toBe("VALIDATION");
    expect(missing.exitCode).not.toBe(0);
    expect(await project.read("factory.json")).toBe(before);
  });

  it("sets the check limits through configure", async () => {
    const result = await cli("configure", "--max-checks", "3", "--check-memory-reserve", "1024");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).checks).toEqual({ maxConcurrent: 3, reserveMemoryMb: 1024, items: [] });
    expect((await settings()).checks).toEqual({ maxConcurrent: 3, reserveMemoryMb: 1024 });
    expect((await cli("configure", "--max-checks", "33")).exitCode).toBe(1);
  });
});
