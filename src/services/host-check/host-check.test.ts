import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { updateFactorySettings } from "../factory-settings/factory-settings.js";
import type { LocalBuild } from "../host-install/local-build.js";
import { HostAuthFailedError, HostTimeoutError, HostUnreachableError } from "../host-transport/host-errors.js";
import type { RemoteCommand } from "../host-transport/host-transport.js";
import {
  answerFor,
  answerKey,
  type FakeHostAnswers,
  healthyAnswers,
  output,
} from "../test-project/fake-host-answers.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { RC_FILE } from "../user-rc/user-rc.js";
import { CHECK_ITEM_IDS } from "./check-item.js";
import { checkHost, type HostCheckDeps, quickHostCheck, runHostCheck } from "./host-check.js";

const exec = promisify(execFile);
const BUILD: LocalBuild = { id: "0.18.0", version: "0.18.0", released: true };
const CLONE = ".local/share/rowbly/projects/rowbly";

function fakeHost(overrides: FakeHostAnswers = {}, failOn?: { key: string; error: Error }) {
  const commands: RemoteCommand[] = [];
  const answers = { ...healthyAnswers(), ...overrides };
  const transport = createFakeHostTransport({
    bytes: (command) => {
      commands.push(command);
      if (failOn && answerKey(command) === failOn.key) {
        throw failOn.error;
      }
      return answerFor(answers, command);
    },
  });
  return { transport, commands };
}

const withClone: HostCheckDeps = { cloneFor: async () => CLONE, localAhead: async () => 0 };

