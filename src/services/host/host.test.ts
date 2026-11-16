import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LocalBuild } from "../host-install/local-build.js";
import type { BytesResult, RemoteCommand } from "../host-transport/host-transport.js";
import { recordProject } from "../known-project/known-project.js";
import { answerFor, healthyAnswers } from "../test-project/fake-host-answers.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, transitionThread } from "../thread/thread.js";
import type { ThreadStatus } from "../thread/thread-types.js";
import { RC_FILE } from "../user-rc/user-rc.js";
import { type AddHostDeps, addHost, type HostInput, listHosts, removeHost, updateHost } from "./host.js";

const BUILD: LocalBuild = { id: "0.18.0", version: "0.18.0", released: true };

const output = (exitCode: number, text: string, stderr = ""): BytesResult => ({
  exitCode,
  bytes: Buffer.from(text),
  stderr,
});

/** A fake host with Node and the same Rowbly build. A test can change the answer of each program. */
function fakeDeps(answers: Record<string, BytesResult> = {}, installWorks = false) {
  const commands: RemoteCommand[] = [];
  const state = { installed: false };
  const targets: string[] = [];
  const transport = createFakeHostTransport({
    bytes: (command) => {
      commands.push(command);
      const isVersion = command[0]?.endsWith("/rowbly") === true && command[1] === "--version";
      if (command[0] !== "node" && command[0] !== "npm" && !isVersion) {
        return answerFor(healthyAnswers(), command);
      }
      const program = command[0] === "node" || command[0] === "npm" ? command[0] : "rowbly";
      if (program === "npm" && installWorks) {
        state.installed = true;
      }
      const answer = state.installed && program === "rowbly" ? undefined : answers[program];
      return answer ?? output(0, program === "node" ? "v22.19.0\n" : "0.18.0\n");
    },
  });
  const deps: AddHostDeps = {
    transportFor: (target) => {
      targets.push(target);
      return transport;
    },
    build: async () => BUILD,
    cloneFor: async () => "/srv/rowbly",
    localAhead: async () => 0,
  };
  return { deps, commands, targets };
}

