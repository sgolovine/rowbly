import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { processExists } from "../factory-ownership/ownership-lock.js";
import { useTempDir } from "../test-project/test-project.js";
import { liveAgent, readAgentClaim } from "./host-agent-claim.js";
import { parseServeInput, startHostAgent } from "./host-agent-launch.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import { readSlotLimit } from "./host-slots.js";

const repo = resolve(".");
const launch = {
  executable: process.execPath,
  execArgv: ["--import", pathToFileURL(join(repo, "node_modules/tsx/dist/loader.mjs")).href],
  entry: join(repo, "src/cli.ts"),
};

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await sleep(50);
  }
}

describe("host serve --detach", () => {
  const home = useTempDir();
  const pids: number[] = [];

  afterEach(async () => {
    for (const pid of pids.splice(0)) {
      if (processExists(pid)) process.kill(pid, "SIGTERM");
      await waitUntil(async () => processExists(pid) === false);
    }
  });

  it("checks the input", () => {
    expect(parseServeInput({ projectId: "p1", maxWorkers: 2 })).toEqual({ projectId: "p1", maxWorkers: 2 });
    for (const input of [null, "p1", { projectId: "P1", maxWorkers: 2 }, {}]) {
      expect(() => parseServeInput(input)).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    }
  });

  it("refuses a bad limit before it starts an agent", async () => {
    await expect(startHostAgent({ projectId: "p1", maxWorkers: 0 }, { launch, home: home.path })).rejects.toMatchObject(
      { code: "VALIDATION" },
    );
    expect(await readAgentClaim(hostAgentPaths("p1", home.path))).toBeUndefined();
  });

  it("starts a detached agent one time, and gives started false for an agent that already runs", async () => {
    const paths = hostAgentPaths("p1", home.path);

    const first = await startHostAgent({ projectId: "p1", maxWorkers: 2 }, { launch, home: home.path });
    pids.push(first.owner.pid);

    expect(first.started).toBe(true);
    expect(first.owner.pid).not.toBe(process.pid);
    expect(await liveAgent(paths)).toEqual(first.owner);
    expect(await readSlotLimit(home.path)).toBe(2);
    const logs = await readdir(paths.logs);
    expect(logs).toHaveLength(1);
    expect((await stat(join(paths.logs, logs[0] as string))).mode & 0o777).toBe(0o600);

    const second = await startHostAgent({ projectId: "p1", maxWorkers: 3 }, { launch, home: home.path });

    expect(second).toEqual({ started: false, owner: first.owner });
    expect(await readSlotLimit(home.path)).toBe(3);

    process.kill(first.owner.pid, "SIGTERM");
    await waitUntil(async () => (await readAgentClaim(paths)) === undefined);
  }, 60_000);

  it("gives started true when the new agent runs a queued stop and exits at once", async () => {
    const paths = hostAgentPaths("p1", home.path);
    const { submitHostCommand } = await import("./host-agent-control.js");
    await submitHostCommand(paths, JSON.stringify({ version: 1, id: "r1", type: "stop" }));

    const result = await startHostAgent({ projectId: "p1", maxWorkers: 1 }, { launch, home: home.path });
    pids.push(result.owner.pid);

    expect(result.started).toBe(true);
    await waitUntil(async () => (await readAgentClaim(paths)) === undefined);
  }, 60_000);

  it("fails when the detached process exits without a claim", async () => {
    const bad = { ...launch, execArgv: [], entry: join(repo, "does-not-exist.mjs") };

    await expect(
      startHostAgent({ projectId: "p1", maxWorkers: 1 }, { launch: bad, home: home.path }),
    ).rejects.toMatchObject({ code: "HOST_TIMEOUT" });
  }, 30_000);
});
