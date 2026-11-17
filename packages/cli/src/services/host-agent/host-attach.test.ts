import { appendFile, mkdir, truncate, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pathExists } from "../files/files.js";
import { checkHello } from "../host-transport/host-handshake.js";
import { DEFAULT_LINE_LIMIT, decodeChunk, EMPTY_DECODER, parseFrame } from "../host-transport/json-lines.js";
import { useTempDir } from "../test-project/test-project.js";
import { type HostAgentResult, runHostAgent } from "./host-agent.js";
import { submitHostCommand } from "./host-agent-control.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import { runHostAttach } from "./host-attach.js";
import { channelLive } from "./host-channel-mark.js";
import { readFetchFailure, writeFetchRequest } from "./host-fetch.js";
import { type HostRunState, writeHostRun } from "./host-run-state.js";
import type { SessionFrame } from "./host-session-lines.js";
import { writeSlotLimit } from "./host-slots.js";

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await sleep(10);
  }
}

describe("host attach", () => {
  const home = useTempDir();
  const agents: { controller: AbortController; done: Promise<HostAgentResult> }[] = [];

  afterEach(async () => {
    const started = agents.splice(0);
    for (const agent of started) agent.controller.abort();
    await Promise.all(started.map((agent) => agent.done));
  });

  function attach(frameLimit?: number) {
    const input = new PassThrough();
    const text: string[] = [];
    const done = runHostAttach({
      projectId: "p1",
      home: home.path,
      pollMs: 10,
      input,
      write: (line) => void text.push(line),
      ...(frameLimit ? { frameLimit } : {}),
    });
    const frames = () =>
      decodeChunk(EMPTY_DECODER, text.join(""), 16 * 1024 * 1024).lines.map((line) => parseFrame(line));
    const sessions = (threadId = "t1") =>
      (frames() as SessionFrame[]).filter((frame) => frame.type === "session" && frame.threadId === threadId);
    const sessionLines = (threadId = "t1") => sessions(threadId).flatMap((frame) => frame.lines);
    return { input, done, frames, sessions, sessionLines, text };
  }

  const SESSION_FILE = "sessions/t1/2026-session.jsonl";

  async function writeSessionRun(threadId = "t1", file = SESSION_FILE): Promise<string> {
    const paths = hostAgentPaths("p1", home.path);
    const now = new Date().toISOString();
    const session = { model: { provider: "worker", modelId: "m" }, file };
    const run: HostRunState = {
      version: 1,
      threadId,
      requestId: "l1",
      kind: "launch",
      startedAt: now,
      updatedAt: now,
      phase: "running",
      session,
    };
    await writeHostRun(paths, run, true);
    return join(paths.runtime, file);
  }

  async function writeSession(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }

  /** Waits until the first poll that saw the run frames ended. */
  async function opened(channel: ReturnType<typeof attach>): Promise<void> {
    await waitFor(() => channel.frames().some((frame) => (frame as { type: string }).type === "run"));
    await sleep(50);
  }

  async function close(channel: ReturnType<typeof attach>): Promise<void> {
    channel.input.end();
    await channel.done;
  }

  function expectContiguous(frames: SessionFrame[], start: number): void {
    frames.reduce((offset, frame) => {
      expect(frame.offset).toBe(offset);
      return frame.end;
    }, start);
  }

  it("sends hello, then status, then a receipt frame for a new receipt, and ends at the end of stdin", async () => {
    await writeSlotLimit(2, home.path);
    const channel = attach();
    await waitFor(() => channel.frames().length >= 2);

    const [hello, status] = channel.frames();
    expect(checkHello(hello)).toMatchObject({ type: "hello" });
    expect(status).toEqual({ type: "status", agent: "stopped", owner: null, slots: { used: 0, max: 2 }, pending: 0 });

    await submitHostCommand(hostAgentPaths("p1", home.path), JSON.stringify({ version: 1, id: "r1", type: "stop" }));
    await waitFor(() => channel.frames().some((frame) => (frame as { pending?: number }).pending === 1));

    const controller = new AbortController();
    agents.push({
      controller,
      done: runHostAgent({ projectId: "p1", home: home.path, pollMs: 10, signal: controller.signal }),
    });
    await waitFor(() => channel.frames().some((frame) => (frame as { type: string }).type === "receipt"));
    await agents[0]?.done;
    await waitFor(() => {
      const statuses = channel.frames().filter((frame) => (frame as { type: string }).type === "status");
      return (statuses.at(-1) as { pending: number }).pending === 0;
    });

    channel.input.write('{"type":"ignored"}\n');
    channel.input.end();
    await channel.done;

    const frames = channel.frames() as { type: string; agent?: string; receipt?: { status: string } }[];
    expect(frames.filter((frame) => frame.type === "hello")).toHaveLength(1);
    expect(frames.find((frame) => frame.type === "receipt")?.receipt).toMatchObject({ id: "r1" });
  });

  it("shows a running agent, its owner and the used slots", async () => {
    await writeSlotLimit(3, home.path);
    const controller = new AbortController();
    agents.push({
      controller,
      done: runHostAgent({ projectId: "p1", home: home.path, pollMs: 10, signal: controller.signal }),
    });
    const channel = attach();
    const running = () =>
      channel.frames().find((frame) => (frame as { agent?: string }).agent === "running") as
        | { owner: { pid: number } }
        | undefined;
    await waitFor(() => running() !== undefined);
    channel.input.end();
    await channel.done;

    expect(running()).toMatchObject({ slots: { used: 0, max: 3 }, pending: 0, owner: { pid: process.pid } });
  });

  it("sends a receipt frame for each receipt that exists when the channel opens", async () => {
    const paths = hostAgentPaths("p1", home.path);
    await submitHostCommand(paths, JSON.stringify({ version: 1, id: "r1", type: "stop" }));
    await runHostAgent({ projectId: "p1", home: home.path, pollMs: 10, idleMs: 10 });

    const channel = attach();
    await waitFor(() => channel.frames().length >= 3);
    channel.input.end();
    await channel.done;

    expect(channel.frames().slice(0, 3)).toEqual([
      expect.objectContaining({ type: "hello" }),
      expect.objectContaining({ type: "status", agent: "stopped", pending: 0 }),
      { type: "receipt", receipt: expect.objectContaining({ id: "r1", status: "completed" }) },
    ]);
  });

  it("does not start an agent", async () => {
    const channel = attach();
    await waitFor(() => channel.frames().length >= 2);
    await sleep(50);
    channel.input.end();
    await channel.done;

    expect(channel.frames().slice(1)).toEqual([expect.objectContaining({ type: "status", agent: "stopped" })]);
  });

  it("sends a run frame for each Thread when the channel opens, and a new run frame when the result arrives", async () => {
    const paths = hostAgentPaths("p1", home.path);
    const now = new Date().toISOString();
    const base = { version: 1, requestId: "l1", kind: "launch", startedAt: now, updatedAt: now } as const;
    const running: HostRunState = { ...base, threadId: "t1", phase: "running" };
    await writeHostRun(paths, running, true);
    await writeHostRun(paths, { ...base, threadId: "t2", phase: "ended", endReason: "failed" }, true);

    const channel = attach();
    const runs = () =>
      channel.frames().filter((frame) => (frame as { type: string }).type === "run") as {
        run: HostRunState;
      }[];
    await waitFor(() => runs().length >= 2);
    expect(runs().map((frame) => frame.run.threadId)).toEqual(["t1", "t2"]);

    const result = { outcome: "complete", summary: "Done", blockers: [], problems: [] };
    await writeHostRun(paths, { ...running, phase: "ended", result, endReason: "completed" }, true);
    await waitFor(() => runs().length >= 3);
    channel.input.end();
    await channel.done;

    expect(runs()[2]).toEqual({
      type: "run",
      run: expect.objectContaining({ threadId: "t1", result, endReason: "completed" }),
    });
    expect(runs()).toHaveLength(3);
  });

  it("sends the lines that arrive after the channel opened, in order, with byte offsets", async () => {
    const path = await writeSessionRun();
    await writeSession(path, '{"old":1}\n');
    const channel = attach();
    await opened(channel);

    const lines = ['{"a":"éè中😀"}', '{"b":2}', '{"c":"ü"}'];
    await appendFile(path, `${lines[0]}\n${lines[1]}\n`);
    await waitFor(() => channel.sessionLines().length >= 2);
    await appendFile(path, `${lines[2]}\n`);
    await waitFor(() => channel.sessionLines().length >= 3);
    await close(channel);

    const frames = channel.sessions();
    expect(channel.sessionLines()).toEqual(lines);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[0]).toMatchObject({ type: "session", threadId: "t1", file: SESSION_FILE, offset: 10 });
    expectContiguous(frames, 10);
    for (const frame of frames) {
      const bytes = frame.lines.reduce((sum, line) => sum + Buffer.byteLength(line, "utf8") + 1, 0);
      expect(frame.end - frame.offset).toBe(bytes);
    }
  });

  it("sends the run frame of a Thread before its first session frame", async () => {
    const channel = attach();
    await waitFor(() => channel.frames().length >= 2);
    await sleep(30);
    const path = await writeSessionRun();
    await writeSession(path, '{"first":1}\n');
    await waitFor(() => channel.sessionLines().length >= 1);
    await close(channel);

    const types = (channel.frames() as { type: string }[]).map((frame) => frame.type);
    expect(types.indexOf("run")).toBeGreaterThan(-1);
    expect(types.indexOf("run")).toBeLessThan(types.indexOf("session"));
    expect(channel.sessions()[0]).toMatchObject({ offset: 0, lines: ['{"first":1}'] });
  });

  it("does not send a part line until its newline is written", async () => {
    const path = await writeSessionRun();
    await writeSession(path, "");
    const channel = attach();
    await opened(channel);

    await appendFile(path, '{"a":1}\n{"part":');
    await waitFor(() => channel.sessionLines().length >= 1);
    await sleep(50);
    expect(channel.sessionLines()).toEqual(['{"a":1}']);

    await appendFile(path, '"é"}\n');
    await waitFor(() => channel.sessionLines().length >= 2);
    await close(channel);

    expect(channel.sessionLines()).toEqual(['{"a":1}', '{"part":"é"}']);
    expectContiguous(channel.sessions(), 0);
  });

  it("skips the lines that exist at open, and sends a file that appears later from offset 0", async () => {
    const oldPath = await writeSessionRun("t1");
    await writeSession(oldPath, '{"old":1}\n{"old":2}\n');
    const channel = attach();
    await opened(channel);

    const newPath = await writeSessionRun("t2", "sessions/t2/s.jsonl");
    await writeSession(newPath, '{"new":1}\n');
    await appendFile(oldPath, '{"next":1}\n');
    await waitFor(() => channel.sessionLines("t2").length >= 1 && channel.sessionLines("t1").length >= 1);
    await close(channel);

    expect(channel.sessions("t1")).toEqual([
      { type: "session", threadId: "t1", file: SESSION_FILE, offset: 20, end: 31, lines: ['{"next":1}'] },
    ]);
    expect(channel.sessions("t2")).toEqual([
      { type: "session", threadId: "t2", file: "sessions/t2/s.jsonl", offset: 0, end: 10, lines: ['{"new":1}'] },
    ]);
  });

  it("sends a gap frame for a line that is too long for a frame, then the next lines", async () => {
    const path = await writeSessionRun();
    await writeSession(path, "");
    const channel = attach(400);
    await opened(channel);

    const long = `{"long":"${"x".repeat(1000)}"}`;
    const total = 8 + long.length + 1 + 8;
    await appendFile(path, `{"a":1}\n${long}\n{"b":2}\n`);
    await waitFor(() => channel.sessions().at(-1)?.end === total);
    await close(channel);

    const frames = channel.sessions();
    expect(channel.sessionLines()).toEqual(['{"a":1}', '{"b":2}']);
    expect(frames).toContainEqual(expect.objectContaining({ offset: 8, end: 8 + long.length + 1, lines: [] }));
    expectContiguous(frames, 0);
  });

  it("sends a gap frame for a line that is longer than one read", async () => {
    const path = await writeSessionRun();
    await writeSession(path, "");
    const channel = attach();
    await opened(channel);

    const long = "y".repeat(5 * 1024 * 1024);
    await appendFile(path, long);
    await sleep(100);
    await appendFile(path, '\n{"after":1}\n');
    await waitFor(() => channel.sessionLines().length >= 1, 20_000);
    await close(channel);

    expect(channel.sessions()).toEqual([
      expect.objectContaining({ offset: 0, end: long.length + 1, lines: [] }),
      expect.objectContaining({ offset: long.length + 1, end: long.length + 13, lines: ['{"after":1}'] }),
    ]);
  });

  it("keeps each encoded frame in the frame limit when many lines arrive together", async () => {
    const path = await writeSessionRun();
    await writeSession(path, "");
    const limit = 1000;
    const channel = attach(limit);
    await opened(channel);

    const lines = Array.from({ length: 300 }, (_, i) => JSON.stringify({ i, text: `é"\\${"z".repeat(i % 50)}` }));
    await appendFile(path, `${lines.join("\n")}\n`);
    await waitFor(() => channel.sessionLines().length >= lines.length);
    await close(channel);

    const sessionText = channel.text.filter((line) => line.startsWith('{"type":"session"'));
    expect(sessionText.length).toBeGreaterThan(1);
    for (const line of sessionText) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(limit);
    expect(channel.sessionLines()).toEqual(lines);
    expectContiguous(channel.sessions(), 0);
  });

  it("keeps each frame in the default limit for a large burst", async () => {
    const path = await writeSessionRun();
    await writeSession(path, "");
    const channel = attach();
    await opened(channel);

    const lines = Array.from({ length: 3000 }, (_, i) => JSON.stringify({ i, pad: "p".repeat(1000) }));
    await appendFile(path, `${lines.join("\n")}\n`);
    await waitFor(() => channel.sessionLines().length >= lines.length);
    await close(channel);

    const sessionText = channel.text.filter((line) => line.startsWith('{"type":"session"'));
    expect(sessionText.length).toBeGreaterThan(1);
    for (const line of sessionText) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(DEFAULT_LINE_LIMIT);
    expect(channel.sessionLines()).toEqual(lines);
    expectContiguous(channel.sessions(), 0);
  });

  it("does not read a session file outside the runtime folder, and continues after a missing file", async () => {
    const paths = hostAgentPaths("p1", home.path);
    const outside = join(paths.dir, "outside.jsonl");
    await writeSession(outside, "");
    await writeSessionRun("t1", "../outside.jsonl");
    await writeSessionRun("t2", outside);
    await writeSessionRun("t3", "sessions/t3/missing.jsonl");
    const channel = attach();
    await opened(channel);

    await appendFile(outside, '{"secret":1}\n');
    const later = await writeSessionRun("t4", "sessions/t4/s.jsonl");
    await writeSession(later, '{"ok":1}\n');
    await waitFor(() => channel.sessionLines("t4").length >= 1);
    await sleep(50);
    await close(channel);

    expect([...channel.sessions("t1"), ...channel.sessions("t2"), ...channel.sessions("t3")]).toEqual([]);
    expect(channel.sessionLines("t4")).toEqual(['{"ok":1}']);
  });

  it("starts again at offset 0 when the session file becomes shorter", async () => {
    const path = await writeSessionRun();
    await writeSession(path, "");
    const channel = attach();
    await opened(channel);

    await appendFile(path, '{"a":1}\n{"b":2}\n');
    await waitFor(() => channel.sessionLines().length >= 2);
    await truncate(path, 0);
    await sleep(50);
    await appendFile(path, '{"c":3}\n');
    await waitFor(() => channel.sessionLines().length >= 3);
    await close(channel);

    expect(channel.sessions().at(-1)).toEqual(expect.objectContaining({ offset: 0, end: 8, lines: ['{"c":3}'] }));
  });

  it("marks the channel as live while it runs, and removes the mark when its input ends", async () => {
    const paths = hostAgentPaths("p1", home.path);
    const channel = attach();
    await waitFor(() => channel.frames().length >= 2);
    await vi.waitFor(async () => expect(await channelLive(paths)).toBe(true));

    await close(channel);

    expect(await pathExists(paths.channel)).toBe(false);
    expect(await channelLive(paths)).toBe(false);
  });

  it("sends one attachment-request frame for each new fetch request, and writes the failure answer", async () => {
    const paths = hostAgentPaths("p1", home.path);
    const idA = "a00000000-0000-4000-8000-000000000001";
    const idB = "a00000000-0000-4000-8000-000000000002";
    const requests = () =>
      (channel.frames() as { type: string; id?: string }[]).filter((frame) => frame.type === "attachment-request");
    await writeFetchRequest(paths, { storyId: "ROW-1", id: idA, now: new Date() });
    const channel = attach();
    await waitFor(() => requests().length >= 1);
    expect(requests()).toEqual([{ type: "attachment-request", storyId: "ROW-1", id: idA }]);

    await writeFetchRequest(paths, { storyId: "ROW-2", id: idB, now: new Date() });
    await waitFor(() => requests().length >= 2);
    await sleep(50);
    expect(requests().map((frame) => frame.id)).toEqual([idA, idB]);

    channel.input.write("not json\n");
    channel.input.write('{"type":"other"}\n');
    channel.input.write(`{"type":"attachment-failed","id":"${idB}","message":"No such attachment"}\n`);
    channel.input.write('{"type":"attachment-failed","id":"../x","message":"bad"}\n');
    await vi.waitFor(async () => expect(await readFetchFailure(paths, idB)).toBe("No such attachment"));
    expect(await readFetchFailure(paths, idA)).toBeUndefined();
    await close(channel);

    const second = attach();
    await waitFor(
      () => second.frames().filter((frame) => (frame as { type: string }).type === "attachment-request").length >= 2,
    );
    await close(second);
  });
});
