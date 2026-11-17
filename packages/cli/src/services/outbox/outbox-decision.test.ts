import { describe, expect, it } from "vitest";
import type { Story } from "../story/story-types.js";
import { decide, hasWritableForm, updateInput } from "./outbox-decision.js";

const story = {
  id: "ROW-01",
  title: "First",
  description: "body",
  stage: "BACKLOG",
  fields: { owner: null },
  tags: [],
  dependsOn: [],
} as unknown as Story;

describe("decide", () => {
  it("writes a value equal to before, skips a value equal to after, and gives the reason for a different value", () => {
    expect(decide(story, { path: "title", before: "First", after: "New" }, "why").action).toBe("write");
    expect(decide(story, { path: "title", before: "Old", after: "First" }, "why").action).toBe("skip");
    expect(decide(story, { path: "title", before: "Old", after: "New" }, "why")).toEqual({
      change: { path: "title", before: "Old", after: "New" },
      action: "conflict",
      current: "First",
      reason: "why",
    });
  });

  it("gives a conflict for an unknown path or a bad form", () => {
    expect(decide(story, { path: "updatedAt", before: null, after: "x" }, "why")).toMatchObject({
      action: "conflict",
      reason: "Unknown path updatedAt",
    });
    expect(decide(story, { path: "title", before: "First", after: 3 }, "why")).toMatchObject({
      action: "conflict",
      reason: "The new value has a bad form",
    });
    expect(hasWritableForm({ path: "tags", before: [], after: ["a"] })).toBe(true);
    expect(hasWritableForm({ path: "tags", before: [], after: [1] })).toBe(false);
  });
});

describe("updateInput", () => {
  it("makes one Story write with the named paths and the custom fields", () => {
    expect(
      updateInput("ROW-01", [
        { path: "title", before: "a", after: "b" },
        { path: "fields.owner", before: null, after: "sam" },
      ]),
    ).toEqual({ id: "ROW-01", title: "b", fields: { owner: "sam" } });
    expect(updateInput("ROW-01", [{ path: "stage", before: "A", after: "B" }])).toEqual({ id: "ROW-01", stage: "B" });
  });
});
