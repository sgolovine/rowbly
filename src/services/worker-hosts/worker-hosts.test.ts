import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConflictError } from "../errors/errors.js";
import { remoteRowblyPath } from "../host-install/host-install.js";
import type { LocalBuild } from "../host-install/local-build.js";
import type { BytesResult, HostTransport, RemoteCommand } from "../host-transport/host-transport.js";
import {
  answerFor,
  answerKey,
  type FakeHostAnswers,
  healthyAnswers,
  output,
} from "../test-project/fake-host-answers.js";
import { createFakeHostTransport, type FakeHostTransport } from "../test-project/fake-host-transport.js";
import { useTestProject } from "../test-project/test-project.js";
import { RC_FILE } from "../user-rc/user-rc.js";
import { createWorkerHostSource, type WorkerHostDeps } from "./worker-hosts.js";

const BUILD: LocalBuild = { id: "0.18.0", version: "0.18.0", released: true };
const CLONE = ".local/share/rowbly/projects/rowbly";

interface FakeHost {
  readonly transport: FakeHostTransport;
  readonly commands: RemoteCommand[];
  answers: FakeHostAnswers;
}

function fakeHost(answers: FakeHostAnswers = healthyAnswers(), onBytes?: (key: string, host: FakeHost) => void) {
  const host: FakeHost = {
    commands: [],
    answers,
    transport: createFakeHostTransport({
      bytes: (command): BytesResult => {
        host.commands.push(command);
        onBytes?.(answerKey(command), host);
        return answerFor(host.answers, command);
      },
    }),
  };
  return host;
}

/** A host whose npm install gives the version of the build. */
function outdatedHost(installWorks: boolean): FakeHost {
  return fakeHost({ ...healthyAnswers(), "rowbly-version": output(0, "0.17.0\n") }, (key, host) => {
    if (key === "npm" && installWorks) {
      host.answers = healthyAnswers();
    }
    if (key === "npm" && !installWorks) {
      host.answers = { ...host.answers, npm: output(1, "", "npm failed") };
    }
  });
}

