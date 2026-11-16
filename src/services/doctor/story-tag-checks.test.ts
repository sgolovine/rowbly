import { describe, expect, it } from "vitest";
import { createStory, getStory } from "../story/story.js";
import { addTag } from "../tag/tag.js";
import { useTestProject } from "../test-project/test-project.js";
import { doctor } from "./doctor.js";

describe("doctor tag checks", () => {
  const project = useTestProject();
  const issues = async (fix = false) =>
    (await doctor({ fix }, project.ctx)).issues.map(({ message, fix: action, fixed }) => [message, action, fixed]);

  it("accepts the tags of a story that are tags of the project", async () => {
    await addTag({ label: "Docs", value: "docs" }, project.ctx);
    await createStory({ title: "T", tags: ["docs"] }, project.ctx);
    expect(await issues()).toEqual([]);
  });

  it("reports a tag value that is not in the config, and --fix removes it", async () => {
    await addTag({ label: "Docs", value: "docs" }, project.ctx);
    await createStory({ title: "T" }, project.ctx);
    await project.write(
      "stories/BACKLOG/ROW-01.md",
      "---\ntitle: T\nstage: BACKLOG\nuid: b9ece18c-950a-4bfa-8b0f-dbfa4ff731d3\ntags:\n  - docs\n  - gone\n  - gone\n---\n",
    );
    expect(await issues()).toEqual([['"gone" is not a tag of this project', "Remove it", false]]);
    expect(await issues(true)).toEqual([['"gone" is not a tag of this project', "Remove it", true]]);
    expect((await getStory({ id: "ROW-01" }, project.ctx)).tags).toEqual(["docs"]);
    expect(await issues()).toEqual([]);
  });

  it("removes the key when --fix removes the last value", async () => {
    await createStory({ title: "T" }, project.ctx);
    await project.write(
      "stories/BACKLOG/ROW-01.md",
      "---\ntitle: T\nstage: BACKLOG\nuid: b9ece18c-950a-4bfa-8b0f-dbfa4ff731d3\ntags:\n  - gone\n---\n",
    );
    await doctor({ fix: true }, project.ctx);
    expect(await project.read("stories/BACKLOG/ROW-01.md")).not.toContain("tags");
  });

  it("reports a tags value that is not a list of strings, and --fix keeps only the tag values", async () => {
    await addTag({ label: "Docs", value: "docs" }, project.ctx);
    await createStory({ title: "T" }, project.ctx);
    await project.write(
      "stories/BACKLOG/ROW-01.md",
      "---\ntitle: T\nstage: BACKLOG\nuid: b9ece18c-950a-4bfa-8b0f-dbfa4ff731d3\ntags:\n  - docs\n  - 3\n---\n",
    );
    expect(await issues(true)).toEqual([["tags must be a list of tag values", "Keep only the tag values", true]]);
    expect((await getStory({ id: "ROW-01" }, project.ctx)).tags).toEqual(["docs"]);
    expect(await issues()).toEqual([]);
  });
});
