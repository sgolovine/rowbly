import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store/store.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, transitionThread } from "../thread/thread.js";
import { queueRead } from "./conversation-read.js";
import type { ConversationEnv, ConversationState } from "./conversation-state.js";

describe("conversation read", () => {
  const p = useTestProject();

  async function env(file?: (id: string) => string): Promise<ConversationEnv> {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "test" }, p.ctx);

    if (file) {
      await mkdir(join(p.paths.runtimeDir, file(t.id)), { recursive: true });
      await transitionThread(
        t.id,
        { expectedRevision: 1, status: "running", patch: { session: { id: t.id, file: file(t.id) } } },
        p.ctx,
      );
    }

    const initial: ConversationState = { reference: null, closed: false, queue: Promise.resolve(), watches: new Set() };

    return { threadId: t.id, ctx: p.ctx, paths: p.paths, store: new Store(initial) };
  }

  it("gives a missing page while the Thread has no session file", async () => {
    expect(await queueRead(await env(), {})).toEqual({
      entries: [],
      nextBefore: null,
      bytes: 0,
      status: "missing",
      invalidLines: 0,
    });
  });

  it("gives a short error for a file system problem and keeps the queue usable", async () => {
    const reader = await env((id) => `sessions/${id}/history.jsonl`);

    await expect(queueRead(reader, {})).rejects.toThrow("Conversation file is unavailable (EISDIR)");
    await expect(queueRead(reader, {})).rejects.toThrow("EISDIR");
  });

  it("refuses a read after close", async () => {
    const reader = await env();

    reader.store.update(() => ({ closed: true }));
    await expect(queueRead(reader, {})).rejects.toThrow("Conversation is closed");
  });
});
