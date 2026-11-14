import { describe, expect, it } from "vitest";
import { upstreamAttention, withUpstreamAttention } from "./upstream-attention.js";

const stages = [
  { key: "BACKLOG", label: "Backlog", promptClass: "hold" },
  { key: "WORK", label: "Work", promptClass: "work" },
  { key: "WAIT", label: "Waiting", promptClass: "hold" },
  { key: "DONE", label: "Done", promptClass: "hold" },
];

const story = (id: string, stage: string, dependsOn: string[] = []) => ({ id, stage, dependsOn });

describe("upstreamAttention", () => {
  it("gives one entry for an upstream Story in the first Stage", () => {
    const stories = [story("ROW-04", "BACKLOG"), story("ROW-05", "WORK", ["ROW-04"])];

    expect([...upstreamAttention(stories, stages, {})]).toEqual([
      [
        "upstream-stuck:ROW-04",
        { text: "ROW-04 cannot progress (in Backlog). ROW-05 waits for it.", storyId: "ROW-04" },
      ],
    ]);
  });

  it("names all the downstream Stories in one entry", () => {
    const stories = [
      story("ROW-04", "BACKLOG"),
      story("ROW-05", "WORK", ["ROW-04"]),
      story("ROW-06", "WORK", ["ROW-04"]),
    ];

    expect(upstreamAttention(stories, stages, {}).get("upstream-stuck:ROW-04")?.text).toBe(
      "ROW-04 cannot progress (in Backlog). ROW-05, ROW-06 wait for it.",
    );
  });

  it("gives an entry for a parked upstream Story and for an upstream Story in a hold Stage", () => {
    const stories = [story("ROW-01", "WORK"), story("ROW-02", "WAIT"), story("ROW-03", "WORK", ["ROW-01", "ROW-02"])];
    const entries = upstreamAttention(stories, stages, { "ROW-01": { stage: "WORK" } });

    expect(entries.get("upstream-stuck:ROW-01")?.text).toBe("ROW-01 cannot progress (parked). ROW-03 waits for it.");
    expect(entries.get("upstream-stuck:ROW-02")?.text).toBe(
      "ROW-02 cannot progress (in hold Stage Waiting). ROW-03 waits for it.",
    );
  });

  it("gives no entry for an upstream Story that can progress or is complete", () => {
    expect(upstreamAttention([story("ROW-04", "WORK"), story("ROW-05", "WORK", ["ROW-04"])], stages, {}).size).toBe(0);
    expect(upstreamAttention([story("ROW-04", "DONE"), story("ROW-05", "WORK", ["ROW-04"])], stages, {}).size).toBe(0);
  });

  it("gives no entry for a blocked downstream Story outside a work Stage", () => {
    const stories = [story("ROW-04", "BACKLOG"), story("ROW-05", "BACKLOG", ["ROW-04"])];

    expect(upstreamAttention(stories, stages, {}).size).toBe(0);
  });

  it("keeps the text to 500 characters", () => {
    const downstream = Array.from({ length: 100 }, (_, i) => story(`ROW-${i + 100}`, "WORK", ["ROW-04"]));
    const text = upstreamAttention([story("ROW-04", "BACKLOG"), ...downstream], stages, {}).get(
      "upstream-stuck:ROW-04",
    )?.text;

    expect(text?.length).toBe(500);
  });
});

describe("withUpstreamAttention", () => {
  it("removes the old upstream entries, sets the new entries and keeps the other entries", () => {
    const attention = new Map([
      ["commit", { text: "Commit failed" }],
      ["upstream-stuck:ROW-01", { text: "old", storyId: "ROW-01" }],
      ["upstream-stuck:ROW-02", { text: "old", storyId: "ROW-02" }],
    ]);
    const entries = new Map([["upstream-stuck:ROW-02", { text: "new", storyId: "ROW-02" }]]);

    expect([...withUpstreamAttention(attention, entries)]).toEqual([
      ["commit", { text: "Commit failed" }],
      ["upstream-stuck:ROW-02", { text: "new", storyId: "ROW-02" }],
    ]);
  });
});
