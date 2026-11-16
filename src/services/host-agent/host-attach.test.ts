import { PassThrough } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { checkHello } from "../host-transport/host-handshake.js";
import { decodeChunk, EMPTY_DECODER, parseFrame } from "../host-transport/json-lines.js";
import { useTempDir } from "../test-project/test-project.js";
import { type HostAgentResult, runHostAgent } from "./host-agent.js";
import { submitHostCommand } from "./host-agent-control.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import { runHostAttach } from "./host-attach.js";
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

  function attach() {
    const input = new PassThrough();
    const text: string[] = [];
    const done = runHostAttach({
      projectId: "p1",
      home: home.path,
      pollMs: 10,
      input,
      write: (line) => void text.push(line),
    });
    const frames = () => decodeChunk(EMPTY_DECODER, text.join("")).lines.map((line) => parseFrame(line));
    return { input, done, frames };
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
});
