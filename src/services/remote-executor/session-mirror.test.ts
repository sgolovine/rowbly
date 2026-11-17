import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkerEvents } from "../factory-manager/worker-executor.js";
import { hostAgentPaths } from "../host-agent/host-agent-paths.js";
import { hostSessionBytes } from "../host-agent/host-session-bytes.js";
import type { SessionFrame } from "../host-agent/host-session-lines.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import { helloFrame } from "../host-transport/host-transport.js";
import { Store } from "../store/store.js";
import { createFakeHostTransport, type FakeRemoteChannel } from "../test-project/fake-host-transport.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import type { ThreadRecord } from "../thread/thread.js";
import { ensureLink } from "./remote-channel.js";
import { newRemoteRun } from "./remote-run.js";
import type { RemoteEnv, RemoteState } from "./remote-types.js";
import { catchUpSession, frameStep, isSessionFrame, runSessionFile, takeSessionFrame } from "./session-mirror.js";

const FILE = "sessions/t1/s.jsonl";
const hooks = { sync: async () => undefined, stopHost: async () => undefined, catchUp: async () => undefined };
const events = {} as WorkerEvents;

/** Makes a frame of the lines that start at the byte offset. */
function frame(offset: number, lines: string[], file = FILE): SessionFrame {
  const end = offset + Buffer.byteLength(lines.map((line) => `${line}\n`).join(""));
  return { type: "session", threadId: "t1", file, offset, end, lines };
}

describe("frameStep", () => {
  it("skips, appends the bytes after the mirror end, or asks for a catch-up", () => {
    const f = frame(4, ['{"é":1}']);

    expect(frameStep(f.end, f)).toEqual({ kind: "skip" });
    expect(frameStep(f.end + 3, f)).toEqual({ kind: "skip" });
    expect(frameStep(4, f)).toEqual({ kind: "append", bytes: Buffer.from('{"é":1}\n') });
    expect(frameStep(7, f)).toEqual({ kind: "append", bytes: Buffer.from('{"é":1}\n').subarray(3) });
    expect(frameStep(3, f)).toEqual({ kind: "catch-up" });
    expect(frameStep(4, { ...f, lines: [] })).toEqual({ kind: "catch-up" });
    expect(frameStep(4, { ...f, end: f.end + 1 })).toEqual({ kind: "catch-up" });
  });

  it("accepts only a session frame of a session file of its Thread", () => {
    expect(isSessionFrame(frame(0, ["a"]))).toBe(true);
    expect(isSessionFrame({ ...frame(0, ["a"]), file: "sessions/t2/s.jsonl" })).toBe(false);
    expect(isSessionFrame({ ...frame(0, ["a"]), file: "/sessions/t1/s.jsonl" })).toBe(false);
    expect(isSessionFrame({ ...frame(0, ["a"]), offset: -1 })).toBe(false);
    expect(isSessionFrame({ ...frame(0, ["a"]), lines: [1] })).toBe(false);
    expect(isSessionFrame(null)).toBe(false);
  });
});

