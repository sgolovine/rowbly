import { describe, expect, it } from "vitest";
import { listStages } from "../stage/stage.js";
import { useTestProject } from "../test-project/test-project.js";
import { createStory, deleteStory, getStory, searchStories, updateStory } from "./story.js";
import { withoutStory, withoutStoryAt, withStory, withStoryInOrder, withStoryReads } from "./story-order.js";
import type { Story } from "./story-types.js";

const STAGES = [{ key: "BACKLOG" }, { key: "TODO" }, { key: "DONE" }];

function story(id: string, stage: string, position: number): Story {
  return {
    id,
    number: Number(id.slice(4)),
    title: id,
    stage,
    position,
    dependsOn: [],
    tags: [],
    createdAt: null,
    updatedAt: null,
    description: "",
    fields: {},
    path: `/${id}.md`,
  };
}

/** `<id>:<stage>:<position>` of each Story, in list order. */
function shape(stories: readonly Story[]): string[] {
  return stories.map((s) => `${s.id}:${s.stage}:${s.position}`);
}

const BOARD = [
  story("ROW-03", "BACKLOG", 1),
  story("ROW-02", "BACKLOG", 2),
  story("ROW-01", "BACKLOG", 3),
  story("ROW-04", "TODO", 1),
  story("ROW-05", "DONE", 1),
];

