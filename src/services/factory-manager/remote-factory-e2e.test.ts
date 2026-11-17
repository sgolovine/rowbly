// End-to-end tests of the remote factory: the factory manager on the main machine with a faux Pi provider, and one or
// two in-process worker hosts with the real host services behind the fake transport. No case uses SSH, a network or
// live credentials.
//
// The disconnect and the reconnect during a run (each outbox `seq` is applied one time, and the Thread completes one
// time) are in `remote-reconnect.test.ts`: "completes the Thread one time after a cut at the step %s and a reconnect".

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type FauxResponseFactory,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCliShim } from "../../commands/factory-runner/cli-shim.js";
import { createCliShim } from "../../commands/factory-runner/factory-runner.js";
import { addAttachment, listAttachments } from "../attachment/attachment.js";
import { type Attachment, attachmentDir } from "../attachment-files/attachment-files.js";
import { attachmentFileName } from "../attachment-files/attachment-type.js";
import { getFactorySettings, updateFactorySettings } from "../factory-settings/factory-settings.js";
import { DEFAULT_COMMIT_MESSAGE } from "../factory-settings/git-settings.js";
import type { PlacementPolicy } from "../factory-settings/placement-settings.js";
import { updateFactoryState } from "../factory-state/factory-state.js";
import { hostCacheMissing } from "../host-agent/host-agent-cache.js";
import { hostAgentPaths, threadPaths } from "../host-agent/host-agent-paths.js";
import { readHostRun } from "../host-agent/host-run-state.js";
import { createHostRunner } from "../host-agent/host-runner.js";
import { hostProjectId } from "../host-project/host-paths.js";
import type { HostTransport } from "../host-transport/host-transport.js";
import { readOutboxEntries } from "../outbox/outbox-file.js";
import { heldAction } from "../outbox-apply/held-actions.js";
import { readHeldEntries } from "../outbox-apply/held-entries.js";
import { readAppliedSeq } from "../outbox-apply/host-files.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { commitCanonicalProject } from "../project-write/project-write.js";
import { createStage } from "../stage/stage.js";
import { createStory, getStory, updateStory } from "../story/story.js";
import { promptHash } from "../supervisor-digest/supervisor-digest.js";
import { createFakeHostAgent, type FakeHostAgent } from "../test-project/fake-host-agent.js";
import { useTempDir } from "../test-project/test-project.js";
import { getThread, type ThreadRecord } from "../thread/thread.js";
import { findProject } from "../workspace/workspace.js";
import { createFactoryManager, type FactoryManager } from "./factory-manager.js";

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]) => exec("git", ["-C", cwd, ...args]);
const PROMPT = "Do the work of this Story. Report complete.";
const CLONE = ".local/share/rowbly/projects/remote/repo";
const ROWBLY = "/opt/rowbly/bin/rowbly";
const LAUNCH = {
  executable: process.execPath,
  execArgv: ["--import", resolve("node_modules/tsx/dist/loader.mjs")],
  entry: resolve("src/cli.ts"),
};
const CANONICAL_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
const WORKER_PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000020806000000f478d4fa", "hex");
const TIMEOUT = { timeout: 45_000, interval: 50 };

const tool = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
const rowbly = (args: string) => tool("bash", { command: `rowbly -C "$ROWBLY_ROOT" --json ${args}` });
const report = (summary: string) => tool("report_result", { outcome: "complete", summary, blockers: [], problems: [] });
const DONE = fauxAssistantMessage("Done");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** A response that waits until the session aborts. */
const blocked: FauxResponseStep = (_context, options) =>
  new Promise((done) => {
    const finish = () => done(fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "Stopped" }));
    if (options?.signal?.aborted) finish();
    options?.signal?.addEventListener("abort", finish, { once: true });
  });