describe("session mirror", () => {
  const project = useTestProject();
  const home = useTempDir();

  function hostFile(file = FILE) {
    return join(hostAgentPaths("p1", home.path).runtime, file);
  }

  function mirrorFile(file = FILE) {
    return join(project.paths.runtimeDir, file);
  }

  async function writeHost(text: string, file = FILE) {
    await mkdir(join(hostFile(file), ".."), { recursive: true });
    await appendFile(hostFile(file), text);
  }

  async function setup(options: { failBytes?: () => boolean } = {}) {
    const remotes: FakeRemoteChannel[] = [];
    const bytesCalls: unknown[] = [];
    const transport = createFakeHostTransport({
      channel: (_command, remote) => {
        remotes.push(remote);
        remote.send(helloFrame());
        return undefined;
      },
      bytes: async (command, input) => {
        bytesCalls.push({ command, input });
        if (options.failBytes?.()) throw new HostUnreachableError("Cannot reach fake-host: Connection closed.");
        return { exitCode: 0, bytes: await hostSessionBytes(hostAgentPaths("p1", home.path), input), stderr: "" };
      },
    });
    const connection = { transport, rowbly: "/r/rowbly", clone: "repo" };
    const env: RemoteEnv = {
      input: {
        projectId: "p1",
        paths: project.paths,
        ctx: project.ctx,
        connect: async () => connection,
      } as unknown as RemoteEnv["input"],
      state: new Store<RemoteState>({
        runs: new Map(),
        links: new Map(),
        queueChain: Promise.resolve(),
        reconnects: new Map(),
        outcomes: new Map(),
        mirrors: new Map(),
      }),
    };
    const run = newRemoteRun({ id: "t1" } as ThreadRecord, "mini", events);
    env.state.update(() => ({ runs: new Map([["t1", run]]) }));
    await ensureLink(env, "mini", connection, hooks);
    const remote = remotes[0] as FakeRemoteChannel;
    const settle = () => env.state.current.mirrors.get("t1");
    return { env, remote, run, transport, bytesCalls, settle };
  }

  /** Sends frames on the channel, and waits for the mirror writes. */
  async function send(f: Awaited<ReturnType<typeof setup>>, ...frames: unknown[]) {
    for (const value of frames) f.remote.send(value);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await f.settle();
  }

  it("writes the live lines of the channel in order, each with a newline, with modes 0600 and 0700", async () => {
    const f = await setup();
    const first = frame(0, ['{"a":1}', '{"b":"ü"}']);
    const second = frame(first.end, ['{"c":3}']);

    await send(f, first, second);

    expect(await readFile(mirrorFile(), "utf8")).toBe('{"a":1}\n{"b":"ü"}\n{"c":3}\n');
    expect((await stat(mirrorFile())).size).toBe(second.end);
    expect((await stat(mirrorFile())).mode & 0o777).toBe(0o600);
    expect((await stat(join(mirrorFile(), ".."))).mode & 0o777).toBe(0o700);
    expect(f.bytesCalls).toEqual([]);
  });

  it("writes each line one time for a repeated frame and a frame that overlaps the mirror", async () => {
    const f = await setup();
    const first = frame(0, ["a", "b"]);
    const overlap = frame(2, ["b", "c"]);

    await send(f, first, first, overlap, overlap);

    expect(await readFile(mirrorFile(), "utf8")).toBe("a\nb\nc\n");
  });

  it("ignores a frame of a different Thread, of a different host, or of a Thread without a run", async () => {
    const f = await setup();

    await send(f, { ...frame(0, ["a"]), threadId: "t2", file: "sessions/t2/s.jsonl" });
    f.env.state.update(() => ({
      runs: new Map([["t1", newRemoteRun({ id: "t1" } as ThreadRecord, "other", events)]]),
    }));
    await send(f, frame(0, ["a"]));

    await expect(stat(mirrorFile())).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(mirrorFile("sessions/t2/s.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads the bytes of a gap with session-bytes, then adds the frame", async () => {
    const f = await setup();
    await writeHost("a\nb\nc\nd\n");

    await send(f, frame(0, ["a"]), frame(6, ["d"]));

    expect(await readFile(mirrorFile(), "utf8")).toBe(await readFile(hostFile(), "utf8"));
    expect(f.bytesCalls).toEqual([
      { command: ["/r/rowbly", "host", "session-bytes", "p1"], input: { threadId: "t1", file: FILE, offset: 2 } },
      { command: ["/r/rowbly", "host", "session-bytes", "p1"], input: { threadId: "t1", file: FILE, offset: 8 } },
    ]);
  });

  it("reads the bytes of an oversize line for a gap frame", async () => {
    const f = await setup();
    const long = `{"long":"${"x".repeat(1000)}"}`;
    await writeHost(`a\n${long}\n`);

    await send(f, frame(0, ["a"]), { ...frame(2, [long]), lines: [] });

    expect(await readFile(mirrorFile(), "utf8")).toBe(`a\n${long}\n`);
  });

  it("drops a frame after a gap when session-bytes fails, and a later catch-up adds the bytes", async () => {
    const fail = { value: true };
    const f = await setup({ failBytes: () => fail.value });
    await writeHost("a\nb\nc\n");

    await send(f, frame(0, ["a"]), frame(4, ["c"]));
    expect(await readFile(mirrorFile(), "utf8")).toBe("a\n");

    expect(await catchUpSession(f.env, "mini", "t1", FILE)).toBe(false);
    expect(await readFile(mirrorFile(), "utf8")).toBe("a\n");

    fail.value = false;
    expect(await catchUpSession(f.env, "mini", "t1", FILE)).toBe(true);
    expect(await readFile(mirrorFile(), "utf8")).toBe("a\nb\nc\n");
  });

  it("writes a new session file of the Thread and keeps the old file", async () => {
    const f = await setup();

    await send(f, frame(0, ["a"]), frame(0, ["b"], "sessions/t1/new.jsonl"));

    expect(await readFile(mirrorFile(), "utf8")).toBe("a\n");
    expect(await readFile(mirrorFile("sessions/t1/new.jsonl"), "utf8")).toBe("b\n");
  });

  it("does not let a live frame and a catch-up write at the same time", async () => {
    const f = await setup();
    await writeHost("a\nb\n");

    const results = await Promise.all([
      catchUpSession(f.env, "mini", "t1", FILE),
      takeSessionFrame(f.env, "mini", frame(0, ["a", "b"])),
      catchUpSession(f.env, "mini", "t1", FILE),
    ]);

    expect(results).toEqual([true, undefined, true]);
    expect(await readFile(mirrorFile(), "utf8")).toBe("a\nb\n");
  });

  it("gives the session file of a run from its last session or its end frame", () => {
    const run = newRemoteRun({ id: "t1" } as ThreadRecord, "mini", events);
    expect(runSessionFile(run)).toBeUndefined();

    run.store.update(() => ({ sent: { session: JSON.stringify({ file: FILE }) } }));
    expect(runSessionFile(run)).toBe(FILE);
  });
});
