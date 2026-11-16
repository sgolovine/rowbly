import { describe, expect, it } from "vitest";
import { compareChange, storyValue } from "./outbox-compare.js";

const story = {
  title: "First",
  description: "body",
  stage: "BACKLOG",
  fields: { owner: null, pr: "https://x" },
  tags: ["bug"],
  dependsOn: ["ROW-01"],
};

describe("storyValue", () => {
  it("gives the recorded form of each path", () => {
    expect(storyValue(story, "title")).toEqual({ found: true, value: "First" });
    expect(storyValue(story, "description")).toEqual({ found: true, value: "body" });
    expect(storyValue(story, "stage")).toEqual({ found: true, value: "BACKLOG" });
    expect(storyValue(story, "fields.owner")).toEqual({ found: true, value: null });
    expect(storyValue(story, "fields.pr")).toEqual({ found: true, value: "https://x" });
    expect(storyValue(story, "tags")).toEqual({ found: true, value: ["bug"] });
    expect(storyValue(story, "dependsOn")).toEqual({ found: true, value: ["ROW-01"] });
  });

  it("does not find an unknown path or a field that the config does not have", () => {
    expect(storyValue(story, "updatedAt").found).toBe(false);
    expect(storyValue(story, "fields.missing").found).toBe(false);
    expect(storyValue(story, "fields.toString").found).toBe(false);
  });
});

describe("compareChange", () => {
  it("writes a value equal to before", () => {
    expect(compareChange(["a"], { path: "tags", before: ["a"], after: ["a", "b"] })).toBe("write");
    expect(compareChange(null, { path: "fields.owner", before: null, after: "sam" })).toBe("write");
  });

  it("skips a value equal to after", () => {
    expect(compareChange(["a", "b"], { path: "tags", before: ["a"], after: ["a", "b"] })).toBe("skip");
  });

  it("gives a conflict for a third value", () => {
    expect(compareChange("other", { path: "title", before: "A", after: "B" })).toBe("conflict");
    expect(compareChange(["b", "a"], { path: "tags", before: ["a"], after: ["a", "b"] })).toBe("conflict");
    expect(compareChange(undefined, { path: "fields.owner", before: null, after: "sam" })).toBe("conflict");
  });
});
