import { createHash } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeOutboxBlob } from "../../services/outbox/outbox-file.js";
import { useTempDir } from "../../services/test-project/test-project.js";
import { RC_FILE } from "../../services/user-rc/user-rc.js";
import { runCli } from "../test-cli/test-cli.js";

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
  });

  it("host add records the host outside a Project and prints it as JSON", async () => {
    const result = await cli("--json", "host", "add", "mini", "--ssh", "user@mini.lan", "--max-workers", "2");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true });
    expect(JSON.parse(await readFile(rcFile(), "utf8")).hosts).toEqual([
      { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true },
    ]);
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
    ]) {
      const result = await cli("--json", ...args);

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    }

    expect(await readFile(rcFile(), "utf8")).toBe(text);
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

  it("gives VALIDATION without ROWBLY_OUTBOX", async () => {
    vi.stubEnv("ROWBLY_OUTBOX", "");

    const result = await blob(sha);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    expect(result.bytes.length).toBe(0);
  });
});
