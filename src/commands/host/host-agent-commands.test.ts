import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { processExists } from "../../services/factory-ownership/ownership-lock.js";
import { readHostReceipt } from "../../services/host-agent/host-agent-control.js";
import { hostAgentPaths } from "../../services/host-agent/host-agent-paths.js";
import { MAX_SESSION_READ_BYTES } from "../../services/host-agent/host-session-lines.js";
import { checkHello } from "../../services/host-transport/host-handshake.js";
import { useTempDir } from "../../services/test-project/test-project.js";

const repo = resolve(".");
const tsx = pathToFileURL(join(repo, "node_modules/tsx/dist/loader.mjs")).href;

interface Exit {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly bytes: Buffer;
}

/** Runs `rowbly <args>` in a child process with the input on stdin, as SSH does on a worker host. */
function rowbly(home: string, args: string[], input: string | Buffer): Promise<Exit> {
  const child = spawn(process.execPath, ["--import", tsx, join(repo, "src/cli.ts"), ...args], {
    cwd: home,
    env: { ...process.env, HOME: home },
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
  child.stdin.on("error", () => undefined);
  child.stdin.end(input);
  return new Promise((done) =>
    child.on("close", (code) =>
      done({
        code,
        stdout: Buffer.concat(out).toString(),
        stderr: Buffer.concat(err).toString(),
        bytes: Buffer.concat(out),
      }),
    ),
  );
}

describe("hidden host agent commands", () => {
  const home = useTempDir();
  const pids: number[] = [];

  afterEach(async () => {
    for (const pid of pids.splice(0)) {
      if (processExists(pid)) process.kill(pid, "SIGTERM");
      while (processExists(pid)) await sleep(50);
    }
  });

  it("host submit writes the command and prints null, then the existing receipt", async () => {
    const command = JSON.stringify({ version: 1, id: "r1", type: "stop" });

    const first = await rowbly(home.path, ["host", "submit", "p1"], command);
    expect(first).toMatchObject({ code: 0, stdout: "null\n" });

    const bad = await rowbly(home.path, ["--json", "host", "submit", "p1"], "{");
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stderr).error.code).toBe("VALIDATION");
    expect(await readHostReceipt(hostAgentPaths("p1", home.path), "r1")).toBeUndefined();
  }, 30_000);

  it("host attach sends the hello frame and stops at the end of stdin", async () => {
    const result = await rowbly(home.path, ["host", "attach", "p1"], '{"type":"ignored"}\n');

    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(checkHello(JSON.parse(lines[0] as string))).toMatchObject({ type: "hello" });
  }, 30_000);

  it("host serve --detach prints { started, owner } as JSON", async () => {
    const input = JSON.stringify({ projectId: "p1", maxWorkers: 1 });

    const first = await rowbly(home.path, ["host", "serve", "--detach"], input);
    const started = JSON.parse(first.stdout);
    pids.push(started.owner.pid);
    expect(first.code).toBe(0);
    expect(started).toMatchObject({ started: true, owner: { version: 1 } });

    const second = await rowbly(home.path, ["host", "serve", "--detach"], input);
    expect(JSON.parse(second.stdout)).toEqual({ started: false, owner: started.owner });
  }, 60_000);

  it("host ping gives the versions and the state of the agent, and does not start the agent", async () => {
    const result = await rowbly(home.path, ["host", "ping", "p1"], "");
    const { localVersions } = await import("../../services/host-transport/host-transport.js");
    expect(JSON.parse(result.stdout)).toEqual({
      ...localVersions(),
      agent: "stopped",
      slots: { used: 0, max: expect.any(Number) },
      pending: 0,
    });
  }, 60_000);

  it("host cache-missing and host cache-put use the attachment cache, and refuse bad input with VALIDATION", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const id = "a00000000-0000-4000-8000-000000000001";
    const ids = JSON.stringify({ ids: [id] });

    const before = await rowbly(home.path, ["host", "cache-missing", "p1"], ids);
    expect(JSON.parse(before.stdout)).toEqual({ missing: [id] });

    const put = await rowbly(home.path, ["host", "cache-put", "p1", id], png);
    expect(JSON.parse(put.stdout)).toEqual({ id, added: true });

    const after = await rowbly(home.path, ["host", "cache-missing", "p1"], ids);
    expect(JSON.parse(after.stdout)).toEqual({ missing: [] });

    const large = Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]);
    for (const [args, input] of [
      [["host", "cache-put", "p1", "bad id"], png],
      [["host", "cache-put", "p1", id], large],
      [["host", "prepare", "p1"], "{}"],
    ] as const) {
      const result = await rowbly(home.path, ["--json", ...args], input);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    }
  }, 60_000);

  it("host session-bytes gives complete lines, at most 4 MiB, and refuses a bad file with VALIDATION", async () => {
    const file = "sessions/t1/s.jsonl";
    const path = join(hostAgentPaths("p1", home.path).runtime, file);
    const long = "x".repeat(MAX_SESSION_READ_BYTES + 5);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `{"a":1}\n${long}\n{"part":`);
    const input = (offset: number, name = file) => JSON.stringify({ threadId: "t1", file: name, offset });

    const first = await rowbly(home.path, ["host", "session-bytes", "p1"], input(0));
    expect(first.code).toBe(0);
    expect(first.bytes.toString()).toBe('{"a":1}\n');

    const window = await rowbly(home.path, ["host", "session-bytes", "p1"], input(8));
    expect(window.code).toBe(0);
    expect(window.bytes.length).toBe(MAX_SESSION_READ_BYTES);

    const rest = await rowbly(home.path, ["host", "session-bytes", "p1"], input(8 + MAX_SESSION_READ_BYTES));
    expect(rest.bytes.toString()).toBe("xxxxx\n");

    const end = await rowbly(home.path, ["host", "session-bytes", "p1"], input(8 + MAX_SESSION_READ_BYTES + 6));
    expect(end).toMatchObject({ code: 0, stdout: "" });

    for (const name of [path, "sessions/t1/../t2/s.jsonl", "sessions/t2/s.jsonl", "threads/t1.json"]) {
      const result = await rowbly(home.path, ["--json", "host", "session-bytes", "p1"], input(0, name));
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    }

    const missing = await rowbly(home.path, ["--json", "host", "session-bytes", "p1"], input(0, "sessions/t1/x.jsonl"));
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stderr).error.code).toBe("NOT_FOUND");
  }, 60_000);
});
