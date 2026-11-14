import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store/store.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, getThread, transitionThread } from "../thread/thread.js";
import { sessionSignature, threadSignature, watchSignature } from "./conversation-signature.js";
import type { ConversationEnv, ConversationState } from "./conversation-state.js";

describe("conversation signature", () => {
  const p = useTestProject();

  async function env(): Promise<ConversationEnv> {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "test" }, p.ctx);
    const initial: ConversationState = { reference: null, closed: false, queue: Promise.resolve(), watches: new Set() };

    return { threadId: t.id, ctx: p.ctx, paths: p.paths, store: new Store(initial) };
  }

  it("changes when the thread file changes", async () => {
    const e = await env();
    const before = await threadSignature(e);

    expect(await threadSignature(e)).toBe(before);
    await transitionThread(e.threadId, { expectedRevision: 1, status: "running" }, p.ctx);
    expect(await threadSignature(e)).not.toBe(before);
  });

  it("gives none without a session file, missing for an absent file and a new value after an append", async () => {
    const e = await env();
    const file = `sessions/${e.threadId}/history.jsonl`;

    expect(await sessionSignature(e, undefined)).toBe("none");
    expect(await sessionSignature(e, await getThread(e.threadId, p.ctx))).toBe("none");

    const t = await transitionThread(
      e.threadId,
      { expectedRevision: 1, status: "running", patch: { session: { id: e.threadId, file } } },
      p.ctx,
    );

    expect(await sessionSignature(e, t)).toMatch(/missing$/);

    await mkdir(join(p.paths.runtimeDir, `sessions/${e.threadId}`), { recursive: true });
    await writeFile(join(p.paths.runtimeDir, file), "{}\n");

    const written = await sessionSignature(e, t);

    await appendFile(join(p.paths.runtimeDir, file), "{}\n");
    expect(await sessionSignature(e, t)).not.toBe(written);
    expect(watchSignature("a", "b")).not.toBe(watchSignature("a", "c"));
  });

  it("rejects an invalid thread ID", async () => {
    const e = { ...(await env()), threadId: "../bad" };

    await expect(threadSignature(e)).rejects.toThrow("Invalid thread ID");
  });
});
