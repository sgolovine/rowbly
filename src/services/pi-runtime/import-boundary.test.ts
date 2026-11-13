import { describe, expect, it, vi } from "vitest";
import { useTestProject } from "../test-project/test-project.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("Pi loaded during command registration");
});

describe("Pi import boundary", () => {
  const project = useTestProject();
  it("does not load Pi for help or command registration", async () => {
    const { createProgram } = await import("../../commands/test-cli/test-cli.js");
    expect(createProgram().helpInformation()).toContain("Usage:");
    await expect(import("./pi-runtime.js")).resolves.toHaveProperty("loadPi");
  });

  it("reads factory status without loading Pi or credentials", async () => {
    const { runCli } = await import("../../commands/test-cli/test-cli.js");
    const result = await runCli(["--json", "factory", "status"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).phase).toBe("stopped");
  });
});
