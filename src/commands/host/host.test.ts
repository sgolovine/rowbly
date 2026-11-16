import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDir } from "../../services/test-project/test-project.js";
import { RC_FILE } from "../../services/user-rc/user-rc.js";
import { runCli } from "../test-cli/test-cli.js";

// The command must never use real SSH or npm in a test. The fake host has Node and the same Rowbly build.
// The factory cannot import the fake transport, because the fake transport imports this mocked module.
vi.mock("../../services/host-transport/ssh-transport.js", async (original) => {
  const actual = await original<typeof import("../../services/host-transport/ssh-transport.js")>();
  const bytes = async (command: readonly string[]) => ({
    exitCode: 0,
    bytes: Buffer.from(command[0] === "node" ? "v22.19.0\n" : "0.18.0\n"),
    stderr: "",
  });
  const fail = async () => {
    throw new Error("The host command test uses only bytes calls.");
  };
  return { ...actual, createSshTransport: () => ({ bytes, request: fail, upload: fail, channel: fail }) };
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
    });
    expect(JSON.parse(await readFile(rcFile(), "utf8")).hosts).toEqual([
      { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true },
    ]);
  });

  it("host add prints the host and the Rowbly build on the host as text", async () => {
    const result = await cli("host", "add", "mini", "--ssh", "user@mini.lan", "--max-workers", "2");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "Added worker host mini  user@mini.lan  2 worker(s)  on\n" +
        "Rowbly 0.18.0 found at .local/share/rowbly/versions/0.18.0/node_modules/.bin/rowbly",
    );
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