describe("worker hosts", () => {
  const p = useTestProject();
  const clock = { at: new Date("2026-11-16T10:00:00.000Z").getTime() };

  const writeHosts = (hosts: unknown[]) =>
    writeFile(join(p.ctx.home as string, RC_FILE), JSON.stringify({ deviceId: "device", hosts }, null, 2));
  const used = (id: string, enabled = true, maxWorkers = 2) => ({
    id,
    ssh: `user@${id}.lan`,
    maxWorkers,
    enabled,
    projects: [{ root: p.paths.root, path: CLONE, managed: true }],
  });

  const source = (transports: Record<string, HostTransport>, extra: WorkerHostDeps = {}) => {
    const calls = { build: 0, transports: [] as string[] };
    const hosts = createWorkerHostSource(p.ctx, {
      transportFor: (target) => {
        calls.transports.push(target);
        const transport = transports[target];
        if (!transport) {
          throw new Error(`No fake transport for ${target}`);
        }
        return transport;
      },
      build: async () => {
        calls.build += 1;
        return BUILD;
      },
      now: () => new Date(clock.at),
      ...extra,
    });
    return { hosts, calls };
  };

  it("gives only the hosts that are on and that the Project uses, with the limit of the registry", async () => {
    const on = fakeHost();
    await writeHosts([
      used("mini", true, 3),
      used("off", false),
      { id: "other", ssh: "user@other.lan", maxWorkers: 1, enabled: true },
    ]);
    const { hosts } = source({ "user@mini.lan": on.transport });

    const views = await hosts.workerHosts();
    await hosts.settled();

    expect(views).toEqual([{ id: "mini", maxWorkers: 3, state: "not-ready" }]);
  });

  it("is not-ready before the first check, and connected with its providers after it", async () => {
    const mini = fakeHost();
    await writeHosts([used("mini")]);
    const { hosts } = source({ "user@mini.lan": mini.transport });

    expect(await hosts.workerHosts()).toEqual([{ id: "mini", maxWorkers: 2, state: "not-ready" }]);
    await hosts.settled();

    expect(await hosts.workerHosts()).toEqual([
      { id: "mini", maxWorkers: 2, state: "connected", providers: ["anthropic"] },
    ]);
    expect(mini.commands.map(answerKey)).not.toContain("npm");
  });

  it("installs a different version, and is connected when the install succeeds", async () => {
    const mini = outdatedHost(true);
    await writeHosts([used("mini")]);
    const { hosts } = source({ "user@mini.lan": mini.transport });

    await hosts.workerHosts();
    await hosts.settled();

    expect(mini.commands.map(answerKey)).toContain("npm");
    expect((await hosts.workerHosts())[0]?.state).toBe("connected");
  });

  it("is version-mismatch when the version stays different after the install", async () => {
    const mini = outdatedHost(false);
    await writeHosts([used("mini")]);
    const { hosts } = source({ "user@mini.lan": mini.transport });

    await hosts.workerHosts();
    await hosts.settled();

    expect(mini.commands.map(answerKey)).toContain("npm");
    expect(await hosts.workerHosts()).toEqual([{ id: "mini", maxWorkers: 2, state: "version-mismatch" }]);
  });

  it("is disconnected when the transport cannot connect, and does not throw", async () => {
    const mini = fakeHost();
    mini.transport.disconnect();
    await writeHosts([used("mini")]);
    const { hosts } = source({ "user@mini.lan": mini.transport });

    await hosts.workerHosts();
    await hosts.settled();

    expect(await hosts.workerHosts()).toEqual([{ id: "mini", maxWorkers: 2, state: "disconnected" }]);
  });

  it("starts one check in the interval, and a new check after it", async () => {
    const mini = fakeHost();
    await writeHosts([used("mini")]);
    const { hosts } = source({ "user@mini.lan": mini.transport }, { checkIntervalMs: 60_000 });
    const versionChecks = () => mini.commands.filter((command) => answerKey(command) === "node").length;

    await hosts.workerHosts();
    await hosts.workerHosts();
    await hosts.settled();
    await hosts.workerHosts();
    await hosts.settled();

    expect(versionChecks()).toBe(1);

    clock.at += 60_000;
    await hosts.workerHosts();
    await hosts.settled();

    expect(versionChecks()).toBe(2);
  });

  it("checks a host again when it is on again", async () => {
    const mini = fakeHost();
    await writeHosts([used("mini")]);
    const { hosts } = source({ "user@mini.lan": mini.transport });
    const checks = () => mini.commands.filter((command) => answerKey(command) === "node").length;

    await hosts.workerHosts();
    await hosts.settled();
    await writeHosts([used("mini", false)]);
    expect(await hosts.workerHosts()).toEqual([]);
    await writeHosts([used("mini")]);

    expect(await hosts.workerHosts()).toEqual([{ id: "mini", maxWorkers: 2, state: "not-ready" }]);
    await hosts.settled();
    expect(checks()).toBe(2);
  });

  it("gives the connection of a host, also when it is off", async () => {
    const mini = fakeHost();
    await writeHosts([used("mini", false), { id: "other", ssh: "user@other.lan", maxWorkers: 1, enabled: true }]);
    const { hosts, calls } = source({ "user@mini.lan": mini.transport });

    const first = await hosts.hostConnection("mini");
    const second = await hosts.hostConnection("mini");

    expect(first.rowbly).toBe(remoteRowblyPath(BUILD.id));
    expect(first.clone).toBe(CLONE);
    expect(first.transport).toBe(mini.transport);
    expect(second.transport).toBe(first.transport);
    expect(calls.transports).toEqual(["user@mini.lan"]);
    expect(calls.build).toBe(1);
    await expect(hosts.hostConnection("unknown")).rejects.toBeInstanceOf(ConflictError);
    await expect(hosts.hostConnection("other")).rejects.toBeInstanceOf(ConflictError);
  });

  it("gives no hosts and gets no build or transport when the registry is empty", async () => {
    const { hosts, calls } = source({});

    expect(await hosts.workerHosts()).toEqual([]);
    await writeHosts([]);
    expect(await hosts.workerHosts()).toEqual([]);
    await hosts.settled();

    expect(calls.build).toBe(0);
    expect(calls.transports).toEqual([]);
  });

  it("checks two hosts in parallel with one build", async () => {
    const mini = fakeHost();
    const max = fakeHost();
    await writeHosts([used("mini"), used("max")]);
    const { hosts, calls } = source({ "user@mini.lan": mini.transport, "user@max.lan": max.transport });

    await hosts.workerHosts();
    await hosts.settled();

    expect((await hosts.workerHosts()).map((view) => view.state)).toEqual(["connected", "connected"]);
    expect(calls.build).toBe(1);
  });
});
