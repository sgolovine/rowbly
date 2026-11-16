import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { listHosts } from "../host/host.js";
import type { BytesResult, RemoteCommand } from "../host-transport/host-transport.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { createThread, transitionThread } from "../thread/thread.js";
import { RC_FILE } from "../user-rc/user-rc.js";
import { managedClonePath } from "./host-paths.js";
import { hostProjectFor, remoteWorktreesDir, type UseHostDeps, unuseHost, useHost } from "./host-project.js";

const git = promisify(execFile);
const ORIGIN = "git@github.com:o/r.git";
const out = (exitCode: number, text = "", stderr = ""): BytesResult => ({ exitCode, bytes: Buffer.from(text), stderr });

interface Folder {
  readonly repo: boolean;
  readonly origin?: string;
  readonly dirty?: boolean;
}

/** A fake host with folders. A clone adds a folder, unless the test gives a failed clone. */
function fakeHost(start: Record<string, Folder> = {}, clone: BytesResult = out(0)) {
  const folders: Record<string, Folder> = { ...start };
  const commands: RemoteCommand[] = [];
  const targets: string[] = [];
  const answer = (command: RemoteCommand): BytesResult => {
    const folder = folders[command[2] ?? ""];
    if (command[0] === "test") {
      return out(folder ? 0 : 1);
    }
    if (command[0] === "env") {
      if (clone.exitCode === 0) {
        folders[command[6] ?? ""] = { repo: true, origin: command[5] };
      }
      return clone;
    }
    if (!folder?.repo) {
      return out(128, "", "fatal: not a git repository");
    }
    if (command[3] === "rev-parse") {
      return out(0, "true\n");
    }
    if (command[3] === "remote") {
      return folder.origin ? out(0, `${folder.origin}\n`) : out(2);
    }
    return out(0, folder.dirty ? "?? new.txt\n" : "");
  };
  const transport = createFakeHostTransport({
    bytes: (command) => {
      commands.push(command);
      return answer(command);
    },
  });
  const deps: UseHostDeps = {
    transportFor: (target) => {
      targets.push(target);
      return transport;
    },
  };
  return { deps, commands, targets };
}

const MINI = { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true };

