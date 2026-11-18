import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { describe, expect, it } from "vitest";
import { prepareRuntime } from "../runtime-files/runtime-files.js";
import { useTestProject } from "../test-project/test-project.js";
import { runtimePaths } from "../workspace/workspace.js";
import {
  acquireFactoryOwnership,
  assertFactoryOwnership,
  newOwner,
  probeOwner,
  releaseFactoryOwnership,
} from "./factory-ownership.js";
import { withLifecycleGuard } from "./ownership-lock.js";

describe("factory ownership", () => {
  const project = useTestProject();
  it("stale takeover has one winner and an old owner cannot remove the new lock", async () => {
    await prepareRuntime(project.paths);
    const old = await newOwner();
    await writeFile(runtimePaths(project.paths).lockFile, JSON.stringify(old));
    const contenders = await Promise.all(
      Array.from({ length: 20 }, async () => ({ ...(await newOwner()), token: randomUUID() })),
    );
    const results = await Promise.all(
      contenders.map((owner) =>
        acquireFactoryOwnership(project.paths, owner, async (record) =>
          record.token === old.token ? "dead" : "alive",
        ),
      ),
    );
    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    const winner = results.find((result) => result.acquired);
    if (!winner) throw new Error("Missing winner");
    expect(await releaseFactoryOwnership(project.paths, old.token)).toBe(false);
    await expect(assertFactoryOwnership(project.paths, old.token)).rejects.toThrow(/token/);
    await assertFactoryOwnership(project.paths, winner.owner.token);
    expect(await releaseFactoryOwnership(project.paths, winner.owner.token)).toBe(true);
  });
  it("a live owner stays alive without heartbeat evidence", async () => {
    const owner = await newOwner();
    expect(await probeOwner(owner)).toBe("alive");
    expect(await probeOwner({ ...owner, hostname: `${hostname()}-foreign` })).toBe("uncertain");
    expect(await probeOwner({ ...owner, processIdentity: undefined })).toBe("uncertain");
    expect(await probeOwner({ ...owner, processIdentity: "other-boot:1" })).toBe("dead");
    await acquireFactoryOwnership(project.paths, owner);
    expect((await acquireFactoryOwnership(project.paths, await newOwner())).acquired).toBe(false);
  });
  it("a guard crash fails closed and preserves the guard", async () => {
    await prepareRuntime(project.paths);
    const guard = runtimePaths(project.paths).guardFile;
    await writeFile(guard, "crash");
    await expect(withLifecycleGuard(guard, async () => {}, 10)).rejects.toThrow(/offline repair/);
  });
  it("preserves a corrupt owner", async () => {
    await prepareRuntime(project.paths);
    await writeFile(runtimePaths(project.paths).lockFile, "{");
    await expect(acquireFactoryOwnership(project.paths, await newOwner())).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
