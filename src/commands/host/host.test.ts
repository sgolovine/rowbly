import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostAgentPaths } from "../../services/host-agent/host-agent-paths.js";
import { appendOutboxEntry, writeOutboxBlob } from "../../services/outbox/outbox-file.js";
import { initProject } from "../../services/project/project.js";
import { useTempDir } from "../../services/test-project/test-project.js";
import { RC_FILE } from "../../services/user-rc/user-rc.js";
import { runCli } from "../test-cli/test-cli.js";

// The command must never use real SSH or npm in a test. The fake host passes each check, with the same Rowbly build.
// A test can change the answer of a command in `hostAnswers`.
// The factory cannot import the fake transport, because the fake transport imports this mocked module.
const hostAnswers = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));
const spawned = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock("../../services/host-transport/ssh-transport.js", async (original) => {
  const actual = await original<typeof import("../../services/host-transport/ssh-transport.js")>();
  const answers = await import("../../services/test-project/fake-host-answers.js");
  const bytes = async (command: readonly string[]) =>
    answers.answerFor({ ...answers.healthyAnswers(), ...(hostAnswers.overrides as Record<string, never>) }, command);
  const fail = async () => {
    throw new Error("The host command test uses only bytes calls.");
  };
  return { ...actual, createSshTransport: () => ({ bytes, request: fail, upload: fail, channel: fail }) };
});

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      spawned.calls.push(args);
      return actual.spawn(...args);
    },
  };
});

vi.mock("../../services/host-install/local-build.js", async (original) => {
  const actual = await original<typeof import("../../services/host-install/local-build.js")>();
  return { ...actual, localBuild: async () => ({ id: "0.18.0", version: "0.18.0", released: true }) };
});

