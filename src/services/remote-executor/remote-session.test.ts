import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkerEvents } from "../factory-manager/worker-executor.js";
import { hostAgentPaths } from "../host-agent/host-agent-paths.js";
import { hostSessionBytes } from "../host-agent/host-session-bytes.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import { createStory } from "../story/story.js";
import { createScriptedHost, type ScriptedHost } from "../test-project/scripted-host.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import type { ThreadRecord } from "../thread/thread.js";
import { createRemoteExecutor } from "./remote-executor.js";

const MODEL = { provider: "worker", modelId: "faux" };
const FILE = "sessions/t1/s.jsonl";
const RESULT = { outcome: "complete", summary: "Done", blockers: [], problems: [] };

function threadRecord(storyId: string): ThreadRecord {
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    id: "t1",
    revision: 1,
    role: "worker",
    storyId,
    stage: "BACKLOG",
    status: "pending",
    createdAt,
    session: { id: "t1", file: null },
    cwd: "/main",
    host: "mini",
    runs: [{ id: "run-0", ownerToken: "owner", createdAt, status: "pending" }],
    resumable: false,
  };
}

describe("remote executor session mirror", () => {
  const project = useTestProject();
  const home = useTempDir();
  const hostFile = () => join(hostAgentPaths("p1", home.path).runtime, FILE);
  const mirrorFile = () => join(project.paths.runtimeDir, FILE);

  async function writeHost(text: string) {
    await mkdir(join(hostFile(), ".."), { recursive: true });
    await appendFile(hostFile(), text);
  }

  /** Records the mirror content at each end event. */
  function events(log: unknown[][]): WorkerEvents {
    const mirror = () => readFile(mirrorFile(), "utf8").catch(() => "");
    const record =
      (name: string) =>
      async (..._args: unknown[]) =>
        void log.push([name, await mirror()]);
    return {
      worktreeReady: async () => undefined,
      sessionOpened: async () => undefined,
      message: async () => "MESSAGE",
      prompted: () => undefined,
      activity: async () => undefined,
      resultReported: async () => undefined,
      stopping: () => false,
      completed: record("completed"),
      failed: record("failed"),
      finished: async () => undefined,
    };
  }

  /** Sends one session frame of the first line, then writes more lines on the host, then ends the run. */
  function script() {
    return async (command: { type: string; threadId: string }, host: ScriptedHost) => {
      if (command.type !== "launch") return;
      const session = { model: MODEL, file: FILE };
      host.sendRun(command.threadId, { phase: "running", session });
      await writeHost("a\n");
      host.send({ type: "session", threadId: "t1", file: FILE, offset: 0, end: 2, lines: ["a"] });
      await writeHost("b\nc\n");
      await new Promise((resolve) => setTimeout(resolve, 20));
      host.sendRun(command.threadId, { phase: "ended", endReason: "completed", session, result: RESULT });
    };
  }

  function setup(failBytes: { value: boolean }) {
    const host = createScriptedHost({
      onSubmit: script(),
      bytes: async (_command, input) => {
        if (failBytes.value) throw new HostUnreachableError("Cannot reach fake-host: Connection closed.");
        return { exitCode: 0, bytes: await hostSessionBytes(hostAgentPaths("p1", home.path), input), stderr: "" };
      },
    });
    const executor = createRemoteExecutor({
      paths: project.paths,
      ctx: project.ctx,
      projectId: "p1",
      connect: async () => ({ transport: host.transport, rowbly: "/r/rowbly", clone: "repo" }),
      maxWorkers: () => 1,
      model: () => MODEL,
      sync: async () => undefined,
      helloTimeoutMs: 2000,
    });
    return { host, executor };
  }

  it("has the lines that the host wrote after the last session frame when the Thread completes", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const f = setup({ value: false });
    const log: unknown[][] = [];

    await f.executor.launch({ thread: threadRecord(story.id), story }, events(log));

    expect(log).toEqual([["completed", "a\nb\nc\n"]]);
    expect(await readFile(mirrorFile(), "utf8")).toBe(await readFile(hostFile(), "utf8"));
  });

  it("completes the run when session-bytes fails, with no gap in the mirror", async () => {
    const story = await createStory({ title: "Remote" }, project.ctx);
    const fail = { value: true };
    const f = setup(fail);
    const log: unknown[][] = [];

    await f.executor.launch({ thread: threadRecord(story.id), story }, events(log));

    // The run completes, and the mirror keeps only the line of the live frame.
    expect(log).toEqual([["completed", "a\n"]]);

    // A later catch-up of the next run of the Thread adds the bytes.
    fail.value = false;
    const again = setup(fail);
    await again.executor.launch({ thread: threadRecord(story.id), story }, events([]));
    expect(await readFile(mirrorFile(), "utf8")).toBe(await readFile(hostFile(), "utf8"));
  });
});