/** A response that waits until the test opens the gate, then gives the message. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((done) => {
    open = done;
  });
  const after =
    (message: ReturnType<typeof fauxAssistantMessage>): FauxResponseStep =>
    async () => {
      await opened;
      return message;
    };
  return { open: () => open(), after };
}

/**
 * Gives the response of the script of the Story in the Run section of the worker message. The number of assistant
 * messages in the context selects the step, so that two workers that run at the same time each get their own script.
 */
function byStory(scripts: Map<string, readonly FauxResponseStep[]>): FauxResponseFactory {
  return (context, options, state, model) => {
    const story = /Story: (TST-\d+)/.exec(JSON.stringify(context.messages))?.[1] ?? "";
    const step = context.messages.filter((message) => message.role === "assistant").length;
    const next = scripts.get(story)?.[step] ?? DONE;
    return typeof next === "function" ? next(context, options, state, model) : next;
  };
}

/** One request to a host, as the test records it: the command name, the command type and the Thread. */
interface Recorded {
  readonly name: string;
  readonly type?: string;
  readonly threadId?: string;
}

/** A transport that records the request calls of the main machine to the host. */
function recording(inner: HostTransport, log: Recorded[]): HostTransport {
  return {
    request: (command, input, options) => {
      const value = (input ?? {}) as { type?: string; threadId?: string };
      log.push({ name: command[2] ?? "", type: value.type, threadId: value.threadId });
      return inner.request(command, input, options);
    },
    bytes: (command, input, options) => inner.bytes(command, input, options),
    upload: (command, data, options) => inner.upload(command, data, options),
    channel: (command, handlers, options) => inner.channel(command, handlers, options),
  };
}

async function commit(cwd: string, file: string, text: string) {
  await writeFile(join(cwd, file), text);
  await git(cwd, "add", file);
  await git(cwd, "-c", "user.name=Test", "-c", "user.email=t@example.com", "commit", "-q", "-m", file);
}

interface FixtureOptions {
  /** The worker slots of each worker host. */
  readonly hosts: Readonly<Record<string, number>>;
  /** The worker slots of the main machine. */
  readonly local?: number;
  readonly placement?: PlacementPolicy;
}

interface Fixture {
  readonly manager: FactoryManager;
  readonly worker: ReturnType<typeof fauxProvider>;
  readonly scripts: Map<string, readonly FauxResponseStep[]>;
  readonly hosts: Readonly<Record<string, FakeHostAgent>>;
  readonly requests: Readonly<Record<string, Recorded[]>>;
}