describe("host commands", () => {
  const home = useTempDir();
  const outside = useTempDir();
  const rcFile = () => join(home.path, RC_FILE);
  const cli = (...args: string[]) => runCli(args, outside.path);

  beforeEach(() => {
    vi.stubEnv("HOME", home.path);
    vi.stubEnv("USERPROFILE", home.path);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    hostAnswers.overrides = {};
    spawned.calls = [];
  });

  it("host add records the host outside a Project and prints it as JSON", async () => {
    const result = await cli("--json", "host", "add", "mini", "--ssh", "user@mini.lan", "--max-workers", "2");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      id: "mini",
      ssh: "user@mini.lan",
      maxWorkers: 2,
      enabled: true,
      install: {
        state: "ready",
        buildId: "0.18.0",
        localVersion: "0.18.0",
        remoteVersion: "0.18.0",
        remoteExecutable: ".local/share/rowbly/versions/0.18.0/node_modules/.bin/rowbly",
        installed: false,
        nodeVersion: "v22.19.0",
        stderr: "",
      },
      check: expect.objectContaining({ host: "mini", ready: true }),
    });
    expect(JSON.parse(await readFile(rcFile(), "utf8")).hosts).toEqual([
      {
        id: "mini",
        ssh: "user@mini.lan",
        maxWorkers: 2,
        enabled: true,
        lastCheck: { at: expect.any(String), ready: expect.any(Boolean), failed: expect.any(Array) },
      },
    ]);
  });

  it("host add prints the host and the Rowbly build on the host as text", async () => {
    const result = await cli("host", "add", "mini", "--ssh", "user@mini.lan", "--max-workers", "2");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Added worker host mini  user@mini.lan  2 worker(s)  on\n" +
        "Rowbly 0.18.0 found at .local/share/rowbly/versions/0.18.0/node_modules/.bin/rowbly\n" +
        "All checks pass.",
    );
  });

  it("host add lists the items that fail with their actions, and records the host", async () => {
    hostAnswers.overrides = { gh: { exitCode: 1, bytes: Buffer.alloc(0), stderr: "You are not logged in." } };

    const result = await cli("host", "add", "mini", "--ssh", "user@mini.lan", "--max-workers", "2");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Do these items on the host:\nfail     gh: You are not logged in.\n         Action: Run gh auth login on the host.",
    );
    expect(JSON.parse(await readFile(rcFile(), "utf8")).hosts).toHaveLength(1);
  });

  it("host check prints { host, ready, items } as JSON and exits with 0 when items fail", async () => {
    await cli("host", "add", "mini", "--ssh", "user@mini.lan", "--max-workers", "2");

    const ok = await cli("--json", "host", "check", "mini");

    expect(ok.exitCode).toBe(0);
    expect(Object.keys(JSON.parse(ok.stdout))).toEqual(["host", "ready", "items"]);
    expect(JSON.parse(ok.stdout)).toMatchObject({ host: "mini", ready: true });
    expect(JSON.parse(ok.stdout).items).toHaveLength(13);

    hostAnswers.overrides = { uname: { exitCode: 0, bytes: Buffer.from("Darwin\n"), stderr: "" } };

    const failed = await cli("--json", "host", "check", "mini");

    expect(failed.exitCode).toBe(0);
    expect(JSON.parse(failed.stdout).ready).toBe(false);
  });

  it("host check prints one line for each item, with the action of a fail", async () => {
    await cli("host", "add", "mini", "--ssh", "user@mini.lan", "--max-workers", "2");
    hostAnswers.overrides = { uname: { exitCode: 0, bytes: Buffer.from("Darwin\n"), stderr: "" } };

    const result = await cli("host", "check", "mini");
    const lines = result.stdout.split("\n");

    expect(result.exitCode).toBe(0);
    expect(lines[0]).toBe("Host mini is not ready.");
    expect(lines[1]).toBe("ok       ssh: SSH connects without a password");
    expect(lines[2]).toBe("fail     linux: uname -s gives Darwin");
    expect(lines[3]).toBe("         Action: Use a Linux host. Rowbly runs workers only on Linux.");
    expect(result.stdout).toContain("skipped  clone: Not in a Rowbly Project.");
  });

  it("host check gives NOT_FOUND for an unknown host", async () => {
    const result = await cli("--json", "host", "check", "nope");

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("NOT_FOUND");
  });

  it("host login gives VALIDATION with --json or without a terminal, and starts no process", async () => {
    await cli("host", "add", "mini", "--ssh", "user@mini.lan", "--max-workers", "2");

    const json = await cli("--json", "host", "login", "mini");
    const text = await cli("host", "login", "mini");

    expect(json.exitCode).toBe(1);
    expect(JSON.parse(json.stderr).error).toMatchObject({
      code: "VALIDATION",
      hint: "Run rowbly host login mini in a terminal without --json.",
    });
    expect(text.exitCode).toBe(1);
    expect(text.stderr).toContain("Login needs an interactive terminal");
    expect(spawned.calls).toEqual([]);
  });

  it("host list prints [] without hosts, then the hosts in the order of the file", async () => {
    expect(JSON.parse((await cli("--json", "host", "list")).stdout)).toEqual([]);
    expect((await cli("host", "list")).stdout).toBe("No worker hosts.");

    await cli("host", "add", "zeta", "--ssh", "z@h", "--max-workers", "1");
    await cli("host", "add", "alpha", "--ssh", "a@h", "--max-workers", "3");

    expect(JSON.parse((await cli("--json", "host", "list")).stdout).map((host: { id: string }) => host.id)).toEqual([
      "zeta",
      "alpha",
    ]);
    expect((await cli("host", "list")).stdout).toBe("zeta  z@h  1 worker(s)  on\nalpha  a@h  3 worker(s)  on");
  });

  it("host remove removes the host and prints it with purge", async () => {
    await cli("host", "add", "mini", "--ssh", "user@mini.lan", "--max-workers", "2");
    await cli("host", "add", "other", "--ssh", "o@h", "--max-workers", "1");

    expect(JSON.parse((await cli("--json", "host", "remove", "mini")).stdout)).toEqual({
      id: "mini",
      ssh: "user@mini.lan",
      maxWorkers: 2,
      enabled: true,
      purge: false,
    });
    expect(JSON.parse((await cli("--json", "host", "remove", "other", "--purge")).stdout)).toMatchObject({
      id: "other",
      purge: true,
    });
    expect(JSON.parse(await readFile(rcFile(), "utf8")).hosts).toEqual([]);
  });

  it.each([
    ["Bad_Id", "u@h", "1"],
    ["local", "u@h", "1"],
    ["mini", "-oProxyCommand=x", "1"],
    ["mini", "u@h x", "1"],
    ["mini", "u@h", "0"],
    ["mini", "u@h", "1.5"],
    ["mini", "u@h", "many"],
  ])("host add %s --ssh %s --max-workers %s gives VALIDATION", async (id, ssh, max) => {
    const result = await cli("--json", "host", "add", id, `--ssh=${ssh}`, "--max-workers", max);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
  });

  it("host update changes the worker limit and the on/off state, and prints the changed host", async () => {
    await writeFile(
      rcFile(),
      JSON.stringify({ theme: "x", hosts: [{ id: "mini", ssh: "u@h", maxWorkers: 1, enabled: true, note: "kept" }] }),
    );

    const json = await cli("--json", "host", "update", "mini", "--max-workers", "3");

    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ id: "mini", ssh: "u@h", maxWorkers: 3, enabled: true });
    expect((await cli("host", "update", "mini", "--disable")).stdout).toBe(
      "Updated worker host mini  u@h  3 worker(s)  off",
    );
    expect(JSON.parse(await readFile(rcFile(), "utf8"))).toEqual({
      theme: "x",
      hosts: [{ id: "mini", ssh: "u@h", maxWorkers: 3, enabled: false, note: "kept" }],
    });
    expect(JSON.parse((await cli("--json", "host", "update", "mini", "--enable")).stdout)).toMatchObject({
      enabled: true,
    });
  });

  it.each([
    [["--enable", "--disable"], "VALIDATION"],
    [[], "VALIDATION"],
    [["--max-workers", "0"], "VALIDATION"],
    [["--max-workers", "many"], "VALIDATION"],
  ])("host update mini %j gives %s and keeps the bytes", async (flags, code) => {
    const text = JSON.stringify({ hosts: [{ id: "mini", ssh: "u@h", maxWorkers: 1, enabled: true }] });
    await writeFile(rcFile(), text);

    const result = await cli("--json", "host", "update", "mini", ...flags);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe(code);
    expect(await readFile(rcFile(), "utf8")).toBe(text);
  });

  it("host update gives NOT_FOUND for an unknown host", async () => {
    const result = await cli("--json", "host", "update", "nope", "--max-workers", "2");

    expect(JSON.parse(result.stderr).error.code).toBe("NOT_FOUND");
  });

  it("gives CONFLICT for a host that exists and NOT_FOUND for an unknown host", async () => {
    await cli("host", "add", "mini", "--ssh", "u@h", "--max-workers", "1");

    const conflict = await cli("--json", "host", "add", "mini", "--ssh", "x@h", "--max-workers", "1");
    const missing = await cli("--json", "host", "remove", "nope");

    expect(JSON.parse(conflict.stderr).error.code).toBe("CONFLICT");
    expect(JSON.parse(missing.stderr).error.code).toBe("NOT_FOUND");
  });

  it("fails each command with VALIDATION for an invalid file and keeps the bytes", async () => {
    const text = '{ "projects": [], "hosts": 3 }';

    await writeFile(rcFile(), text);

    for (const args of [
      ["host", "list"],
      ["host", "add", "mini", "--ssh", "u@h", "--max-workers", "1"],
      ["host", "remove", "mini"],
      ["host", "update", "mini", "--max-workers", "2"],
    ]) {
      const result = await cli("--json", ...args);

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    }

    expect(await readFile(rcFile(), "utf8")).toBe(text);
  });
});

