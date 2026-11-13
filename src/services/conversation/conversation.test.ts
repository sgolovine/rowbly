import * as fs from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, listThreads, transitionThread } from "../thread/thread.js";
import {
  closeConversation,
  getThreadLog,
  openConversation,
  readConversationPage,
  watchConversation,
} from "./conversation.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("Peek imported SDK");
});
describe("conversation", () => {
  const p = useTestProject();
  async function fixture() {
    const t = await createThread(
      { role: "worker", storyId: "ROW-1", stage: "DEVELOP", cwd: p.paths.root, ownerToken: "test" },
      p.ctx,
    );
    const file = `sessions/${t.id}/history.jsonl`;
    await mkdir(join(p.paths.runtimeDir, `sessions/${t.id}`), { recursive: true });
    const text = await readFile(new URL("./fixtures/branch.jsonl", import.meta.url), "utf8");
    await writeFile(join(p.paths.runtimeDir, file), text);
    await transitionThread(
      t.id,
      { expectedRevision: 1, status: "running", patch: { session: { id: t.id, file } } },
      p.ctx,
    );
    return { t, file, text };
  }
  it("peek never creates a session or writes bytes with SDK import blocked", async () => {
    const { t, file, text } = await fixture();
    const c = await openConversation(t.id, p.ctx);
    expect((await readConversationPage(c)).entries).toHaveLength(4);
    closeConversation(c);
    expect(await readFile(join(p.paths.runtimeDir, file), "utf8")).toBe(text);
    await expect(c.read()).rejects.toThrow("closed");
  });
  it("metadata listing never opens session files", async () => {
    const { t, file } = await fixture();
    await writeFile(join(p.paths.runtimeDir, file), "not JSONL");
    const original = vi.mocked(fs.readFile).getMockImplementation();
    if (!original) throw new Error("Missing file reader");
    const spy = vi.mocked(fs.readFile).mockImplementation(((path: unknown, ...args: unknown[]) => {
      if (path === join(p.paths.runtimeDir, file)) throw new Error("Session read during metadata listing");
      return Reflect.apply(original, fs, [path, ...args]);
    }) as typeof fs.readFile);
    try {
      expect((await listThreads({}, p.ctx)).threads[0].id).toBe(t.id);
    } finally {
      spy.mockImplementation(original);
    }
    expect((await getThreadLog(t.id, {}, p.ctx)).entries).toEqual([]);
  });
  it("shows pending sessions as missing and discovers their later reference", async () => {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "test" }, p.ctx);
    const c = await openConversation(t.id, p.ctx);
    expect((await c.read()).status).toBe("missing");
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
    expect((await c.read()).entries).toHaveLength(4);
    c.close();
  });
  it("watches finalized pages and releases polling on close", async () => {
    const { t } = await fixture();
    const c = await openConversation(t.id, p.ctx);
    const changed = vi.fn();
    const failed = vi.fn();
    const stop = watchConversation(c, changed, failed);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    stop();
    c.close();
    expect(failed).not.toHaveBeenCalled();
  });
});
