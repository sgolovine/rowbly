import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { acquireFactoryOwnership, newOwner } from "../factory-ownership/factory-ownership.js";
import { useTestProject } from "../test-project/test-project.js";
import { runtimePaths } from "../workspace/workspace.js";
import { getFactoryStatus } from "./factory.js";

describe("factory status probes", () => {
  const project = useTestProject();
  it("keeps a live owner with an old heartbeat and identifies a reused PID", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    await writeFile(
      runtimePaths(project.paths).statusFile,
      JSON.stringify({ version: 1, phase: "ready", owner, heartbeatAt: "2000-01-01T00:00:00Z" }),
    );
    expect(await getFactoryStatus(project.ctx)).toMatchObject({ phase: "ready", liveness: "alive", responsive: false });
    await writeFile(runtimePaths(project.paths).lockFile, JSON.stringify({ ...owner, processIdentity: "reused:1" }));
    expect(await getFactoryStatus(project.ctx)).toMatchObject({ phase: "stopped", liveness: "dead" });
  });
  it("reports a corrupt owner as unavailable and preserves its bytes", async () => {
    await acquireFactoryOwnership(project.paths, await newOwner());
    const file = runtimePaths(project.paths).lockFile;
    await writeFile(file, "{");
    expect((await getFactoryStatus(project.ctx)).phase).toBe("unavailable");
    expect(await readFile(file, "utf8")).toBe("{");
  });
});