describe("host use and unuse", () => {
  const home = useTempDir();
  const project = useTempDir();
  const outside = useTempDir();
  const rcFile = () => join(home.path, RC_FILE);
  const cli = (cwd: string, ...args: string[]) => runCli(args, cwd);
  const git = promisify(execFile);

  beforeEach(async () => {
    vi.stubEnv("HOME", home.path);
    vi.stubEnv("USERPROFILE", home.path);
    await initProject({ name: "Rowbly", key: "ROW" }, { cwd: project.path, home: home.path });
    await git("git", ["init", "-q", project.path]);
    await git("git", ["-C", project.path, "remote", "add", "origin", "git@github.com:o/r.git"]);
    await writeFile(rcFile(), JSON.stringify({ hosts: [{ id: "mini", ssh: "u@h", maxWorkers: 1, enabled: true }] }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("host use clones in the managed folder, and host unuse removes the record", async () => {
    const used = await cli(project.path, "--json", "host", "use", "mini");

    expect(used.exitCode).toBe(0);
    expect(JSON.parse(used.stdout)).toMatchObject({ host: "mini", managed: true, cloned: true });
    expect(JSON.parse(await readFile(rcFile(), "utf8")).hosts[0].projects).toHaveLength(1);
    expect((await cli(project.path, "host", "unuse", "mini")).stdout).toContain("stays on the host");
    expect(JSON.parse(await readFile(rcFile(), "utf8")).hosts[0].projects).toEqual([]);
    expect(JSON.parse((await cli(outside.path, "--json", "host", "list")).stdout)).toEqual([
      { id: "mini", ssh: "u@h", maxWorkers: 1, enabled: true },
    ]);
  });

  it("host use and host unuse give NOT_FOUND outside a Project", async () => {
    for (const args of [
      ["host", "use", "mini"],
      ["host", "unuse", "mini"],
    ]) {
      const result = await cli(outside.path, "--json", ...args);

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error.code).toBe("NOT_FOUND");
    }
  });
});

describe("host blob", () => {
  const outbox = useTempDir();
  const outside = useTempDir();
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const sha = createHash("sha256").update(PNG).digest("hex");

  /** Runs the command and gives the bytes that it wrote to stdout with `process.stdout.write`. */
  async function blob(...args: string[]) {
    const chunks: Buffer[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
      return true;
    });
    try {
      const result = await runCli(["--json", "host", "blob", ...args], outside.path);
      return { ...result, bytes: Buffer.concat(chunks) };
    } finally {
      write.mockRestore();
    }
  }

  beforeEach(() => {
    vi.stubEnv("ROWBLY_OUTBOX", outbox.path);
    vi.stubEnv("ROWBLY_THREAD_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes the exact bytes of the blob to stdout", async () => {
    await writeOutboxBlob(outbox.path, PNG);

    const result = await blob(sha);

    expect(result.exitCode).toBe(0);
    expect(result.bytes.equals(PNG)).toBe(true);
    expect(result.stderr).toBe("");
  });

  it.each([
    ["../x"],
    ["A".repeat(64)],
    ["a".repeat(63)],
    ["a".repeat(65)],
    [`${"a".repeat(31)}/${"a".repeat(32)}`],
    [`${"a".repeat(64)}.png`],
  ])("gives VALIDATION and writes nothing for %s", async (value) => {
    await writeOutboxBlob(outbox.path, PNG);

    const result = await blob(value);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    expect(result.bytes.length).toBe(0);
  });

  it("refuses a blob that is a symlink", async () => {
    const target = join(outside.path, "secret.png");
    await writeFile(target, PNG);
    await mkdir(join(outbox.path, "blobs"), { recursive: true });
    await symlink(target, join(outbox.path, "blobs", `${sha}.png`));

    const result = await blob(sha);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    expect(result.bytes.length).toBe(0);
  });

  it("refuses a blobs folder that is a symlink to a different folder", async () => {
    await writeFile(join(outside.path, `${sha}.png`), PNG);
    await symlink(outside.path, join(outbox.path, "blobs"));

    const result = await blob(sha);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    expect(result.bytes.length).toBe(0);
  });

  it("gives NOT_FOUND for a hash without a file", async () => {
    const result = await blob(sha);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("NOT_FOUND");
    expect(result.bytes.length).toBe(0);
  });

  it("reads the blob from the outbox of the host agent of the project id, without ROWBLY_OUTBOX", async () => {
    vi.stubEnv("HOME", outside.path);
    vi.stubEnv("ROWBLY_OUTBOX", "");
    await writeOutboxBlob(hostAgentPaths("p1", outside.path).outbox, PNG);

    const result = await blob(sha, "p1");

    expect(result.exitCode).toBe(0);
    expect(result.bytes.equals(PNG)).toBe(true);
    expect((await blob(sha, "Bad_Id")).exitCode).toBe(1);
  });

  it("gives VALIDATION without ROWBLY_OUTBOX", async () => {
    vi.stubEnv("ROWBLY_OUTBOX", "");

    const result = await blob(sha);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    expect(result.bytes.length).toBe(0);
  });
});

describe("host outbox and host outbox-ack", () => {
  const outbox = useTempDir();
  const outside = useTempDir();
  const write = (after: string) => ({ storyId: "ROW-01", changes: [{ path: "title", before: "A", after }] });

  /** Runs the command with the text on stdin. */
  async function withStdin(text: string, ...args: string[]) {
    const stdin = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", { value: Readable.from([text]), configurable: true });
    try {
      return await runCli(["--json", "host", ...args], outside.path);
    } finally {
      if (stdin) Object.defineProperty(process, "stdin", stdin);
    }
  }

  beforeEach(() => {
    vi.stubEnv("ROWBLY_OUTBOX", outbox.path);
    vi.stubEnv("ROWBLY_THREAD_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives the entries after afterSeq, then removes the acknowledged entries", async () => {
    await appendOutboxEntry({ dir: outbox.path, threadId: "t" }, write("B"));
    await appendOutboxEntry({ dir: outbox.path, threadId: "t" }, write("C"));

    const read = await withStdin('{"afterSeq":1}\n', "outbox");
    expect(read.exitCode).toBe(0);
    expect(JSON.parse(read.stdout).entries).toEqual([expect.objectContaining({ seq: 2, ...write("C") })]);

    const ack = await withStdin('{"seq":1}\n', "outbox-ack");
    expect(ack.exitCode).toBe(0);
    expect(JSON.parse(ack.stdout)).toEqual({ removed: 1, blobs: [] });

    const after = await withStdin('{"afterSeq":0}\n', "outbox");
    expect(JSON.parse(after.stdout).entries.map((entry: { seq: number }) => entry.seq)).toEqual([2]);
  });

  it("uses the outbox of the host agent of the project id, without ROWBLY_OUTBOX", async () => {
    vi.stubEnv("HOME", outside.path);
    vi.stubEnv("ROWBLY_OUTBOX", "");
    const dir = hostAgentPaths("p1", outside.path).outbox;
    await appendOutboxEntry({ dir, threadId: "t" }, write("B"));
    await appendOutboxEntry({ dir, threadId: "t" }, write("C"));

    const read = await withStdin('{"afterSeq":0}\n', "outbox", "p1");
    expect(read.exitCode).toBe(0);
    expect(JSON.parse(read.stdout).entries.map((entry: { seq: number }) => entry.seq)).toEqual([1, 2]);

    const ack = await withStdin('{"seq":1}\n', "outbox-ack", "p1");
    expect(JSON.parse(ack.stdout)).toEqual({ removed: 1, blobs: [] });

    const bad = await withStdin('{"afterSeq":0}\n', "outbox", "Bad_Id");
    expect(JSON.parse(bad.stderr).error.code).toBe("VALIDATION");
  });

  it("gives VALIDATION for bad JSON and for a missing ROWBLY_OUTBOX", async () => {
    const bad = await withStdin("nope", "outbox");
    expect(bad.exitCode).toBe(1);
    expect(JSON.parse(bad.stderr).error.code).toBe("VALIDATION");

    vi.stubEnv("ROWBLY_OUTBOX", "");
    const missing = await withStdin('{"seq":1}', "outbox-ack");
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stderr).error.message).toBe("ROWBLY_OUTBOX is not set");
  });
});
