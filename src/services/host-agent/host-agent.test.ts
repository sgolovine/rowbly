import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { newOwner } from "../factory-ownership/ownership-lock.js";
import { useTempDir } from "../test-project/test-project.js";
import { type HostAgentOptions, type HostAgentResult, hostAgentBusy, runHostAgent } from "./host-agent.js";
import { liveAgent, readAgentClaim, readAgentState } from "./host-agent-claim.js";
import { readHostReceipt, submitHostCommand } from "./host-agent-control.js";
import { hostAgentPaths, slotPaths } from "./host-agent-paths.js";
import type { HostLaunchRequest, HostWorkRunner } from "./host-agent-work.js";
import { slotUsage, writeSlotLimit } from "./host-slots.js";

/** A runner whose work ends only when the test ends it. */
function fakeRunner() {
  const ends = new Map<string, () => void>();
  const started: HostLaunchRequest[] = [];
  const stopped: string[] = [];
  const runner: HostWorkRunner = {
    start: async (request) => {
      started.push(request);
      const ended = new Promise<void>((resolve) => ends.set(request.threadId, resolve));
      return {
        ended,
        stop: async () => {
          stopped.push(request.threadId);
          ends.get(request.threadId)?.();
        },
      };
    },
  };
  return { runner, started, stopped, end: (threadId: string) => ends.get(threadId)?.() };
}

async function waitFor<T>(check: () => Promise<T | undefined | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("Timed out");
    await sleep(10);
  }
}

const launch = (id: string, threadId: string) =>
  JSON.stringify({ version: 1, id, type: "launch", threadId, payload: { story: "ROW-1" } });
const stop = (id: string) => JSON.stringify({ version: 1, id, type: "stop" });