describe("story-order", () => {
  describe("withStory", () => {
    it("moves a Story to the top of a different Stage and sets the positions", () => {
      const moved = withStory(BOARD, STAGES, { ...story("ROW-02", "TODO", 9) });

      expect(shape(moved)).toEqual([
        "ROW-03:BACKLOG:1",
        "ROW-01:BACKLOG:2",
        "ROW-02:TODO:1",
        "ROW-04:TODO:2",
        "ROW-05:DONE:1",
      ]);
    });

    it("puts a Story that was saved in the same Stage at the top", () => {
      const saved = withStory(BOARD, STAGES, story("ROW-01", "BACKLOG", 3));

      expect(shape(saved).slice(0, 3)).toEqual(["ROW-01:BACKLOG:1", "ROW-03:BACKLOG:2", "ROW-02:BACKLOG:3"]);
    });

    it("puts a new Story at the top of its Stage", () => {
      const created = withStory(BOARD, STAGES, story("ROW-06", "DONE", 1));

      expect(shape(created).slice(-2)).toEqual(["ROW-06:DONE:1", "ROW-05:DONE:2"]);
    });

    it("puts a Story in an empty Stage between the Stages around it", () => {
      const board = BOARD.filter((s) => s.stage !== "TODO");

      expect(shape(withStory(board, STAGES, story("ROW-04", "TODO", 1)))).toEqual(shape(BOARD));
    });

    it("puts a Story of an unknown Stage after all known Stages", () => {
      const board = [...BOARD, story("ROW-07", "GONE", 1)];

      expect(shape(withStory(board, STAGES, story("ROW-06", "OTHER", 5))).slice(-3)).toEqual([
        "ROW-05:DONE:1",
        "ROW-06:OTHER:1",
        "ROW-07:GONE:1",
      ]);
    });

    it("keeps the references of the Stories that did not change", () => {
      const moved = withStory(BOARD, STAGES, story("ROW-06", "DONE", 1));

      expect(moved[0]).toBe(BOARD[0]);
      expect(moved[3]).toBe(BOARD[3]);
    });

    it("keeps the relative order of Stories that are put in the order of the writes", () => {
      const first = withStory(BOARD, STAGES, story("ROW-02", "TODO", 1));
      const second = withStory(first, STAGES, story("ROW-03", "TODO", 1));

      expect(shape(second)).toEqual([
        "ROW-01:BACKLOG:1",
        "ROW-03:TODO:1",
        "ROW-02:TODO:2",
        "ROW-04:TODO:3",
        "ROW-05:DONE:1",
      ]);
    });
  });

  describe("withoutStory", () => {
    it("removes a Story and sets the positions in its Stage again", () => {
      expect(shape(withoutStory(BOARD, "ROW-03"))).toEqual([
        "ROW-02:BACKLOG:1",
        "ROW-01:BACKLOG:2",
        "ROW-04:TODO:1",
        "ROW-05:DONE:1",
      ]);
    });

    it("gives the same Stories for an unknown ID", () => {
      expect(withoutStory(BOARD, "ROW-99")).toEqual(BOARD);
    });
  });

  describe("withStoryInOrder", () => {
    const TIMED = [
      { ...story("ROW-03", "BACKLOG", 1), updatedAt: "2025-01-03T00:00:00.000Z" },
      { ...story("ROW-02", "BACKLOG", 2), updatedAt: "2025-01-02T00:00:00.000Z" },
      { ...story("ROW-01", "BACKLOG", 3), updatedAt: "2025-01-01T00:00:00.000Z" },
      { ...story("ROW-04", "TODO", 1), updatedAt: "2025-01-04T00:00:00.000Z" },
      { ...story("ROW-05", "DONE", 1), updatedAt: "2025-01-05T00:00:00.000Z" },
    ];

    it("keeps a Story at its place when a change keeps its updatedAt", () => {
      const edited = { ...(TIMED[1] as Story), title: "Edited" };
      const result = withStoryInOrder(TIMED, STAGES, edited);

      expect(shape(result)).toEqual(shape(TIMED));
      expect(result[1]).toBe(edited);
    });

    it("puts a Story at its place by updatedAt, then by number", () => {
      const moved = { ...story("ROW-06", "BACKLOG", 1), updatedAt: "2025-01-02T00:00:00.000Z" };

      expect(shape(withStoryInOrder(TIMED, STAGES, moved)).slice(0, 4)).toEqual([
        "ROW-03:BACKLOG:1",
        "ROW-02:BACKLOG:2",
        "ROW-06:BACKLOG:3",
        "ROW-01:BACKLOG:4",
      ]);
    });

    it("puts a Story with no updatedAt at the end of its Stage", () => {
      expect(shape(withStoryInOrder(TIMED, STAGES, story("ROW-06", "TODO", 1))).slice(3, 5)).toEqual([
        "ROW-04:TODO:1",
        "ROW-06:TODO:2",
      ]);
    });

    it("keeps the references of the Stories that did not change", () => {
      const result = withStoryInOrder(TIMED, STAGES, { ...(TIMED[3] as Story), title: "Edited" });

      expect(result[0]).toBe(TIMED[0]);
      expect(result[1]).toBe(TIMED[1]);
      expect(result[2]).toBe(TIMED[2]);
      expect(result[4]).toBe(TIMED[4]);
    });
  });

  describe("withoutStoryAt", () => {
    it("removes only the Story of the file", () => {
      const copy = { ...story("ROW-01", "TODO", 1), path: "/TODO/ROW-01.md" };
      const board = [...BOARD, copy];

      const result = withoutStoryAt(board, "/ROW-01.md");

      expect(result.filter((s) => s.id === "ROW-01").map((s) => s.path)).toEqual([copy.path]);
      expect(result).toHaveLength(BOARD.length);
    });

    it("gives the same Stories for an unknown path", () => {
      expect(withoutStoryAt(BOARD, "/ROW-99.md")).toEqual(BOARD);
    });
  });

  describe("withStoryReads", () => {
    it("shows a Story one time, in the new Stage, after a Stage move", () => {
      const moved = { ...story("ROW-02", "TODO", 1), path: "/TODO/ROW-02.md" };
      const reads = [
        { path: moved.path, story: moved },
        { path: "/ROW-02.md", story: undefined },
      ];

      expect(shape(withStoryReads(BOARD, STAGES, reads))).toEqual([
        "ROW-03:BACKLOG:1",
        "ROW-01:BACKLOG:2",
        "ROW-02:TODO:1",
        "ROW-04:TODO:2",
        "ROW-05:DONE:1",
      ]);
      expect(shape(withStoryReads(BOARD, STAGES, reads.toReversed()))).toEqual(
        shape(withStoryReads(BOARD, STAGES, reads)),
      );
    });

    it("gives the same Stories for no reads", () => {
      const result = withStoryReads(BOARD, STAGES, []);

      expect(result).toEqual(BOARD);
      result.map((s, index) => expect(s).toBe(BOARD[index]));
    });
  });

  describe("with a Project", () => {
    const project = useTestProject();
    const at = (iso: string) => ({ ...project.ctx, now: () => new Date(iso) });

    async function seed(): Promise<void> {
      await createStory({ title: "One" }, at("2025-01-01T00:00:00.000Z"));
      await createStory({ title: "Two" }, at("2025-01-02T00:00:00.000Z"));
      await createStory({ title: "Three" }, at("2025-01-03T00:00:00.000Z"));
      await createStory({ title: "Shipped", stage: "DONE" }, at("2025-01-04T00:00:00.000Z"));
    }

    it("gives the order of searchStories after a move", async () => {
      await seed();
      const before = await searchStories({}, project.ctx);
      const stages = await listStages(project.ctx);
      const moved = await updateStory({ id: "ROW-02", stage: "DONE" }, at("2025-01-05T00:00:00.000Z"));

      expect(shape(withStory(before, stages, moved))).toEqual(shape(await searchStories({}, project.ctx)));
    });

    it("gives the order of searchStories after a save in the same Stage", async () => {
      await seed();
      const before = await searchStories({}, project.ctx);
      const stages = await listStages(project.ctx);
      const saved = await updateStory({ id: "ROW-01", title: "First" }, at("2025-01-05T00:00:00.000Z"));

      expect(shape(withStory(before, stages, saved))).toEqual(shape(await searchStories({}, project.ctx)));
    });

    it("gives the order of searchStories after a move from a different process", async () => {
      await seed();
      const before = await searchStories({}, project.ctx);
      const stages = await listStages(project.ctx);
      const old = before.find((s) => s.id === "ROW-02") as Story;
      await updateStory({ id: "ROW-02", stage: "DONE" }, at("2025-01-05T00:00:00.000Z"));
      const moved = await getStory({ id: "ROW-02" }, project.ctx);
      const reads = [
        { path: moved.path, story: moved },
        { path: old.path, story: undefined },
      ];

      expect(shape(withStoryReads(before, stages, reads))).toEqual(shape(await searchStories({}, project.ctx)));
    });

    it("gives the order of searchStories after a delete", async () => {
      await seed();
      const before = await searchStories({}, project.ctx);
      const { id } = await deleteStory({ id: "ROW-03" }, project.ctx);

      expect(shape(withoutStory(before, id))).toEqual(shape(await searchStories({}, project.ctx)));
    });
  });
});
