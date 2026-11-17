import { describe, expect, it } from "vitest";
import type { RemoteCommand } from "../host-transport/host-transport.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { ensureHostVersion, remotePackagePath, remoteRowblyPath, remoteVersionDir } from "./host-install.js";
import type { LocalBuild } from "./local-build.js";

const RELEASED: LocalBuild = { id: "0.18.0", version: "0.18.0", released: true };
const PACKAGE = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x0a]);
const UNRELEASED: LocalBuild = {
  id: "0.18.0-dev-0123456789ab",
  version: "0.18.0",
  released: false,
  pack: async () => PACKAGE,
};

interface FakeHostOptions {
  /** The version that each remote executable prints, by build id. */
  readonly installed?: Record<string, string>;
  /** The version that npm install puts in the folder. `undefined` installs the local version. */
  readonly installs?: string;
  readonly npmExit?: number;
  readonly uploadExit?: number;
}

/** A fake host with Node 22.19.0 that records each command. */
function fakeHost(build: LocalBuild, options: FakeHostOptions = {}) {
  const commands: RemoteCommand[] = [];
  const versions = new Map(Object.entries(options.installed ?? {}));
  const transport = createFakeHostTransport({
    bytes: (command) => {
      commands.push(command);
      const [program] = command;
      if (program === "node") {
        return { exitCode: 0, bytes: Buffer.from("v22.19.0\n"), stderr: "" };
      }
      if (program === "npm") {
        if ((options.npmExit ?? 0) !== 0) {
          return { exitCode: options.npmExit ?? 1, bytes: Buffer.alloc(0), stderr: "npm ERR! 404 Not Found" };
        }
        versions.set(build.id, options.installs ?? build.version);
        return { exitCode: 0, bytes: Buffer.from("added 1 package"), stderr: "" };
      }
      if (program === "mkdir") {
        return { exitCode: 0, bytes: Buffer.alloc(0), stderr: "" };
      }
      const version = [...versions].find(([id]) => program === remoteRowblyPath(id))?.[1];
      return version === undefined
        ? { exitCode: 127, bytes: Buffer.alloc(0), stderr: "not found" }
        : { exitCode: 0, bytes: Buffer.from(`${version}\n`), stderr: "" };
    },
    upload: (command) => {
      commands.push(command);
      return { exitCode: options.uploadExit ?? 0, stderr: options.uploadExit ? "dd: No space left on device" : "" };
    },
  });
  return { transport, commands };
}

const npmCommands = (commands: readonly RemoteCommand[]) => commands.filter((command) => command[0] === "npm");