describe("host agent", () => {
  const home = useTempDir();
  const running: { controller: AbortController; done: Promise<HostAgentResult> }[] = [];
  const paths = (projectId = "p1") => hostAgentPaths(projectId, home.path);

  function start(options: Partial<HostAgentOptions> = {}) {
    const controller = new AbortController();
    const done = runHostAgent({
      projectId: "p1",
      home: home.path,
      pollMs: 10,
      idleMs: 60_000,
      signal: controller.signal,
      ...options,
    });
    running.push({ controller, done });
    return { controller, done };
  }

  const settled = (id: string, projectId = "p1") =>
    waitFor(async () => {
      const receipt = await readHostReceipt(paths(projectId), id);
      return receipt && receipt.status !== "accepted" ? receipt : undefined;
    });

  afterEach(async () => {
    const agents = running.splice(0);
    for (const agent of agents) agent.controller.abort();
    await Promise.all(agents.map((agent) => agent.done));
  });

  it("holds one claim for each Project; a second agent of the Project exits with no effect", async () => {
    const first = start();
    const owner = await waitFor(() => liveAgent(paths()));
    const stateBefore = await waitFor(() => readFile(paths().state, "utf8").catch(() => undefined));

    const second = await runHostAgent({ projectId: "p1", home: home.path, pollMs: 10 });

    expect(second).toEqual({ outcome: "already-running", owner });
    expect(await readFile(paths().state, "utf8")).toBe(stateBefore);
    first.controller.abort();
    expect(await first.done).toEqual({ outcome: "stopped", owner });
    expect(await readAgentClaim(paths())).toBeUndefined();
    expect(await readAgentState(paths())).toMatchObject({ phase: "stopped", owner });
  });

  it("replaces the claim of a dead owner", async () => {
    await mkdir(paths().dir, { recursive: true });
    const dead = { ...(await newOwner()), pid: 2 ** 22 + 12345, hostname: hostname(), processIdentity: "boot:1" };
    await writeFile(paths().lock, JSON.stringify(dead));

    start();
    const owner = await waitFor(() => liveAgent(paths()));

    expect(owner.token).not.toBe(dead.token);
  });

  it("runs the agents of two Projects at the same time", async () => {
    start({ projectId: "p1" });
    start({ projectId: "p2" });

    const [a, b] = await Promise.all([waitFor(() => liveAgent(paths("p1"))), waitFor(() => liveAgent(paths("p2")))]);

    expect(a.token).not.toBe(b.token);
  });

  it("writes the runtime folders with mode 0700 and its files with mode 0600", async () => {
    await writeSlotLimit(1, home.path);
    start();
    await waitFor(() => liveAgent(paths()));
    await submitHostCommand(paths(), launch("r1", "t1"));
    await settled("r1");

    const dirs = [
      join(home.path, ".local"),
      join(home.path, ".local/share/rowbly"),
      paths().dir,
      paths().control,
      paths().receipts,
      paths().outbox,
      paths().logs,
      slotPaths(home.path).dir,
    ];
    for (const dir of dirs) expect({ dir, mode: (await stat(dir)).mode & 0o777 }).toEqual({ dir, mode: 0o700 });
    const files = [
      paths().lock,
      paths().state,
      join(paths().control, "r1.json"),
      join(paths().receipts, "r1.json"),
      slotPaths(home.path).limit,
    ];
    for (const file of files) expect({ file, mode: (await stat(file)).mode & 0o777 }).toEqual({ file, mode: 0o600 });
  });

  it("completes a stop command and stops when it has no work", async () => {
    const agent = start();
    const owner = await waitFor(() => liveAgent(paths()));

    await submitHostCommand(paths(), stop("r1"));

    expect(await agent.done).toEqual({ outcome: "stopped", owner });
    expect(await readHostReceipt(paths(), "r1")).toEqual({
      version: 1,
      id: "r1",
      ownerToken: owner.token,
      status: "completed",
    });
  });

  it("runs a duplicate command one time, also after a restart of the agent", async () => {
    await writeSlotLimit(2, home.path);
    const fake = fakeRunner();
    const first = start({ runner: fake.runner });
    await submitHostCommand(paths(), launch("r1", "t1"));
    const receipt = await settled("r1");
    expect(receipt.status).toBe("completed");
    const file = await readFile(join(paths().control, "r1.json"), "utf8");
    first.controller.abort();
    await first.done;

    start({ runner: fake.runner });
    await waitFor(() => liveAgent(paths()));
    expect(await submitHostCommand(paths(), launch("r1", "t9"))).toEqual(receipt);
    await submitHostCommand(paths(), stop("r2"));
    await settled("r2");

    expect(fake.started.map((request) => request.threadId)).toEqual(["t1"]);
    expect(await readFile(join(paths().control, "r1.json"), "utf8")).toBe(file);
    expect(await readHostReceipt(paths(), "r1")).toEqual(receipt);
  });

  it("rejects a launch without a runner with HOST_WORKER_UNAVAILABLE, and no slot stays", async () => {
    await writeSlotLimit(1, home.path);
    start();
    await submitHostCommand(paths(), launch("r1", "t1"));

    expect(await settled("r1")).toMatchObject({
      status: "rejected",
      threadId: "t1",
      error: { code: "HOST_WORKER_UNAVAILABLE" },
    });
    expect(await slotUsage(home.path)).toEqual({ used: 0, max: 1 });
  });

  it("enforces the machine limit for the agents of two Projects and releases a slot when the work ends", async () => {
    await writeSlotLimit(2, home.path);
    const fake = fakeRunner();
    start({ projectId: "p1", runner: fake.runner });
    start({ projectId: "p2", runner: fake.runner });

    await submitHostCommand(paths("p1"), launch("r1", "t1"));
    await submitHostCommand(paths("p2"), launch("r2", "t2"));
    expect(await settled("r1", "p1")).toMatchObject({ status: "completed" });
    expect(await settled("r2", "p2")).toMatchObject({ status: "completed" });
    expect(fake.started).toContainEqual({
      kind: "launch",
      projectId: "p1",
      threadId: "t1",
      requestId: "r1",
      payload: { story: "ROW-1" },
      checks: expect.objectContaining({ queue: expect.objectContaining({ ownerToken: expect.any(String) }) }),
    });

    await submitHostCommand(paths("p1"), launch("r3", "t3"));
    expect(await settled("r3", "p1")).toMatchObject({
      status: "rejected",
      error: { code: "HOST_NO_FREE_SLOT" },
    });
    expect(await readAgentState(paths("p1"))).toMatchObject({ active: [{ threadId: "t1", requestId: "r1" }] });

    fake.end("t1");
    await waitFor(async () => (await slotUsage(home.path)).used === 1);
    await submitHostCommand(paths("p1"), launch("r4", "t4"));
    expect(await settled("r4", "p1")).toMatchObject({ status: "completed" });
    expect((await readdir(slotPaths(home.path).dir)).filter((f) => f.includes("--")).toSorted()).toEqual([
      "p1--t4.json",
      "p2--t2.json",
    ]);
  });

  it("gives a launch a slot after the slot of a dead owner is removed", async () => {
    await writeSlotLimit(1, home.path);
    await mkdir(slotPaths(home.path).dir, { recursive: true });
    const dead = { ...(await newOwner()), pid: 2 ** 22 + 12345, processIdentity: "boot:1" };
    await writeFile(
      join(slotPaths(home.path).dir, "p9--t9.json"),
      JSON.stringify({ version: 1, projectId: "p9", threadId: "t9", owner: dead }),
    );
    const fake = fakeRunner();
    start({ runner: fake.runner });

    await submitHostCommand(paths(), launch("r1", "t1"));

    expect(await settled("r1")).toMatchObject({ status: "completed" });
  });

  it("stops after the idle period and releases its claim", async () => {
    const agent = start({ idleMs: 100 });

    expect(await agent.done).toMatchObject({ outcome: "stopped" });
    expect(await readAgentClaim(paths())).toBeUndefined();
  });

  it("does not stop while the outbox has an entry", async () => {
    await mkdir(paths().outbox, { recursive: true });
    await writeFile(join(paths().outbox, "outbox.jsonl"), '{"seq":1}\n');
    const agent = start({ idleMs: 50 });

    await sleep(300);
    expect(await liveAgent(paths())).toBeDefined();

    await writeFile(join(paths().outbox, "outbox.jsonl"), "");
    expect(await agent.done).toMatchObject({ outcome: "stopped" });
  });

  it("is busy while a command is pending, while the outbox has an entry or while work is active", async () => {
    expect(await hostAgentBusy(paths(), 0)).toBe(false);
    expect(await hostAgentBusy(paths(), 1)).toBe(true);

    await submitHostCommand(paths(), stop("r1"));
    expect(await hostAgentBusy(paths(), 0)).toBe(true);

    const agent = start({ idleMs: 50 });
    await agent.done;
    expect(await hostAgentBusy(paths(), 0)).toBe(false);

    await writeFile(join(paths().outbox, "outbox.jsonl"), '{"seq":1}\n');
    expect(await hostAgentBusy(paths(), 0)).toBe(true);
  });

  it("does not stop while work is active, and a stop command stops it when the work ends", async () => {
    await writeSlotLimit(1, home.path);
    const fake = fakeRunner();
    const agent = start({ runner: fake.runner, idleMs: 50 });
    await submitHostCommand(paths(), launch("r1", "t1"));
    await settled("r1");

    await sleep(300);
    expect(await liveAgent(paths())).toBeDefined();

    await submitHostCommand(paths(), stop("r2"));
    await settled("r2");
    await waitFor(async () => (await readAgentState(paths()))?.phase === "stopping");
    await submitHostCommand(paths(), launch("r3", "t3"));
    expect(await settled("r3")).toMatchObject({ status: "rejected", error: { code: "CONFLICT" } });
    expect(await liveAgent(paths())).toBeDefined();

    fake.end("t1");
    expect(await agent.done).toMatchObject({ outcome: "stopped" });
    expect(await slotUsage(home.path)).toEqual({ used: 0, max: 1 });
  });

  it("asks each work to stop at a stop signal", async () => {
    await writeSlotLimit(1, home.path);
    const fake = fakeRunner();
    const agent = start({ runner: fake.runner });
    await submitHostCommand(paths(), launch("r1", "t1"));
    await settled("r1");

    agent.controller.abort();

    expect(await agent.done).toMatchObject({ outcome: "stopped" });
    expect(fake.stopped).toEqual(["t1"]);
  });
});
