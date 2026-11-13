import { describe, expect, it } from "vitest";
import { deleteStoryMessage } from "./delete-story-message.js";

describe("deleteStoryMessage", () => {
  it("names the Story", () => {
    expect(deleteStoryMessage({ id: "ROW-01", title: "Fix login" })).toBe(
      "Delete ROW-01 Fix login? You cannot undo this.",
    );
  });
});