describe("host", () => {
  const p = useTestProject();
  const rcFile = () => join(p.ctx.home as string, RC_FILE);
  const stored = async () => JSON.parse(await readFile(rcFile(), "utf8"));
  const mini = { id: "mini", ssh: "user@mini.lan", maxWorkers: 2 };
  const checked = (ready: boolean, failed: string[] = []) => ({ at: expect.any(String), ready, failed });

  const add = (input: HostInput, ctx = p.ctx, deps: AddHostDeps = fakeDeps().deps) => addHost(input, ctx, deps);

  const errorCode = (promise: Promise<unknown>) =>
    promise.then(
      () => "OK",
      (error: { code?: string }) => error.code,
    );

  it("adds a host to the hosts array of the file and gives it back", async () => {
    const { deps, commands, targets } = fakeDeps();
    const host = await add(mini, p.ctx, deps);

    expect(host).toEqual({
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
    expect(targets).toEqual(["user@mini.lan"]);
    expect(commands.slice(0, 2).map((command) => command[0])).toEqual(["node", host.install.remoteExecutable]);
    expect(commands.slice(2).some((command) => command[0] === "npm")).toBe(false);
    expect((await stored()).hosts).toEqual([
      { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true, lastCheck: checked(true) },
    ]);
  });

  it("installs the build on a host without Rowbly before it records the host", async () => {
    const { deps, commands } = fakeDeps({ rowbly: output(127, "", "not found") }, true);

    const host = await add(mini, p.ctx, deps);

    expect(host.install).toMatchObject({ state: "ready", installed: true });
    expect(commands.filter((command) => command[0] === "npm")).toEqual([
      ["npm", "install", "--prefix", ".local/share/rowbly/versions/0.18.0", "--no-save", "--omit=dev", "rowbly@0.18.0"],
    ]);
    expect((await stored()).hosts).toEqual([{ ...mini, enabled: true, lastCheck: checked(true) }]);
  });

  it("gives the check after the install, and records the host when items fail", async () => {
    const answers = healthyAnswers();
    const transport = createFakeHostTransport({
      bytes: (command) =>
        command[0] === "gh"
          ? { exitCode: 1, bytes: Buffer.alloc(0), stderr: "not logged in" }
          : answerFor(answers, command),
    });
    const deps: AddHostDeps = { transportFor: () => transport, build: async () => BUILD, localAhead: async () => 0 };

    const host = await add(mini, p.ctx, deps);

    expect(host.check.ready).toBe(false);
    expect(host.check.items.map((item) => item.id)).toHaveLength(13);
    expect(host.check.items.find((item) => item.id === "gh")).toMatchObject({
      state: "fail",
      action: "Run gh auth login on the host.",
    });
    expect(transport.uploads).toEqual([]);
    expect((await stored()).hosts).toEqual([{ ...mini, enabled: true, lastCheck: checked(false, ["clone", "gh"]) }]);
  });

  it.each([
    ["a missing Node", { node: output(127, "", "node: not found") }, "HOST_NODE_MISSING"],
    ["an old Node", { node: output(0, "v20.11.1\n") }, "HOST_NODE_TOO_OLD"],
    ["a failed install", { rowbly: output(127, ""), npm: output(1, "", "npm ERR! network") }, "HOST_INSTALL_FAILED"],
    ["an install with a different version", { rowbly: output(0, "0.17.0\n") }, "HOST_INSTALL_FAILED"],
  ])("fails with %s and keeps the bytes of the file", async (_name, answers, code) => {
    const text = JSON.stringify({ deviceId: "device", hosts: [] }, null, 4);

    await writeFile(rcFile(), text);

    const error = await add(mini, p.ctx, fakeDeps(answers).deps).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code });
    expect(await readFile(rcFile(), "utf8")).toBe(text);
  });

  it("gives the install result in the details of HOST_INSTALL_FAILED", async () => {
    const answers = { rowbly: output(127, ""), npm: output(1, "", "npm ERR! network") };
    const error = await add(mini, p.ctx, fakeDeps(answers).deps).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "HOST_INSTALL_FAILED",
      details: { install: { state: "version-mismatch", localVersion: "0.18.0", stderr: "npm ERR! network" } },
    });
  });

  it("lists the hosts in the order of the file, and an empty list without the key", async () => {
    expect(await listHosts(p.ctx)).toEqual([]);

    await add({ id: "zeta", ssh: "z", maxWorkers: 1 }, p.ctx);
    await add({ id: "alpha", ssh: "a", maxWorkers: 3 }, p.ctx);

    expect((await listHosts(p.ctx)).map((host) => host.id)).toEqual(["zeta", "alpha"]);
  });

  it("keeps the other keys of the file and the other keys of an entry", async () => {
    await writeFile(
      rcFile(),
      JSON.stringify({
        deviceId: "device",
        projects: [{ path: "/a", name: "A" }],
        hosts: [{ id: "old", ssh: "o", maxWorkers: 1, enabled: false, later: "kept" }],
      }),
    );

    await add(mini, p.ctx);

    expect(await stored()).toEqual({
      deviceId: "device",
      projects: [{ path: "/a", name: "A" }],
      hosts: [
        { id: "old", ssh: "o", maxWorkers: 1, enabled: false, later: "kept" },
        { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true, lastCheck: checked(true) },
      ],
    });
    expect(await listHosts(p.ctx)).toEqual([
      { id: "old", ssh: "o", maxWorkers: 1, enabled: false },
      { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true },
    ]);

    await removeHost({ id: "old" }, p.ctx);

    expect(await stored()).toEqual({
      deviceId: "device",
      projects: [{ path: "/a", name: "A" }],
      hosts: [{ id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true, lastCheck: checked(true) }],
    });
  });

  it.each([
    ["an ID that is not dash-case", { id: "Mini", ssh: "u@h", maxWorkers: 1 }, "id"],
    ["an ID with a double dash", { id: "a--b", ssh: "u@h", maxWorkers: 1 }, "id"],
    ["an ID with a trailing dash", { id: "mini-", ssh: "u@h", maxWorkers: 1 }, "id"],
    ["an empty ID", { id: "", ssh: "u@h", maxWorkers: 1 }, "id"],
    ["the reserved ID local", { id: "local", ssh: "u@h", maxWorkers: 1 }, "id"],
    ["an empty SSH target", { id: "mini", ssh: "", maxWorkers: 1 }, "ssh"],
    ["an SSH target that starts with -", { id: "mini", ssh: "-oProxyCommand=x", maxWorkers: 1 }, "ssh"],
    ["an SSH target with a space", { id: "mini", ssh: "user@mini lan", maxWorkers: 1 }, "ssh"],
    ["an SSH target with a tab", { id: "mini", ssh: "user@mini\tlan", maxWorkers: 1 }, "ssh"],
    ["an SSH target with a newline", { id: "mini", ssh: "user@mini\n", maxWorkers: 1 }, "ssh"],
    ["an SSH target with a control character", { id: "mini", ssh: "user@mini\u0007", maxWorkers: 1 }, "ssh"],
    ["a worker limit of 0", { id: "mini", ssh: "u@h", maxWorkers: 0 }, "maxWorkers"],
    ["a negative worker limit", { id: "mini", ssh: "u@h", maxWorkers: -1 }, "maxWorkers"],
    ["a worker limit that is not an integer", { id: "mini", ssh: "u@h", maxWorkers: 1.5 }, "maxWorkers"],
    ["a worker limit that is not a number", { id: "mini", ssh: "u@h", maxWorkers: Number.NaN }, "maxWorkers"],
  ])("refuses %s with VALIDATION and writes nothing", async (_name, input, field) => {
    const { deps, targets } = fakeDeps();
    const error = await add(input, p.ctx, deps).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "VALIDATION", details: { issues: [{ path: [field] }] } });
    expect(targets).toEqual([]);
    expect(await listHosts(p.ctx)).toEqual([]);
  });

  it("gives CONFLICT for an ID that exists and NOT_FOUND for an unknown ID", async () => {
    await add(mini, p.ctx);

    expect(await errorCode(add({ ...mini, ssh: "other" }, p.ctx))).toBe("CONFLICT");
    expect(await errorCode(removeHost({ id: "nope" }, p.ctx))).toBe("NOT_FOUND");
    expect(await listHosts(p.ctx)).toEqual([{ ...mini, enabled: true }]);
  });

  it("removes a host and gives it back with purge", async () => {
    await add(mini, p.ctx);
    await add({ id: "other", ssh: "o", maxWorkers: 1 }, p.ctx);

    expect(await removeHost({ id: "mini" }, p.ctx)).toEqual({ ...mini, enabled: true, purge: false });
    expect(await removeHost({ id: "other", purge: true }, p.ctx)).toEqual({
      id: "other",
      ssh: "o",
      maxWorkers: 1,
      enabled: true,
      purge: true,
    });
    expect((await stored()).hosts).toEqual([]);
  });

  const worker = (host: string) =>
    createThread(
      { role: "worker", storyId: "ROW-01", stage: "DEV", cwd: p.paths.root, ownerToken: "owner", host },
      p.ctx,
    );

  it.each(["pending", "running"] as ThreadStatus[])(
    "refuses to remove a host with a %s Thread in a known Project",
    async (status) => {
      await add(mini, p.ctx);
      await recordProject({ path: p.paths.root, name: "Rowbly" }, p.ctx);
      const thread = await worker("mini");

      if (status === "running") {
        await transitionThread(thread.id, { expectedRevision: 1, status }, p.ctx);
      }

      const error = await removeHost({ id: "mini" }, p.ctx).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: "CONFLICT",
        details: { threads: [{ project: p.paths.root, id: thread.id }] },
      });
      expect(await listHosts(p.ctx)).toEqual([{ ...mini, enabled: true }]);
    },
  );

  it("removes a host when its Threads ended, or when the active Threads are on other hosts", async () => {
    await add(mini, p.ctx);
    await recordProject({ path: p.paths.root, name: "Rowbly" }, p.ctx);
    await recordProject({ path: join(p.paths.root, "gone"), name: "Gone" }, p.ctx);
    const done = await worker("mini");

    await transitionThread(done.id, { expectedRevision: 1, status: "completed" }, p.ctx);
    await worker("other");
    await worker("local");

    expect(await removeHost({ id: "mini" }, p.ctx)).toMatchObject({ id: "mini", purge: false });
  });

  it.each([
    ["invalid JSON", "{ not json"],
    ["a value that is not an object", "[]"],
    ["a hosts value that is not an array", JSON.stringify({ hosts: {} })],
    ["a host without a field", JSON.stringify({ hosts: [{ id: "mini", ssh: "u@h", maxWorkers: 1 }] })],
    [
      "a host with a field of the wrong type",
      JSON.stringify({ hosts: [{ id: "mini", ssh: "u@h", maxWorkers: "1", enabled: true }] }),
    ],
    [
      "a host with a lastCheck that is not an object",
      JSON.stringify({ hosts: [{ id: "mini", ssh: "u@h", maxWorkers: 1, enabled: true, lastCheck: "yes" }] }),
    ],
    [
      "a host with a lastCheck without failed IDs",
      JSON.stringify({
        hosts: [{ id: "mini", ssh: "u@h", maxWorkers: 1, enabled: true, lastCheck: { at: "x", ready: true } }],
      }),
    ],
  ])("fails each command with VALIDATION for %s and keeps the bytes", async (_name, text) => {
    await writeFile(rcFile(), text);

    expect(await errorCode(listHosts(p.ctx))).toBe("VALIDATION");
    expect(await errorCode(add(mini, p.ctx))).toBe("VALIDATION");
    expect(await errorCode(removeHost({ id: "mini" }, p.ctx))).toBe("VALIDATION");
    expect(await errorCode(updateHost({ id: "mini", maxWorkers: 3 }, p.ctx))).toBe("VALIDATION");
    expect(await readFile(rcFile(), "utf8")).toBe(text);
  });

  describe("updateHost", () => {
    const lastCheck = { at: "2026-11-16T10:00:00.000Z", ready: false, failed: ["gh"] };
    const project = { root: "/work/rowbly", path: ".local/share/rowbly/projects/rowbly", managed: true };
    const fileWithHost = () => ({
      projects: [{ path: "/work/rowbly" }],
      theme: "dark",
      hosts: [
        { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true, projects: [project], lastCheck, note: "x" },
        { id: "box", ssh: "box", maxWorkers: 1, enabled: true },
      ],
    });

    it("writes a new worker limit and keeps the other keys of the entry and the file", async () => {
      await writeFile(rcFile(), JSON.stringify(fileWithHost()));

      const host = await updateHost({ id: "mini", maxWorkers: 3 }, p.ctx);

      expect(host).toEqual({ id: "mini", ssh: "user@mini.lan", maxWorkers: 3, enabled: true });
      const expected = fileWithHost();
      expect(await stored()).toEqual({
        ...expected,
        hosts: [{ ...expected.hosts[0], maxWorkers: 3 }, expected.hosts[1]],
      });
    });

    it("writes enabled false and true", async () => {
      await writeFile(rcFile(), JSON.stringify(fileWithHost()));

      expect(await updateHost({ id: "mini", enabled: false }, p.ctx)).toMatchObject({ enabled: false });
      expect((await stored()).hosts[0]).toMatchObject({
        enabled: false,
        maxWorkers: 2,
        lastCheck,
        projects: [project],
      });
      expect(await updateHost({ id: "mini", enabled: true, maxWorkers: 4 }, p.ctx)).toMatchObject({
        enabled: true,
        maxWorkers: 4,
      });
    });

    it.each([
      ["a worker limit of 0", { maxWorkers: 0 }],
      ["a worker limit that is not an integer", { maxWorkers: 1.5 }],
      ["a worker limit that is not a number", { maxWorkers: Number.NaN }],
      ["no change", {}],
    ])("gives VALIDATION for %s and keeps the bytes", async (_name, change) => {
      const text = JSON.stringify(fileWithHost());
      await writeFile(rcFile(), text);

      expect(await errorCode(updateHost({ id: "mini", ...change }, p.ctx))).toBe("VALIDATION");
      expect(await readFile(rcFile(), "utf8")).toBe(text);
    });

    it("gives NOT_FOUND for an unknown ID", async () => {
      await writeFile(rcFile(), JSON.stringify(fileWithHost()));

      expect(await errorCode(updateHost({ id: "gone", maxWorkers: 3 }, p.ctx))).toBe("NOT_FOUND");
    });

    it("keeps the shape of listHosts with a lastCheck in the file", async () => {
      await writeFile(rcFile(), JSON.stringify(fileWithHost()));

      expect(await listHosts(p.ctx)).toEqual([
        { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true },
        { id: "box", ssh: "box", maxWorkers: 1, enabled: true },
      ]);
    });
  });
});
