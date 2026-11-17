import { describe, expect, it, vi } from "vitest";
import { appendOutboxEntry, readOutboxEntries } from "../outbox/outbox-file.js";
import type { OutboxConflict } from "../outbox-apply/outbox-apply.js";
import type { OutboxSource } from "../outbox-apply/outbox-source.js";
import { Store } from "../store/store.js";
import { createStory, getStory, updateStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import type { Manager, ManagerState } from "./manager-state.js";
import { conflictText, outboxAttention, syncHostOutbox } from "./outbox-attention.js";

vi.mock("../factory-ownership/factory-ownership.js", () => ({ assertFactoryOwnership: async () => {} }));

const conflict = (patch: Partial<OutboxConflict>): OutboxConflict => ({
  host: "mini",
  seq: 7,
  storyId: "ROW-05",
  reason: "The value on the main machine is different",
  ...patch,
});

describe("outbox attention", () => {
  it("gives the host, the seq, the path and the three values", () => {
    expect(conflictText(conflict({ path: "title", before: "A", after: "B", current: "C" }))).toBe(
      'Outbox conflict from host mini, seq 7, title: before "A", after "B", current "C". The value on the main machine is different.',
    );
  });

  it("cuts long values to 200 characters and names a missing value", () => {
    const text = conflictText(
      conflict({ path: "description", before: "x".repeat(500), after: "y", current: undefined }),
    );

    expect(text).toContain(`before "${"x".repeat(199)}…, after "y", current missing.`);
  });

  it("gives the attachment id and the path of the kept PNG", () => {
    expect(conflictText(conflict({ attachmentId: "a1", reason: "The Story does not exist", png: "/r/x.png" }))).toBe(
      "Outbox conflict from host mini, seq 7, attachment a1: The Story does not exist. The file is in /r/x.png.",
    );
  });

  it("gives one entry for each Story", () => {
    const entries = outboxAttention([
      conflict({ path: "title" }),
      conflict({ path: "stage", seq: 8 }),
      conflict({ storyId: "ROW-06", path: "tags" }),
      conflict({ storyId: undefined, seq: 0, reason: "The entry has no valid seq" }),
    ]);

    expect([...entries.keys()]).toEqual(["outbox:ROW-05", "outbox:ROW-06", "outbox:mini"]);
    expect(entries.get("outbox:ROW-05")?.text.split("\n")).toHaveLength(2);
    expect(entries.get("outbox:ROW-05")?.storyId).toBe("ROW-05");
    expect(entries.get("outbox:mini")?.storyId).toBeUndefined();
  });
});

describe("syncHostOutbox", () => {
  const project = useTestProject();
  const outbox = useTempDir();

  function createManager(): Manager {
    const state = { queue: Promise.resolve(), attention: new Map([["other", { text: "keep" }]]) };
    return {
      paths: project.paths,
      ctx: project.ctx,
      owner: { token: "t" },
      store: new Store(state as unknown as ManagerState),
    } as unknown as Manager;
  }

  const source: OutboxSource = {
    entriesAfter: (seq) => readOutboxEntries(outbox.path, seq),
    blob: () => Promise.reject(new Error("no blob")),
    acknowledge: async () => {},
  };

  it("keeps the third value and sets the attention entry with the path and the three values", async () => {
    await createStory({ title: "First" }, project.ctx);
    await updateStory({ id: "ROW-01", title: "Local" }, project.ctx);
    await appendOutboxEntry(
      { dir: outbox.path, threadId: "t" },
      { storyId: "ROW-01", changes: [{ path: "title", before: "First", after: "Remote" }] },
    );
    const manager = createManager();

    const result = await syncHostOutbox(manager, "mini", source);

    expect(result.conflicts).toHaveLength(1);
    expect((await getStory({ id: "ROW-01" }, project.ctx)).title).toBe("Local");
    expect(manager.store.current.attention.get("other")).toEqual({ text: "keep" });
    expect(manager.store.current.attention.get("outbox:ROW-01")).toEqual({
      storyId: "ROW-01",
      text: 'Outbox conflict from host mini, seq 1, title: before "First", after "Remote", current "Local". The value on the main machine is different.',
    });
  });
});
