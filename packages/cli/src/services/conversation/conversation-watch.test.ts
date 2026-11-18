import * as fs from "node:fs/promises";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "../store/store.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, getThread, transitionThread } from "../thread/thread.js";
import type { ConversationEnv, ConversationState } from "./conversation-state.js";
import { startWatch } from "./conversation-watch.js";
import { SessionIndex } from "./session-index.js";
import type { ConversationPage } from "./session-types.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const POLL_MS = 500;
const NEW_ENTRY = `${JSON.stringify({
  type: "message",
  id: "e",
  parentId: "d",
  timestamp: "2026-11-12T00:00:05.000Z",
  message: { role: "user", content: "New entry", timestamp: 1794441605000 },
})}\n`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ids(page: ConversationPage | undefined): string[] {
  return page?.entries.map((entry) => entry.id) ?? [];
}

function lastPage(changed: ReturnType<typeof vi.fn>): ConversationPage | undefined {
  return changed.mock.calls.at(-1)?.[0] as ConversationPage | undefined;
}

describe("conversation watch", () => {
  const p = useTestProject();
  const stops: Array<() => void> = [];

  afterEach(() => {
    for (const stop of stops.splice(0)) {
      stop();
    }
    vi.restoreAllMocks();
  });

  function envFor(threadId: string): ConversationEnv {
    const initial: ConversationState = { reference: null, closed: false, queue: Promise.resolve(), watches: new Set() };

    return { threadId, ctx: p.ctx, paths: p.paths, store: new Store(initial) };
  }

  async function env(): Promise<ConversationEnv> {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "test" }, p.ctx);

    return envFor(t.id);
  }

  async function withSession() {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "test" }, p.ctx);
    const file = `sessions/${t.id}/history.jsonl`;
    const sessionFile = join(p.paths.runtimeDir, file);
    const threadFile = join(p.paths.runtimeDir, `threads/${t.id}.json`);

    await mkdir(join(p.paths.runtimeDir, `sessions/${t.id}`), { recursive: true });
    await writeFile(sessionFile, await readFile(new URL("./fixtures/branch.jsonl", import.meta.url)));
    await transitionThread(
      t.id,
      { expectedRevision: 1, status: "running", patch: { session: { id: t.id, file } } },
      p.ctx,
    );

    return { id: t.id, file, sessionFile, threadFile, env: envFor(t.id) };
  }

  function watch(watched: ConversationEnv, onError: (error: unknown) => void = vi.fn()) {
    const changed = vi.fn();
    const stop = startWatch(watched, changed, onError);

    stops.push(stop);

    return { changed, stop };
  }

  function threadReads(threadFile: string): number {
    return vi.mocked(fs.readFile).mock.calls.filter(([path]) => path === threadFile).length;
  }

  it("gives the first page once and forgets the watch on stop", async () => {
    const watched = await env();
    const changed = vi.fn();
    const stop = startWatch(watched, changed);

    expect(watched.store.current.watches.size).toBe(1);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(changed.mock.calls[0]?.[0]).toMatchObject({ status: "missing" });

    stop();
    stop();
    expect(watched.store.current.watches.size).toBe(0);
  });

  it("refuses a watch after close", async () => {
    const watched = await env();

    watched.store.update(() => ({ closed: true }));
    expect(() => startWatch(watched, vi.fn())).toThrow("Conversation is closed");
  });

  it("skips the thread read, the page read and the digest when no file changed", async () => {
    const s = await withSession();
    const { changed } = watch(s.env);

    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(lastPage(changed)).toMatchObject({ status: "ok" });

    const page = vi.spyOn(SessionIndex.prototype, "page");
    const stringify = vi.spyOn(JSON, "stringify");
    const reads = threadReads(s.threadFile);

    await sleep(POLL_MS * 3 + 200);

    expect(page).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();
    expect(threadReads(s.threadFile)).toBe(reads);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("gives a new entry of the session file in less than one second", async () => {
    const s = await withSession();
    const { changed } = watch(s.env);

    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(ids(lastPage(changed))).not.toContain("e");

    const reads = threadReads(s.threadFile);

    await appendFile(s.sessionFile, NEW_ENTRY);
    await vi.waitFor(() => expect(ids(lastPage(changed))).toContain("e"), { timeout: 1000 });
    expect(threadReads(s.threadFile)).toBe(reads);
  });

  it("reads the thread again when its leaf or its session file changes", async () => {
    const s = await withSession();
    const { changed } = watch(s.env);

    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(ids(lastPage(changed))).not.toContain("sibling");

    const current = await getThread(s.id, p.ctx);

    await transitionThread(
      s.id,
      {
        expectedRevision: current.revision,
        status: "running",
        patch: { session: { ...current.session, leafId: "sibling" } },
      },
      p.ctx,
    );
    await vi.waitFor(() => expect(ids(lastPage(changed))).toEqual(["a", "sibling"]), { timeout: 1000 });

    const other = `sessions/${s.id}/other.jsonl`;
    const moved = await getThread(s.id, p.ctx);

    await writeFile(join(p.paths.runtimeDir, other), `${await readFile(s.sessionFile, "utf8")}${NEW_ENTRY}`);
    await transitionThread(
      s.id,
      { expectedRevision: moved.revision, status: "running", patch: { session: { id: s.id, file: other } } },
      p.ctx,
    );
    await vi.waitFor(() => expect(ids(lastPage(changed))).toContain("e"), { timeout: 1000 });
  });

  it("gives the missing page once and then the page of the session file that appears", async () => {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "test" }, p.ctx);
    const { changed } = watch(envFor(t.id));

    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(lastPage(changed)).toMatchObject({ status: "missing" });
    await sleep(POLL_MS * 2);
    expect(changed).toHaveBeenCalledOnce();

    const file = `sessions/${t.id}/later.jsonl`;

    await mkdir(join(p.paths.runtimeDir, `sessions/${t.id}`), { recursive: true });
    await writeFile(
      join(p.paths.runtimeDir, file),
      await readFile(new URL("./fixtures/branch.jsonl", import.meta.url)),
    );
    await transitionThread(
      t.id,
      { expectedRevision: 1, status: "running", patch: { session: { id: t.id, file } } },
      p.ctx,
    );
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(lastPage(changed)).toMatchObject({ status: "ok" });
  });

  it("does the full read again after a poll that fails", async () => {
    const s = await withSession();
    const failed = vi.fn();
    const { changed } = watch(s.env, failed);

    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());

    const page = vi.spyOn(SessionIndex.prototype, "page").mockRejectedValueOnce(new Error("Read failed"));
    const reads = threadReads(s.threadFile);

    await appendFile(s.sessionFile, NEW_ENTRY);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce(), { timeout: 1000 });
    await vi.waitFor(() => expect(ids(lastPage(changed))).toContain("e"), { timeout: 1000 });
    expect(page).toHaveBeenCalledTimes(2);
    expect(threadReads(s.threadFile)).toBe(reads + 1);
  });
});
