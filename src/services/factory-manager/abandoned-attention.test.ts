import { describe, expect, it } from "vitest";
import type { OutboxEntry } from "../outbox/outbox.js";
import { applyOutbox } from "../outbox-apply/outbox-apply.js";
import { createStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { abandonedKey, heldAttention, heldText } from "./abandoned-attention.js";

const field = (seq: number, storyId: string, path: string) =>
  ({ seq, opId: `o${seq}`, threadId: "t1", storyId, changes: [{ path, before: null, after: "x" }] }) as OutboxEntry;

describe("abandoned attention", () => {
  const project = useTestProject();

  it("gives the host, the number of held entries, and the paths and attachment ids for each Story", () => {
    const remove = {
      seq: 3,
      opId: "o3",
      threadId: "t1",
      storyId: "ROW-02",
      type: "attachment.remove",
      id: "a1",
      sha256: "0",
    };
    const entries = [field(1, "ROW-01", "title"), field(2, "ROW-01", "fields.owner"), remove as OutboxEntry];

    expect(abandonedKey("t1")).toBe("abandoned:t1");
    expect(heldText("mini", "t1", entries)).toBe(
      "Abandoned Thread t1 on host mini has 3 held entries. ROW-01: title, fields.owner; ROW-02: attachment a1. Run `rowbly thread held t1`.",
    );
    expect(
      heldText(
        "mini",
        "t1",
        Array.from({ length: 200 }, (_, i) => field(i + 1, `ROW-${i + 1}`, "title")),
      ),
    ).toHaveLength(500);
  });

  it("gives one entry for each Thread with held entries, with the Story of the Thread", async () => {
    await createStory({ title: "First" }, project.ctx);
    await applyOutbox(
      {
        host: "mini",
        entries: [field(1, "ROW-01", "title"), field(2, "ROW-01", "title")],
        source: { blob: async () => new Uint8Array() },
        abandoned: [{ threadId: "t1", appliedSeq: 0 }],
      },
      project.ctx,
    );

    const attention = await heldAttention(
      project.paths,
      "mini",
      [
        { threadId: "t1", seq: 1 },
        { threadId: "t1", seq: 2 },
        { threadId: "none", seq: 3 },
      ],
      (threadId) => (threadId === "t1" ? "ROW-09" : undefined),
    );

    expect([...attention.keys()]).toEqual(["abandoned:t1"]);
    expect(attention.get("abandoned:t1")).toMatchObject({ storyId: "ROW-09" });
    expect(attention.get("abandoned:t1")?.text).toContain("has 2 held entries");
  });
});