describe("host check", () => {
  const p = useTestProject();
  const outside = useTempDir();

  const run = (
    overrides: FakeHostAnswers = {},
    deps: HostCheckDeps = withClone,
    ctx = p.ctx,
    failOn?: { key: string; error: Error },
  ) => runHostCheck({ hostId: "mini", transport: fakeHost(overrides, failOn).transport, build: BUILD }, ctx, deps);

  const state = async (overrides: FakeHostAnswers, id: string, deps: HostCheckDeps = withClone) =>
    (await run(overrides, deps)).items.find((item) => item.id === id);

  const useWorkerModel = () =>
    updateFactorySettings({ workerModel: { provider: "anthropic", modelId: "claude-opus-4-5" } }, p.ctx);

  it("gives 13 ok items in order and ready on a healthy host with a clone and a worker model", async () => {
    await useWorkerModel();

    const check = await run();

    expect(check.host).toBe("mini");
    expect(check.ready).toBe(true);
    expect(check.items.map((item) => item.id)).toEqual([...CHECK_ITEM_IDS]);
    expect(check.items.map((item) => item.id)).toHaveLength(13);
    for (const item of check.items) {
      expect(item).toMatchObject({ state: "ok" });
      expect(Object.keys(item).sort()).toEqual(["detail", "id", "label", "state"]);
    }
  });

  it("uses fixed tokens for each remote command and the clone for Git", async () => {
    await useWorkerModel();
    const host = fakeHost();

    await runHostCheck({ hostId: "mini", transport: host.transport, build: BUILD }, p.ctx, withClone);

    expect(host.commands).toContainEqual(["uname", "-s"]);
    expect(host.commands).toContainEqual([
      "env",
      "GIT_TERMINAL_PROMPT=0",
      "git",
      "-C",
      CLONE,
      "push",
      "--dry-run",
      "--no-verify",
      "origin",
      "HEAD:refs/heads/rowbly-push-check",
    ]);
    expect(host.commands).toContainEqual(["git", "-C", CLONE, "config", "--get", "user.email"]);
    expect(host.commands).toContainEqual([
      ".local/share/rowbly/versions/0.18.0/node_modules/.bin/rowbly",
      "--json",
      "auth",
      "status",
    ]);
  });

  it.each([
    ["HOST_AUTH_FAILED", new HostAuthFailedError("SSH authentication to mini failed.", { hint: "Add your key." })],
    ["HOST_UNREACHABLE", new HostUnreachableError("Cannot reach mini: Connection refused.", { hint: "Turn it on." })],
  ])("fails only the ssh item for %s and does not throw", async (_code, error) => {
    const check = await run({}, withClone, p.ctx, { key: "uname", error });

    expect(check.ready).toBe(false);
    expect(check.items[0]).toEqual({
      id: "ssh",
      label: "SSH without a password",
      state: "fail",
      detail: error.message,
      action: error.hint,
    });
    expect(check.items.slice(1).map((item) => item.state)).toEqual(Array(12).fill("skipped"));
  });

  it.each([
    ["linux", { uname: output(0, "Darwin\n") }, "Use a Linux host"],
    ["flock", { flock: output(127, "", "flock: not found") }, "Install flock"],
    ["git", { "git-version": output(127, "", "git: not found") }, "Install Git"],
    ["node", { node: output(127, "", "node: not found") }, "Install Node"],
    ["node", { node: output(0, "v20.11.1\n") }, "Install Node"],
    ["rowbly", { "rowbly-version": output(0, "0.17.0\n") }, "rowbly host add mini"],
    ["rowbly", { "rowbly-version": output(127, "", "not found") }, "rowbly host add mini"],
    [
      "pi-login",
      { "rowbly-auth": output(0, JSON.stringify([{ id: "anthropic", configured: false }])) },
      "rowbly host login mini",
    ],
    [
      "models",
      { "rowbly-model": output(0, JSON.stringify([{ provider: "openai", modelId: "gpt-5" }])) },
      "rowbly host login mini",
    ],
    ["gh", { gh: output(1, "", "You are not logged into any GitHub hosts.") }, "gh auth login"],
    ["git-identity", { "git-config-user.email": output(1, "") }, "git config --global user.email"],
    ["git-push", { "git-push": output(128, "", "remote: Permission denied") }, "write access"],
  ])("fails the %s item with an action", async (id, overrides, action) => {
    await useWorkerModel();

    const check = await run(overrides);
    const item = check.items.find((entry) => entry.id === id);

    expect(check.ready).toBe(false);
    expect(item?.state).toBe("fail");
    expect(item?.action).toContain(action);
  });

  it("skips the Pi items when the Rowbly version or Node fails", async () => {
    await useWorkerModel();

    const cases: FakeHostAnswers[] = [{ "rowbly-version": output(0, "0.17.0\n") }, { node: output(0, "v20.1.0\n") }];

    for (const overrides of cases) {
      const check = await run(overrides);

      expect(
        check.items.filter((item) => item.id === "pi-login" || item.id === "models").map((item) => item.state),
      ).toEqual(["skipped", "skipped"]);
    }
  });

  it("gives a fail with the text for bad JSON, and does not throw", async () => {
    const item = await state({ "rowbly-auth": output(0, "not json") }, "pi-login");

    expect(item).toMatchObject({ state: "fail" });
    expect(item?.detail).toContain("not json");
  });

  it("gives a fail with the error code for a transport error in a later item", async () => {
    const check = await run({}, withClone, p.ctx, {
      key: "gh",
      error: new HostTimeoutError("The call to mini did not complete in 30000 ms."),
    });

    expect(check.items.find((item) => item.id === "gh")).toMatchObject({ state: "fail" });
    expect(check.items.find((item) => item.id === "gh")?.detail).toContain("HOST_TIMEOUT");
    expect(check.items.find((item) => item.id === "git-identity")).toMatchObject({ state: "ok" });
  });

  it("gives a warning without a worker model", async () => {
    expect(await state({}, "models")).toMatchObject({ state: "warning" });
  });

  it("checks the worker model overrides of Stages and Stories", async () => {
    await updateFactorySettings(
      {
        workerModel: { provider: "anthropic", modelId: "claude-opus-4-5" },
        stageWorkerModels: { TODO: { provider: "openai", modelId: "gpt-5" } },
        storyWorkerModels: { "ROW-1": { TODO: { provider: "google", modelId: "gemini" } } },
      },
      p.ctx,
    );

    const item = await state({}, "models");

    expect(item).toMatchObject({ state: "fail", detail: "The host does not have openai/gpt-5, google/gemini" });
  });

  it("gives a warning for local commits that are not on origin", async () => {
    const item = await state({}, "local-ahead", { ...withClone, localAhead: async () => 2 });

    expect(item).toMatchObject({ state: "warning", action: "Push the local commits to origin." });
  });

  it("counts the local commits in a temporary Git repository", async () => {
    const git = (...args: string[]) => exec("git", ["-C", p.paths.root, ...args]);
    const deps = { cloneFor: withClone.cloneFor };

    await git("init", "-q");
    await git("-c", "user.name=T", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one");

    const ahead = await state({}, "local-ahead", deps);

    expect(ahead).toMatchObject({ state: "warning" });
    expect(ahead?.detail).toContain("1 local commit(s)");

    await git("update-ref", "refs/remotes/origin/main", "HEAD");

    expect(await state({}, "local-ahead", deps)).toMatchObject({ state: "ok" });
  });

  it("skips the Project items outside a Project", async () => {
    const check = await run({}, withClone, { home: p.ctx.home, cwd: outside.path });
    const skippedIds = check.items.filter((item) => item.state === "skipped").map((item) => item.id);

    expect(skippedIds).toEqual(["models", "clone", "git-push", "local-ahead"]);
    expect(check.items.find((item) => item.id === "clone")?.detail).toBe("Not in a Rowbly Project.");
    expect(check.ready).toBe(true);
  });

  describe("the clone finder of rowbly host use", () => {
    const REPO = "/srv/rowbly";
    const writeHost = (projects: unknown[]) =>
      writeFile(
        join(p.ctx.home as string, RC_FILE),
        JSON.stringify({ hosts: [{ id: "mini", ssh: "u@mini", maxWorkers: 1, enabled: true, projects }] }),
      );
    const useOrigin = async () => {
      await exec("git", ["init", "-q", p.paths.root]);
      await exec("git", ["-C", p.paths.root, "remote", "add", "origin", "git@github.com:o/r.git"]);
    };
    const cloneOn = (origin: string): FakeHostAnswers => ({
      test: output(0, ""),
      "git-rev-parse": output(0, "true\n"),
      "git-remote": output(0, `${origin}\n`),
    });
    const items = async (overrides: FakeHostAnswers) => {
      const check = await run(overrides, { localAhead: async () => 0 });

      return {
        clone: check.items.find((item) => item.id === "clone"),
        push: check.items.find((item) => item.id === "git-push"),
      };
    };

    it("fails the clone, and skips git-push with the action, when the host does not use the Project", async () => {
      await writeHost([]);

      const { clone, push } = await items({});

      expect(clone).toMatchObject({ state: "fail", action: "Run rowbly host use mini." });
      expect(push).toMatchObject({ state: "skipped", action: "Run rowbly host use mini." });
    });

    it("gives the recorded clone when its origin is the same repository", async () => {
      await useOrigin();
      await writeHost([{ root: p.paths.root, path: REPO, managed: false }]);

      const { clone, push } = await items(cloneOn("https://github.com/o/r.git"));

      expect(clone).toMatchObject({ state: "ok", detail: REPO });
      expect(push).toMatchObject({ state: "ok" });
    });

    it("fails the clone when the recorded folder is missing", async () => {
      await useOrigin();
      await writeHost([{ root: p.paths.root, path: REPO, managed: false }]);

      const { clone } = await items({ test: output(1, "") });

      expect(clone).toMatchObject({ state: "fail", action: "Run rowbly host use mini." });
    });

    it("fails the clone with VALIDATION when the folder has a different repository", async () => {
      await useOrigin();
      await writeHost([{ root: p.paths.root, path: REPO, managed: false }]);

      const { clone } = await items(cloneOn("git@github.com:o/other.git"));

      expect(clone).toMatchObject({ state: "fail", action: "Run rowbly host unuse mini, then rowbly host use mini." });
      expect(clone?.detail).toContain("VALIDATION");
    });
  });

  it("fails the clone item and skips git-push when the host has no clone", async () => {
    const check = await run({}, { cloneFor: async () => undefined, localAhead: async () => 0 });

    expect(check.items.find((item) => item.id === "clone")).toMatchObject({ state: "fail" });
    expect(check.items.find((item) => item.id === "git-push")).toMatchObject({
      state: "skipped",
      action: "Run rowbly host use mini.",
    });
  });

  it("reads the identity from the global config without a clone", async () => {
    const host = fakeHost();

    await runHostCheck({ hostId: "mini", transport: host.transport, build: BUILD }, p.ctx, {
      localAhead: async () => 0,
    });

    expect(host.commands).toContainEqual(["git", "config", "--get", "user.name"]);
  });

  it("finds the host in ~/.rowblyrc.json, and gives NOT_FOUND for an unknown host", async () => {
    const targets: string[] = [];
    const deps: HostCheckDeps = {
      ...withClone,
      transportFor: (target) => {
        targets.push(target);
        return fakeHost().transport;
      },
      build: async () => BUILD,
    };

    await writeFile(
      join(p.ctx.home as string, RC_FILE),
      JSON.stringify({ hosts: [{ id: "mini", ssh: "u@mini", maxWorkers: 1, enabled: true }] }),
    );

    expect((await checkHost({ id: "mini" }, p.ctx, deps)).host).toBe("mini");
    expect(targets).toEqual(["u@mini"]);
    await expect(checkHost({ id: "other" }, p.ctx, deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  const rcFile = () => join(p.ctx.home as string, RC_FILE);
  const project = { root: "/work/rowbly", path: CLONE, managed: true };
  const hostDeps = (overrides: FakeHostAnswers = {}): HostCheckDeps => ({
    ...withClone,
    transportFor: () => fakeHost(overrides).transport,
    build: async () => BUILD,
  });

  it("records the lastCheck of the host after the check and keeps all other keys", async () => {
    const now = new Date("2026-11-16T10:00:00.000Z");
    const file = {
      theme: "dark",
      hosts: [
        { id: "mini", ssh: "u@mini", maxWorkers: 2, enabled: false, projects: [project], note: "kept" },
        { id: "box", ssh: "box", maxWorkers: 1, enabled: true },
      ],
    };
    await writeFile(rcFile(), JSON.stringify(file));

    const check = await checkHost({ id: "mini" }, { ...p.ctx, now: () => now }, hostDeps({ gh: output(1, "", "no") }));

    const failed = check.items.filter((entry) => entry.state === "fail").map((entry) => entry.id);
    expect(failed).toContain("gh");
    expect(JSON.parse(await readFile(rcFile(), "utf8"))).toEqual({
      ...file,
      hosts: [{ ...file.hosts[0], lastCheck: { at: "2026-11-16T10:00:00.000Z", ready: false, failed } }, file.hosts[1]],
    });
  });

  it("replaces the lastCheck at the next check", async () => {
    const old = { at: "2020-01-01T00:00:00.000Z", ready: false, failed: ["gh"] };
    await writeFile(
      rcFile(),
      JSON.stringify({ hosts: [{ id: "mini", ssh: "u@mini", maxWorkers: 1, enabled: true, lastCheck: old }] }),
    );
    await useWorkerModelFor(p.ctx);

    const check = await checkHost({ id: "mini" }, p.ctx, hostDeps());

    expect(check.ready).toBe(true);
    const stored = JSON.parse(await readFile(rcFile(), "utf8"));
    expect(stored.hosts[0].lastCheck).toEqual({ at: expect.any(String), ready: true, failed: [] });
    expect(stored.hosts[0].lastCheck.at).not.toBe(old.at);
  });

  it("does not write and does not fail when the host was removed during the check", async () => {
    await writeFile(rcFile(), JSON.stringify({ hosts: [{ id: "mini", ssh: "u@mini", maxWorkers: 1, enabled: true }] }));
    const deps: HostCheckDeps = {
      ...hostDeps(),
      cloneFor: async () => {
        await writeFile(rcFile(), JSON.stringify({ hosts: [] }));
        return CLONE;
      },
    };

    await expect(checkHost({ id: "mini" }, p.ctx, deps)).resolves.toMatchObject({ host: "mini" });
    expect(await readFile(rcFile(), "utf8")).toBe(JSON.stringify({ hosts: [] }));
  });

  it("gives VALIDATION for a host with an invalid lastCheck and keeps the bytes", async () => {
    const text = JSON.stringify({
      hosts: [
        { id: "mini", ssh: "u@mini", maxWorkers: 1, enabled: true, lastCheck: { at: 1, ready: true, failed: [] } },
      ],
    });
    await writeFile(rcFile(), text);

    await expect(checkHost({ id: "mini" }, p.ctx, hostDeps())).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await readFile(rcFile(), "utf8")).toBe(text);
  });
});

function useWorkerModelFor(ctx: Parameters<typeof updateFactorySettings>[1]) {
  return updateFactorySettings({ workerModel: { provider: "anthropic", modelId: "claude-opus-4-5" } }, ctx);
}

describe("quick host check", () => {
  const quick = (overrides: FakeHostAnswers = {}, failOn?: { key: string; error: Error }) => {
    const host = fakeHost(overrides, failOn);
    return { host, result: quickHostCheck(host.transport, BUILD) };
  };

  it("is ready and gives the configured providers", async () => {
    const { host, result } = quick({
      "rowbly-auth": output(
        0,
        JSON.stringify([
          { id: "anthropic", configured: true },
          { id: "openai", configured: false },
          { id: "google", configured: true },
        ]),
      ),
    });

    expect(await result).toEqual({ ready: true, providers: ["anthropic", "google"], problems: [] });
    expect(host.commands.map(answerKey)).toEqual(["rowbly-version", "rowbly-auth"]);
  });

  it("is not ready for an SSH error", async () => {
    const error = new HostUnreachableError("Cannot reach mini: Connection refused.");

    expect(await quick({}, { key: "rowbly-version", error }).result).toEqual({
      ready: false,
      providers: [],
      problems: ["Cannot reach mini: Connection refused."],
    });
  });

  it("is not ready for a different Rowbly version, and does not install", async () => {
    const { host, result } = quick({ "rowbly-version": output(0, "0.17.0\n") });

    expect(await result).toMatchObject({ ready: false, providers: [] });
    expect((await result).problems[0]).toContain("0.17.0");
    expect(host.commands.map(answerKey)).toEqual(["rowbly-version"]);
    expect(host.transport.uploads).toEqual([]);
  });

  it("is not ready without a configured provider", async () => {
    const { result } = quick({ "rowbly-auth": output(0, JSON.stringify([{ id: "anthropic", configured: false }])) });

    expect(await result).toEqual({
      ready: false,
      providers: [],
      problems: ["Pi has no configured provider on the host."],
    });
  });
});