describe("host-project", () => {
  const p = useTestProject();
  const outside = useTempDir();
  const rcFile = () => join(p.ctx.home as string, RC_FILE);
  const stored = async () => JSON.parse(await readFile(rcFile(), "utf8"));
  const managed = () => managedClonePath(p.paths.root);
  const writeHosts = (hosts: unknown[], extra: Record<string, unknown> = {}) =>
    writeFile(rcFile(), JSON.stringify({ deviceId: "device", ...extra, hosts }, null, 2));
  const errorOf = (promise: Promise<unknown>) => promise.catch((caught: unknown) => caught);

  beforeEach(async () => {
    await git("git", ["init", "-q", p.paths.root]);
    await git("git", ["-C", p.paths.root, "remote", "add", "origin", ORIGIN]);
    await writeHosts([MINI]);
  });

  it("clones the origin into the managed folder and records the Project", async () => {
    const { deps, commands, targets } = fakeHost();
    const used = await useHost({ id: "mini" }, p.ctx, deps);
    const path = managed();

    expect(path).toMatch(/^\.local\/share\/rowbly\/projects\/[a-z0-9-]+-[0-9a-f]{12}\/repo$/);
    expect(used).toEqual({ host: "mini", root: p.paths.root, path, managed: true, url: ORIGIN, cloned: true });
    expect(targets).toEqual(["user@mini.lan"]);
    expect(commands).toEqual([
      ["test", "-e", path],
      ["env", "GIT_TERMINAL_PROMPT=0", "git", "clone", "--", ORIGIN, path],
    ]);
    expect(await stored()).toEqual({
      deviceId: "device",
      hosts: [{ ...MINI, projects: [{ root: p.paths.root, path, managed: true }] }],
    });
    expect(await hostProjectFor("mini", p.ctx)).toEqual({ root: p.paths.root, path, managed: true });
    expect(await listHosts(p.ctx)).toEqual([MINI]);
  });

  it("uses a managed clone of the same repository again without a clone", async () => {
    const { deps, commands } = fakeHost({ [managed()]: { repo: true, origin: "https://github.com/o/r.git" } });

    expect(await useHost({ id: "mini" }, p.ctx, deps)).toMatchObject({ cloned: false, managed: true });
    expect(commands.some((command) => command[0] === "env")).toBe(false);
    expect((await stored()).hosts[0].projects).toEqual([{ root: p.paths.root, path: managed(), managed: true }]);
  });

  it("uses the managed clone again after unuse", async () => {
    const { deps, commands } = fakeHost();

    await useHost({ id: "mini" }, p.ctx, deps);
    await unuseHost({ id: "mini" }, p.ctx);

    expect(await useHost({ id: "mini" }, p.ctx, deps)).toMatchObject({ cloned: false });
    expect(commands.filter((command) => command[0] === "env")).toHaveLength(1);
  });

  it.each([
    ["a folder that is not a clone", { repo: false }],
    ["a clone of a different repository", { repo: true, origin: "https://github.com/o/other.git" }],
  ])("gives CONFLICT for a managed folder with %s and keeps the bytes", async (_name, folder) => {
    const before = await readFile(rcFile(), "utf8");
    const { deps, commands } = fakeHost({ [managed()]: folder });

    expect(await errorOf(useHost({ id: "mini" }, p.ctx, deps))).toMatchObject({ code: "CONFLICT" });
    expect(commands.some((command) => command[0] === "env")).toBe(false);
    expect(await readFile(rcFile(), "utf8")).toBe(before);
  });

  it("uses an existing clean clone with --path and records managed false", async () => {
    const { deps, commands } = fakeHost({ "work/rowbly": { repo: true, origin: "ssh://git@github.com/o/r" } });
    const used = await useHost({ id: "mini", path: "~/work/rowbly" }, p.ctx, deps);

    expect(used).toMatchObject({ path: "work/rowbly", managed: false, cloned: false });
    expect(commands.some((command) => command[0] === "env")).toBe(false);
    expect(commands.at(-1)).toEqual(["git", "-C", "work/rowbly", "status", "--porcelain"]);
    expect((await stored()).hosts[0].projects).toEqual([{ root: p.paths.root, path: "work/rowbly", managed: false }]);
  });

  it.each([
    ["a missing folder", {}],
    ["a folder that is not a Git work tree", { "work/rowbly": { repo: false } }],
    ["a clone of a different repository", { "work/rowbly": { repo: true, origin: "https://gitlab.com/o/r.git" } }],
    ["a clone with changes", { "work/rowbly": { repo: true, origin: ORIGIN, dirty: true } }],
  ])("gives VALIDATION for --path with %s and keeps the bytes", async (_name, folders) => {
    const before = await readFile(rcFile(), "utf8");
    const { deps } = fakeHost(folders as Record<string, Folder>);

    expect(await errorOf(useHost({ id: "mini", path: "work/rowbly" }, p.ctx, deps))).toMatchObject({
      code: "VALIDATION",
    });
    expect(await readFile(rcFile(), "utf8")).toBe(before);
  });

  it.each([
    [
      "HOST_GIT_ACCESS",
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
    ],
    ["HOST_CLONE_FAILED", "fatal: could not create leading directories: Permission denied"],
  ])("gives %s for a failed clone and keeps the bytes", async (code, stderr) => {
    const before = await readFile(rcFile(), "utf8");
    const { deps } = fakeHost({}, out(128, "", stderr));
    const error = await errorOf(useHost({ id: "mini" }, p.ctx, deps));

    expect(error).toMatchObject({ code, details: { stderr } });
    expect(await readFile(rcFile(), "utf8")).toBe(before);
  });

  it("gives NOT_FOUND for an unknown host, and CONFLICT with a hint for a Project that the host uses", async () => {
    const { deps } = fakeHost();

    expect(await errorOf(useHost({ id: "nope" }, p.ctx, deps))).toMatchObject({ code: "NOT_FOUND" });

    await useHost({ id: "mini" }, p.ctx, deps);

    expect(await errorOf(useHost({ id: "mini" }, p.ctx, deps))).toMatchObject({
      code: "CONFLICT",
      hint: expect.stringContaining("rowbly host unuse mini"),
    });
  });

  it("gives the usual Project error outside a Project", async () => {
    const ctx = { ...p.ctx, cwd: outside.path };

    expect(await errorOf(useHost({ id: "mini" }, ctx, fakeHost().deps))).toMatchObject({ code: "NOT_FOUND" });
    expect(await errorOf(unuseHost({ id: "mini" }, ctx))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("gives VALIDATION with a hint for a Project without origin", async () => {
    const { deps, commands } = fakeHost();

    await git("git", ["-C", p.paths.root, "remote", "remove", "origin"]);

    expect(await errorOf(useHost({ id: "mini" }, p.ctx, deps))).toMatchObject({
      code: "VALIDATION",
      hint: expect.stringContaining("git remote add origin"),
    });
    expect(commands).toEqual([]);
  });

  it.each([
    ["an origin with a space", "https://github.com/o/r r.git", undefined],
    ["an origin with ~", "ssh://host/~user/r.git", undefined],
    ["a --path with $", ORIGIN, "work/$(id)"],
    ["a --path with a space", ORIGIN, "work/my repo"],
  ])("gives VALIDATION for %s before any remote command", async (_name, origin, path) => {
    const { deps, commands, targets } = fakeHost();

    await git("git", ["-C", p.paths.root, "remote", "set-url", "origin", origin]);

    const input = path === undefined ? { id: "mini" } : { id: "mini", path };

    expect(await errorOf(useHost(input, p.ctx, deps))).toMatchObject({ code: "VALIDATION" });
    expect(commands).toEqual([]);
    expect(targets).toEqual([]);
  });

  it("removes only the record of the current Project with unuse and runs no remote command", async () => {
    const other = { root: "/other", path: "x", managed: false };

    await writeHosts(
      [
        { ...MINI, later: "kept", projects: [other] },
        { ...MINI, id: "b" },
      ],
      { projects: [{ path: "/a" }] },
    );

    const { deps, commands } = fakeHost();

    await useHost({ id: "mini" }, p.ctx, deps);

    const count = commands.length;

    expect(await unuseHost({ id: "mini" }, p.ctx)).toEqual({
      host: "mini",
      root: p.paths.root,
      path: managed(),
      managed: true,
    });
    expect(commands).toHaveLength(count);
    expect(await stored()).toEqual({
      deviceId: "device",
      projects: [{ path: "/a" }],
      hosts: [
        { ...MINI, later: "kept", projects: [other] },
        { ...MINI, id: "b" },
      ],
    });
    expect(await hostProjectFor("mini", p.ctx)).toBeUndefined();
  });

  it("gives NOT_FOUND for unuse when the host does not use the Project", async () => {
    expect(await errorOf(unuseHost({ id: "mini" }, p.ctx))).toMatchObject({ code: "NOT_FOUND" });
    expect(await errorOf(unuseHost({ id: "nope" }, p.ctx))).toMatchObject({ code: "NOT_FOUND" });
  });

  it.each(["pending", "running"] as const)(
    "refuses unuse with a %s Thread of the Project on the host",
    async (status) => {
      await useHost({ id: "mini" }, p.ctx, fakeHost().deps);

      const before = await readFile(rcFile(), "utf8");
      const input = { role: "worker", storyId: "ROW-01", stage: "DEV", cwd: p.paths.root, ownerToken: "o" } as const;
      const thread = await createThread({ ...input, host: "mini" }, p.ctx);

      await createThread({ ...input, host: "other" }, p.ctx);

      if (status === "running") {
        await transitionThread(thread.id, { expectedRevision: 1, status }, p.ctx);
      }

      expect(await errorOf(unuseHost({ id: "mini" }, p.ctx))).toMatchObject({
        code: "CONFLICT",
        details: { threads: [{ project: p.paths.root, id: thread.id }] },
      });
      expect(await readFile(rcFile(), "utf8")).toBe(before);
    },
  );

  it("gives the worktrees folder next to the clone", () => {
    expect(remoteWorktreesDir(managed())).toBe(`${managed()}-worktrees`);
  });

  it.each([
    ["a projects value that is not an array", { projects: {} }],
    ["a project without managed", { projects: [{ root: "/r", path: "p" }] }],
    ["a project with a path of the wrong type", { projects: [{ root: "/r", path: 1, managed: true }] }],
  ])("fails each host command with VALIDATION for %s and keeps the bytes", async (_name, extra) => {
    await writeHosts([{ ...MINI, ...extra }]);

    const before = await readFile(rcFile(), "utf8");
    const { deps, commands } = fakeHost();

    expect(await errorOf(listHosts(p.ctx))).toMatchObject({ code: "VALIDATION" });
    expect(await errorOf(useHost({ id: "mini" }, p.ctx, deps))).toMatchObject({ code: "VALIDATION" });
    expect(await errorOf(unuseHost({ id: "mini" }, p.ctx))).toMatchObject({ code: "VALIDATION" });
    expect(await errorOf(hostProjectFor("mini", p.ctx))).toMatchObject({ code: "VALIDATION" });
    expect(commands).toEqual([]);
    expect(await readFile(rcFile(), "utf8")).toBe(before);
  });
});
