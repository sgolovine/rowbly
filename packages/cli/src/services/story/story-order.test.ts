import { describe, expect, it } from "vitest";
import { listStages } from "../stage/stage.js";
import { useTestProject } from "../test-project/test-project.js";
import { createStory, deleteStory, searchStories, updateStory } from "./story.js";
import { withoutStory, withStory } from "./story-order.js";
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

    it("gives the order of searchStories after a delete", async () => {
      await seed();
      const before = await searchStories({}, project.ctx);
      const { id } = await deleteStory({ id: "ROW-03" }, project.ctx);

      expect(shape(withoutStory(before, id))).toEqual(shape(await searchStories({}, project.ctx)));
    });
  });
});