describe("host install", () => {
  it("gives the private paths of a build relative to the home folder", () => {
    expect(remoteVersionDir("0.18.0")).toBe(".local/share/rowbly/versions/0.18.0");
    expect(remoteRowblyPath("0.18.0")).toBe(".local/share/rowbly/versions/0.18.0/node_modules/.bin/rowbly");
    expect(remotePackagePath("0.18.0-dev-abc")).toBe(".local/share/rowbly/packages/0.18.0-dev-abc.tgz");
    expect(() => remoteRowblyPath("1.0.0+x")).toThrow();
  });

  it("gives ready without an install when the host has the same build", async () => {
    const { transport, commands } = fakeHost(RELEASED, { installed: { "0.18.0": "0.18.0" } });

    const result = await ensureHostVersion(transport, { build: RELEASED });

    expect(result).toEqual({
      state: "ready",
      buildId: "0.18.0",
      localVersion: "0.18.0",
      remoteVersion: "0.18.0",
      remoteExecutable: ".local/share/rowbly/versions/0.18.0/node_modules/.bin/rowbly",
      installed: false,
      nodeVersion: "v22.19.0",
      stderr: "",
    });
    expect(commands).toEqual([
      ["node", "--version"],
      [remoteRowblyPath("0.18.0"), "--version"],
    ]);
    expect(transport.uploads).toEqual([]);
  });

  it.each([
    ["no Rowbly", {}],
    ["a different version", { installed: { "0.18.0": "0.17.0" } }],
  ])("installs a released build on a host with %s, without upload", async (_name, installed) => {
    const { transport, commands } = fakeHost(RELEASED, installed);

    const result = await ensureHostVersion(transport, { build: RELEASED });

    expect(result).toMatchObject({ state: "ready", installed: true, remoteVersion: "0.18.0" });
    expect(npmCommands(commands)).toEqual([
      ["npm", "install", "--prefix", ".local/share/rowbly/versions/0.18.0", "--no-save", "--omit=dev", "rowbly@0.18.0"],
    ]);
    expect(commands.at(-1)).toEqual([remoteRowblyPath("0.18.0"), "--version"]);
    expect(transport.uploads).toEqual([]);
  });

  it("uploads the package of an unreleased build and installs from the package path", async () => {
    const { transport, commands } = fakeHost(UNRELEASED);
    const path = ".local/share/rowbly/packages/0.18.0-dev-0123456789ab.tgz";

    const result = await ensureHostVersion(transport, { build: UNRELEASED });

    expect(result).toMatchObject({ state: "ready", installed: true, buildId: UNRELEASED.id });
    expect(commands).toContainEqual(["mkdir", "-p", ".local/share/rowbly/packages"]);
    expect(transport.uploads).toHaveLength(1);
    expect(transport.uploads[0]?.command).toEqual(["dd", `of=${path}`, "status=none"]);
    expect(Buffer.compare(transport.uploads[0]?.data ?? Buffer.alloc(0), PACKAGE)).toBe(0);
    expect(npmCommands(commands)).toEqual([
      [
        "npm",
        "install",
        "--prefix",
        ".local/share/rowbly/versions/0.18.0-dev-0123456789ab",
        "--no-save",
        "--omit=dev",
        `./${path}`,
      ],
    ]);
    expect(
      npmCommands(commands)
        .flat()
        .some((token) => token.startsWith("rowbly@")),
    ).toBe(false);
  });

  it("gives version-mismatch when the version after the install is still different", async () => {
    const { transport } = fakeHost(RELEASED, { installed: { "0.18.0": "0.17.0" }, installs: "0.17.0" });

    const result = await ensureHostVersion(transport, { build: RELEASED });

    expect(result).toMatchObject({
      state: "version-mismatch",
      localVersion: "0.18.0",
      remoteVersion: "0.17.0",
      installed: true,
    });
  });

  it("gives version-mismatch with the stderr when npm install fails", async () => {
    const { transport, commands } = fakeHost(RELEASED, { installed: { "0.18.0": "0.17.0" }, npmExit: 1 });

    const result = await ensureHostVersion(transport, { build: RELEASED });

    expect(result).toMatchObject({
      state: "version-mismatch",
      localVersion: "0.18.0",
      remoteVersion: "0.17.0",
      installed: false,
      stderr: "npm ERR! 404 Not Found",
    });
    expect(commands.at(-1)?.[0]).toBe("npm");
  });

  it("gives version-mismatch with the stderr when the upload fails, and does not run npm", async () => {
    const { transport, commands } = fakeHost(UNRELEASED, { uploadExit: 1 });

    const result = await ensureHostVersion(transport, { build: UNRELEASED });

    expect(result).toMatchObject({
      state: "version-mismatch",
      remoteVersion: null,
      stderr: "dd: No space left on device",
    });
    expect(npmCommands(commands)).toEqual([]);
  });

  it("throws the Node error before it runs a Rowbly command", async () => {
    const commands: RemoteCommand[] = [];
    const transport = createFakeHostTransport({
      bytes: (command) => {
        commands.push(command);
        return { exitCode: 127, bytes: Buffer.alloc(0), stderr: "node: not found" };
      },
    });

    await expect(ensureHostVersion(transport, { build: RELEASED })).rejects.toMatchObject({
      code: "HOST_NODE_MISSING",
    });
    expect(commands).toEqual([["node", "--version"]]);
  });
});
