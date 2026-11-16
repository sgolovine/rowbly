import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newOwner } from "../factory-ownership/ownership-lock.js";
import { useTempDir } from "../test-project/test-project.js";
import type { ThreadRecord } from "../thread/thread.js";
import { hostCachePut } from "./host-agent-cache.js";
import { hostAgentPaths, hostRunPaths, threadPaths } from "./host-agent-paths.js";
import { prepareHostThread, readLaunchData } from "./host-agent-prepare.js";
import { acquireSlot, writeSlotLimit } from "./host-slots.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const ID = "a00000000-0000-4000-8000-000000000001";
const ID2 = "a00000000-0000-4000-8000-000000000002";
const PDF = Buffer.from("%PDF-1.7");

function thread(id = "t1", storyId = "ROW-1"): ThreadRecord {
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    id,
    revision: 1,
    role: "worker",
    storyId,
    stage: "WORK",
    status: "pending",
    createdAt,
    session: { id, file: null },
    cwd: "/main/project",
    runs: [{ id: "run-1", ownerToken: "owner", createdAt, status: "pending" }],
    resumable: false,
  };
}

function input(overrides: Record<string, unknown> = {}, files?: unknown[], attachments: unknown[] = []) {
  return {
    threadId: "t1",
    thread: thread(),
    storyId: "ROW-1",
    clone: ".local/share/rowbly/projects/p1/repo",
    model: { provider: "worker", modelId: "faux" },
    message: "Do the work",
    copy: {
      files: files ?? [
        { path: ".rowbly/rowbly.config.json", content: "{}\n" },
        { path: ".rowbly/stories/WORK/ROW-1.md", content: "# Story\n" },
      ],
      attachments,
    },
    ...overrides,
  };
}

/** All paths below the folder, with their mode. */
async function modes(dir: string): Promise<{ path: string; dir: boolean; mode: number }[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return Promise.all(
    entries.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path, dir: entry.isDirectory(), mode: (await stat(path)).mode & 0o777 };
    }),
  );
}

describe("host prepare", () => {
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);
  const options = () => ({ home: home.path });

  it("writes the copy and each listed attachment file with private modes, and records the launch data", async () => {
    await hostCachePut(paths(), ID, PNG);
    await hostCachePut(paths(), ID2, PDF);
    const attachments = [
      { storyId: "ROW-1", id: ID, file: `${ID}.png` },
      { storyId: "ROW-1", id: ID2, file: `${ID2}.pdf` },
    ];

    const result = await prepareHostThread(paths(), input({}, undefined, attachments), options());
    const files = threadPaths(paths(), "t1");

    expect(result).toEqual({ threadId: "t1", copy: files.copy, files: 2, attachments: 2 });
    expect(await readFile(join(files.copy, ".rowbly/stories/WORK/ROW-1.md"), "utf8")).toBe("# Story\n");
    expect(await readFile(join(files.copy, `.rowbly/attachments/ROW-1/${ID}.png`))).toEqual(PNG);
    expect(await readFile(join(files.copy, `.rowbly/attachments/ROW-1/${ID2}.pdf`))).toEqual(PDF);
    for (const entry of await modes(files.copy)) expect(entry.mode).toBe(entry.dir ? 0o700 : 0o600);
    expect((await stat(files.copy)).mode & 0o777).toBe(0o700);
    expect((await stat(files.launch)).mode & 0o777).toBe(0o600);

    const data = await readLaunchData(paths(), "t1");
    expect(data).toMatchObject({ threadId: "t1", storyId: "ROW-1", message: "Do the work" });
    expect(data.clone).toBe(join(home.path, ".local/share/rowbly/projects/p1/repo"));
    expect(
      hostRunPaths({ home: home.path, projectId: "p1", clone: data.clone, threadId: "t1", storyId: "ROW-1" }),
    ).toEqual({
      clone: data.clone,
      copy: files.copy,
      worktree: `${data.clone}-worktrees/ROW-1`,
      lock: files.lock,
      shim: paths().bin,
      outbox: paths().outbox,
    });
  });

  it("replaces the copy of an earlier prepare", async () => {
    await prepareHostThread(paths(), input(), options());
    await prepareHostThread(paths(), input({}, [{ path: ".rowbly/rowbly.config.json", content: "{ }\n" }]), options());

    const copy = threadPaths(paths(), "t1").copy;
    expect(await readdir(join(copy, ".rowbly"))).toEqual(["rowbly.config.json"]);
    expect(await readdir(threadPaths(paths(), "t1").dir)).toEqual(["copy", "launch.json"]);
  });

  it("refuses bad paths and writes no copy", async () => {
    const bad = [
      "rowbly.config.json",
      "/etc/passwd",
      ".rowbly/../x",
      ".rowbly/stories/../../x",
      ".rowbly/state.json",
      ".rowbly/state.json.lock",
      ".rowbly/runtime/status.json",
      ".rowbly//x",
    ];

    for (const path of bad) {
      await expect(prepareHostThread(paths(), input({}, [{ path, content: "x" }]), options())).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    await expect(readdir(threadPaths(paths(), "t1").dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes an attachment file without an extension with its id as the name", async () => {
    await hostCachePut(paths(), ID, PDF);

    await prepareHostThread(paths(), input({}, undefined, [{ storyId: "ROW-1", id: ID, file: ID }]), options());

    expect(await readFile(join(threadPaths(paths(), "t1").copy, `.rowbly/attachments/ROW-1/${ID}`))).toEqual(PDF);
  });

  it("gives VALIDATION for an attachment file name that is not the id with one safe extension", async () => {
    await hostCachePut(paths(), ID, PNG);
    for (const file of [undefined, "../x.png", `${ID}/x.png`, `${ID}.p/df`, `${ID}..png`, `${ID2}.png`, `${ID}.PNG`]) {
      await expect(
        prepareHostThread(paths(), input({}, undefined, [{ storyId: "ROW-1", id: ID, file }]), options()),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(readdir(threadPaths(paths(), "t1").dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("gives VALIDATION with the missing ids for an attachment file that is not in the cache", async () => {
    await hostCachePut(paths(), ID, PNG);
    const attachments = [
      { storyId: "ROW-1", id: ID, file: `${ID}.png` },
      { storyId: "ROW-1", id: ID2, file: `${ID2}.png` },
    ];

    await expect(prepareHostThread(paths(), input({}, undefined, attachments), options())).rejects.toMatchObject({
      code: "VALIDATION",
      details: { missing: [ID2] },
    });
    await expect(readdir(threadPaths(paths(), "t1").dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a Thread record of a different Thread or Story", async () => {
    for (const overrides of [{ thread: thread("t2") }, { thread: thread("t1", "ROW-2") }, { threadId: "../x" }]) {
      await expect(prepareHostThread(paths(), input(overrides), options())).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
  });

  it("gives CONFLICT while the Thread has active work, and writes no copy", async () => {
    await writeSlotLimit(1, home.path);
    await acquireSlot({ projectId: "p1", threadId: "t1" }, await newOwner(), { home: home.path });

    await expect(prepareHostThread(paths(), input(), options())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(stat(threadPaths(paths(), "t1").copy)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readLaunchData(paths(), "t1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
