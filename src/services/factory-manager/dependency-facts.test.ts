import { describe, expect, it } from "vitest";
import { supervisorDigest } from "../supervisor-digest/supervisor-digest.js";
import { blockedItems, dependencyLists } from "./dependency-facts.js";

const stages = [
  { key: "BACKLOG", label: "Backlog", promptClass: "hold" },
  { key: "WORK", label: "Work", promptClass: "work" },
  { key: "DONE", label: "Done", promptClass: "hold" },
];

const story = (id: string, stage: string, dependsOn: string[] = []) => ({ id, stage, dependsOn });

describe("dependencyLists", () => {
  it("gives the upstream, downstream and waiting IDs of the Spec example", () => {
    const stories = [story("ROW-04", "WORK"), story("ROW-05", "WORK", ["ROW-04"])];

    expect(dependencyLists(stories, stages, "ROW-05")).toEqual({
      dependsOn: ["ROW-04"],
      blocks: [],
      waitingFor: ["ROW-04"],
    });
    expect(dependencyLists(stories, stages, "ROW-04")).toEqual({ dependsOn: [], blocks: ["ROW-05"], waitingFor: [] });
  });
});

describe("blockedItems", () => {
  it("lists the blocked Stories in a work Stage with their upstream IDs", () => {
    const stories = [
      story("ROW-01", "WORK"),
      story("ROW-02", "BACKLOG"),
      story("ROW-03", "WORK", ["ROW-01", "ROW-02"]),
      story("ROW-04", "BACKLOG"),
      story("ROW-05", "WORK", ["ROW-04"]),
      story("ROW-06", "BACKLOG", ["ROW-04"]),
    ];

    expect(blockedItems(stories, stages)).toEqual(["ROW-03 waits for ROW-01, ROW-02", "ROW-05 waits for ROW-04"]);
  });

  it("leaves out a Story when its upstream Stories are complete", () => {
    expect(blockedItems([story("ROW-04", "DONE"), story("ROW-05", "WORK", ["ROW-04"])], stages)).toEqual([]);
  });

  it("gives a digest section of at most twelve items", () => {
    const stories = [
      story("ROW-01", "BACKLOG"),
      ...Array.from({ length: 20 }, (_, i) => story(`ROW-${i + 10}`, "WORK", ["ROW-01"])),
    ];
    const blocked = JSON.parse(supervisorDigest({ blocked: blockedItems(stories, stages) }).text).blocked;

    expect(blocked).toMatchObject({ total: 20, nextCursor: 12 });
    expect(blocked.items).toHaveLength(12);
    expect(blocked.items[0]).toBe("ROW-10 waits for ROW-01");
  });
});
