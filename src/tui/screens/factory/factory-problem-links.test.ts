import { describe, expect, it } from "vitest";
import type { Story } from "../../../services/story/story.js";
import type { ThreadRecord } from "../../../services/thread/thread.js";
import { problemStory, problemThread } from "./factory-problem-links.js";
import type { FactoryProblem } from "./factory-status.js";

const threads = [
  { id: "sup", role: "supervisor" },
  { id: "old", role: "worker", storyId: "ROW-01" },
  { id: "other", role: "worker", storyId: "ROW-02" },
  { id: "new", role: "worker", storyId: "ROW-01" },
] as ThreadRecord[];

function attention(key: string, storyId?: string): FactoryProblem {
  return {
    key: `attention:${key}`,
    kind: "attention",
    title: key,
    text: "x",
    message: "x",
    attentionKey: key,
    storyId,
    dismissible: true,
  };
}

describe("problemThread", () => {
  it("relates the supervisor entry to the supervisor Thread of the status file", () => {
    expect(problemThread(attention("supervisor"), threads, "sup")?.id).toBe("sup");
    expect(problemThread(attention("supervisor"), threads, undefined)).toBeUndefined();
  });

  it("relates an entry with a Story to the newest Thread of that Story", () => {
    expect(problemThread(attention("check", "ROW-01"), threads, "sup")?.id).toBe("new");
    expect(problemThread(attention("check", "ROW-09"), threads, "sup")).toBeUndefined();
  });

  it("gives no Thread to other warnings", () => {
    expect(problemThread(attention("commit"), threads, "sup")).toBeUndefined();
    expect(
      problemThread(
        { key: "heartbeat", kind: "heartbeat", title: "Heartbeat", text: "x", message: "x", dismissible: false },
        threads,
        "sup",
      ),
    ).toBeUndefined();
  });
});

describe("problemStory", () => {
  it("finds the Story of the warning on the board", () => {
    const stories = [{ id: "ROW-01", title: "One" }] as Story[];

    expect(problemStory(attention("check", "ROW-01"), stories)?.title).toBe("One");
    expect(problemStory(attention("check", "ROW-02"), stories)).toBeUndefined();
    expect(problemStory(attention("check"), stories)).toBeUndefined();
  });
});