describe("remote factory end to end", () => {
  const dir = useTempDir();
  let manager: FactoryManager | undefined;
  let agents: FakeHostAgent[] = [];
  let root: string;

  beforeEach(async () => {
    root = join(dir.path, "project");
    await mkdir(root);
    vi.stubEnv("HOME", join(dir.path, "home"));
    vi.stubEnv("PI_CODING_AGENT_DIR", join(dir.path, "agent"));
    vi.stubEnv("PI_OFFLINE", "1");
    await initProject({ name: "Test", key: "TST" }, { cwd: root });
    await createStage({ label: "Work", key: "WORK", prompt: PROMPT }, { cwd: root });
    await git(dir.path, "init", "-q", root);
    await git(root, "add", ".rowbly");
    await git(root, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "initial");

    // The origin that each host fetches before a run.
    const seed = join(dir.path, "seed");
    await mkdir(seed);
    await git(seed, "init", "-q", "-b", "main");
    await commit(seed, "README.md", "seed\n");
    await exec("git", ["clone", "-q", "--bare", seed, join(dir.path, "origin.git")]);
  });

  afterEach(async () => {
    for (const agent of agents) agent.transport.reconnect();
    await manager?.shutdown();
    await Promise.all(agents.map((agent) => agent.stop()));
    manager = undefined;
    agents = [];
    vi.unstubAllEnvs();
  });

  /** Makes a worker host with its own home folder and its own clone of the origin. */
  async function makeHost(id: string, runner: Parameters<typeof createHostRunner>[0]["runtime"]) {
    const home = join(dir.path, "hosts", id);
    const projectId = hostProjectId(root);
    const paths = hostAgentPaths(projectId, home);
    await exec("git", ["clone", "-q", join(dir.path, "origin.git"), join(home, CLONE)]);
    await mkdir(join(paths.bin, ".."), { recursive: true });
    const agent = createFakeHostAgent({
      projectId,
      home,
      runner: createHostRunner({ paths, home, shim: await writeCliShim(LAUNCH, paths.bin), runtime: runner }),
    });
    agents.push(agent);
    return agent;
  }

  async function fixture(options: FixtureOptions): Promise<Fixture> {
    const sdk = await loadPi();
    const runtime = await sdk.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const worker = fauxProvider({ provider: "worker", api: "worker-faux", tokenSize: { min: 1000, max: 1000 } });
    runtime.registerNativeProvider(worker.provider);
    const scripts = new Map<string, readonly FauxResponseStep[]>();
    worker.setResponses(Array.from({ length: 200 }, () => byStory(scripts)));
    await updateFactorySettings(
      {
        maxWorkers: options.local ?? 1,
        workerModel: { provider: "worker", modelId: worker.getModel().id },
        git: { authorName: "Factory", authorEmail: "factory@example.com" },
        ...(options.placement ? { placement: options.placement } : {}),
      },
      { cwd: root },
    );
    await updateFactoryState(root, (state) => ({
      ...state,
      prompts: { WORK: { hash: promptHash(PROMPT), class: "work" } },
    }));

    const runner = async () => ({ runtime, agentDir: join(dir.path, "agent") });
    const ids = Object.keys(options.hosts);
    const hosts: Record<string, FakeHostAgent> = {};
    const requests: Record<string, Recorded[]> = {};
    const transports: Record<string, HostTransport> = {};
    for (const id of ids) {
      hosts[id] = await makeHost(id, runner);
      requests[id] = [];
      transports[id] = recording(hosts[id].transport, requests[id]);
    }

    manager = await createFactoryManager(
      {
        runtime,
        agentDir: join(dir.path, "agent"),
        shim: await createCliShim(LAUNCH, { cwd: root }),
        workerHosts: async () =>
          ids.map((id) => ({
            id,
            maxWorkers: options.hosts[id] as number,
            state: "connected" as const,
            providers: ["worker"],
          })),
        worktreeFacts: async () => undefined,
        hostConnection: async (host) => ({
          transport: transports[host] as HostTransport,
          rowbly: ROWBLY,
          clone: CLONE,
        }),
        hostHeartbeat: { intervalMs: 50, timeoutMs: 5000 },
        remoteStopTimeoutMs: 30_000,
      },
      { cwd: root },
    );
    return { manager, worker, scripts, hosts, requests };
  }

  async function reserve(f: Fixture, storyId: string, host?: string) {
    const { threadId } = await f.manager.reserveWorker({ storyId, stage: "WORK", requestId: storyId, host });
    return threadId;
  }

  async function threadWith(id: string, status: ThreadRecord["status"]): Promise<ThreadRecord> {
    return vi.waitFor(async () => {
      const thread = await getThread(id, { cwd: root });
      expect(thread.status).toBe(status);
      return thread;
    }, TIMEOUT);
  }

  async function freeSlots(f: Fixture, host: string) {
    await vi.waitFor(async () => {
      const slots = (await f.manager.snapshot()).hosts.find((entry) => entry.id === host);
      expect(slots?.used).toBe(0);
    }, TIMEOUT);
  }

  const story = (id: string) => getStory({ id }, { cwd: root });

  it("runs a Story on a host from the launch to the canonical commit of the result", async () => {
    const f = await fixture({ hosts: { mini: 1 } });
    const created = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    f.scripts.set(created.id, [rowbly(`story update ${created.id} --stage DONE`), report("Moved on mini"), DONE]);

    const threadId = await reserve(f, created.id, "mini");
    const thread = await threadWith(threadId, "completed");

    expect(thread).toMatchObject({ host: "mini", result: { outcome: "complete", summary: "Moved on mini" } });
    expect(f.requests.mini?.some((call) => call.name === "submit" && call.type === "launch")).toBe(true);
    // The Stage move came to the board through the outbox of the host before the Thread completed.
    expect(thread.result?.problems).not.toContain("Story remains in the assigned Stage");
    expect((await story(created.id)).stage).toBe("DONE");
    expect(await readAppliedSeq(await findProject({ cwd: root }), "mini")).toBeGreaterThan(0);
    expect(await readOutboxEntries(f.hosts.mini?.paths.outbox as string, 0)).toEqual([]);

    // The commit step of the manager records the result in the canonical repository.
    const committed = await commitCanonicalProject(root, (await getFactorySettings({ cwd: root })).git);
    expect(committed.status).toBe("committed");
    expect((await git(root, "log", "-1", "--format=%s")).stdout.trim()).toBe(DEFAULT_COMMIT_MESSAGE);
    expect((await git(root, "log", "-1", "--format=%an <%ae>")).stdout.trim()).toBe("Factory <factory@example.com>");
    const files = (await git(root, "show", "--name-only", "--format=", "HEAD")).stdout.split("\n");
    expect(files).toContain(`.rowbly/stories/DONE/${created.id}.md`);
    expect(files.some((file) => file.startsWith(".rowbly/runtime/") || file === ".rowbly/state.json")).toBe(false);
  }, 60_000);

  it("stops abandoned Threads first on reconnect, holds their entries, and applies or discards them", async () => {
    const f = await fixture({ hosts: { mini: 2 } });
    const mini = f.hosts.mini as FakeHostAgent;
    const kept = await createStory({ title: "Apply", stage: "WORK" }, { cwd: root });
    const dropped = await createStory({ title: "Discard", stage: "WORK" }, { cwd: root });
    const keptGate = gate();
    const droppedGate = gate();
    f.scripts.set(kept.id, [
      keptGate.after(rowbly(`story update ${kept.id} --title 'Late apply'`)),
      report("Late"),
      DONE,
    ]);
    f.scripts.set(dropped.id, [
      droppedGate.after(rowbly(`story update ${dropped.id} --title 'Late discard'`)),
      report("Late"),
      DONE,
    ]);

    const keptThread = await threadWith(await reserve(f, kept.id, "mini"), "running");
    const droppedThread = await threadWith(await reserve(f, dropped.id, "mini"), "running");

    // The host goes offline, and the user cancels both Threads.
    mini.transport.disconnect();
    await vi.waitFor(() => expect(mini.transport.openChannels).toBe(0));
    await f.manager.cancelWorker(keptThread.id, keptThread.runs.at(-1)?.id ?? "");
    await f.manager.cancelWorker(droppedThread.id, droppedThread.runs.at(-1)?.id ?? "");
    await freeSlots(f, "mini");
    for (const id of [keptThread.id, droppedThread.id]) {
      expect(await getThread(id, { cwd: root })).toMatchObject({
        status: "cancelled",
        abandoned: { reason: "cancel" },
      });
    }

    // The workers on the host do not know about the cancel. They change their Stories and end.
    keptGate.open();
    droppedGate.open();
    for (const id of [keptThread.id, droppedThread.id]) {
      await vi.waitFor(async () => expect((await readHostRun(mini.paths, id))?.phase).toBe("ended"), TIMEOUT);
    }
    expect(await readOutboxEntries(mini.paths.outbox, 0)).toHaveLength(2);

    const mark = f.requests.mini?.length ?? 0;
    mini.transport.reconnect();
    const paths = await findProject({ cwd: root });
    await vi.waitFor(async () => {
      expect(await readHeldEntries(paths, "mini", keptThread.id)).toHaveLength(1);
      expect(await readHeldEntries(paths, "mini", droppedThread.id)).toHaveLength(1);
    }, TIMEOUT);

    // The stops go first on reconnect.
    const after = (f.requests.mini ?? []).slice(mark).filter((call) => call.name !== "ping");
    expect(after.slice(0, 2)).toEqual(
      expect.arrayContaining([
        { name: "submit", type: "cancel-thread", threadId: keptThread.id },
        { name: "submit", type: "cancel-thread", threadId: droppedThread.id },
      ]),
    );
    expect(after.slice(0, 2).every((call) => call.name === "submit")).toBe(true);

    // The canonical Stories do not change before the user acts.
    expect((await story(kept.id)).title).toBe("Apply");
    expect((await story(dropped.id)).title).toBe("Discard");
    await vi.waitFor(async () => expect(await readOutboxEntries(mini.paths.outbox, 0)).toEqual([]), TIMEOUT);

    const applied = await heldAction({ id: keptThread.id, apply: true }, { cwd: root });
    expect(applied).toMatchObject({ action: "apply", host: "mini", conflicts: [] });
    expect((await story(kept.id)).title).toBe("Late apply");
    expect(await readHeldEntries(paths, "mini", keptThread.id)).toEqual([]);

    const discarded = await heldAction({ id: droppedThread.id, discard: true }, { cwd: root });
    expect(discarded).toMatchObject({ action: "discard", host: "mini", discarded: 1 });
    await expect(stat(join(paths.runtimeDir, "hosts/mini/held", droppedThread.id))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await story(dropped.id)).title).toBe("Discard");
  }, 60_000);

  it("sends a canonical change to the copy of a running remote worker, and keeps the change of the worker", async () => {
    const f = await fixture({ hosts: { mini: 1 } });
    const mini = f.hosts.mini as FakeHostAgent;
    const created = await createStory({ title: "Original", stage: "WORK" }, { cwd: root });
    const finish = gate();
    f.scripts.set(created.id, [
      rowbly(`story update ${created.id} --description 'Worker text'`),
      finish.after(report("Changed on mini")),
      DONE,
    ]);

    const threadId = await reserve(f, created.id, "mini");
    await threadWith(threadId, "running");
    await vi.waitFor(async () => expect(await readOutboxEntries(mini.paths.outbox, 0)).toHaveLength(1), TIMEOUT);
    const copy = threadPaths(mini.paths, threadId).copy;
    expect((await getStory({ id: created.id }, { cwd: copy })).description).toContain("Worker text");

    // A person changes the title on the board while the worker runs.
    await updateStory({ id: created.id, title: "Board title" }, { cwd: root });
    await f.manager.reconcile();

    await vi.waitFor(
      async () => expect((await getStory({ id: created.id }, { cwd: copy })).title).toBe("Board title"),
      TIMEOUT,
    );
    const onHost = await getStory({ id: created.id }, { cwd: copy });
    expect(onHost.description).toContain("Worker text");
    const canonical = await story(created.id);
    expect(canonical).toMatchObject({ title: "Board title" });
    expect(canonical.description).toContain("Worker text");

    finish.open();
    await threadWith(threadId, "completed");
    expect((await story(created.id)).title).toBe("Board title");
  }, 60_000);

  it.each([
    ["prefer-local", "local"],
    ["prefer-remote", "studio"],
    ["most-free", "studio"],
  ] as const)(
    "places a worker without a host with the policy %s on %s",
    async (placement, expected) => {
      // Each machine has a free slot. The host studio has the most free slots.
      const f = await fixture({ hosts: { mini: 1, studio: 2 }, local: 1, placement });
      const created = await createStory({ title: "Placed", stage: "WORK" }, { cwd: root });
      f.scripts.set(created.id, [blocked]);

      const threadId = await reserve(f, created.id);
      const thread = await threadWith(threadId, "running");

      expect(thread.host ?? "local").toBe(expected);
      const slots = (await f.manager.snapshot()).hosts;
      expect(slots.find((entry) => entry.id === expected)).toMatchObject({ used: 1 });
    },
    60_000,
  );

  it("gives no worker to a full host, and places the worker on a machine with a free slot", async () => {
    const f = await fixture({ hosts: { mini: 1, studio: 1 }, local: 1, placement: "prefer-remote" });
    const stories = [];
    for (const title of ["Full", "Second", "Third"])
      stories.push(await createStory({ title, stage: "WORK" }, { cwd: root }));
    for (const created of stories) f.scripts.set(created.id, [blocked]);

    // The supervisor fills studio.
    const first = await reserve(f, stories[0]?.id as string, "studio");
    expect((await threadWith(first, "running")).host).toBe("studio");

    const second = await threadWith(await reserve(f, stories[1]?.id as string), "running");
    expect(second.host).toBe("mini");

    // Now both worker hosts are full, and the worker goes to the main machine.
    const third = await threadWith(await reserve(f, stories[2]?.id as string), "running");
    expect(third.host ?? "local").toBe("local");
    const slots = (await f.manager.snapshot()).hosts;
    expect(slots.map((entry) => [entry.id, entry.used, entry.max])).toEqual([
      ["local", 1, 1],
      ["mini", 1, 1],
      ["studio", 1, 1],
    ]);
  }, 60_000);

  it("moves attachments in both directions, and uploads a canonical file one time", async () => {
    const f = await fixture({ hosts: { mini: 1 } });
    const mini = f.hosts.mini as FakeHostAgent;
    const created = await createStory({ title: "Pictures", stage: "WORK" }, { cwd: root });
    const canonicalFile = join(dir.path, "board.png");
    const workerFile = join(dir.path, "worker.png");
    await writeFile(canonicalFile, CANONICAL_PNG);
    await writeFile(workerFile, WORKER_PNG);
    const onBoard = await addAttachment({ story: created.id, file: canonicalFile }, { cwd: root });
    f.scripts.set(created.id, [rowbly(`add-attachment ${created.id} '${workerFile}'`), report("Added"), DONE]);

    const first = await reserve(f, created.id, "mini");
    await threadWith(first, "completed");
    await freeSlots(f, "mini");

    // The canonical PNG is in the cache of the host after one upload.
    const uploads = () => mini.transport.uploads.filter((upload) => upload.command[4] === onBoard.id);
    expect(uploads()).toHaveLength(1);
    expect(uploads()[0]?.data).toEqual(CANONICAL_PNG);
    expect(await hostCacheMissing(mini.paths, { ids: [onBoard.id] })).toEqual({ missing: [] });

    // The PNG of the worker is on the canonical Story with the id of the copy and the same bytes.
    const copy = threadPaths(mini.paths, first).copy;
    const added = (await listAttachments({ story: created.id }, { cwd: copy })).find((a) => a.id !== onBoard.id);
    expect(added).toBeDefined();
    const canonical = await listAttachments({ story: created.id }, { cwd: root });
    expect(canonical.map((a) => a.id).toSorted()).toEqual([onBoard.id, added?.id].toSorted());
    const record = canonical.find((a) => a.id === added?.id);
    expect(record).toMatchObject({ name: added?.name, size: WORKER_PNG.length });
    const dirOf = await attachmentDir(await findProject({ cwd: root }), created.id);
    const stored = await readFile(join(dirOf, attachmentFileName(record as Attachment)));
    expect(sha256(stored)).toBe(sha256(WORKER_PNG));

    // A second launch does not send the canonical PNG again.
    f.scripts.set(created.id, [report("Again"), DONE]);
    const second = await f.manager.reserveWorker({
      storyId: created.id,
      stage: "WORK",
      requestId: "again",
      host: "mini",
    });
    await threadWith(second.threadId, "completed");
    expect(uploads()).toHaveLength(1);
  }, 60_000);
});
