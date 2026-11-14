import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../config/config.js";
import { useTestProject } from "../test-project/test-project.js";
import {
  formatStoryId,
  listStoryFileNames,
  orderStoryData,
  parseStoryFileName,
  readStoryFile,
  readStoryFiles,
  rewriteStories,
  storyPath,
  writeStoryFile,
} from "./story-files.js";

const CONFIG: ProjectConfig = {
  projectName: "Rowbly",
  projectKey: "ROW",
  customFields: [
    { key: "b", label: "B", type: "string" },
    { key: "a", label: "A", type: "string" },
  ],
  stages: [{ key: "BACKLOG", label: "Backlog", enabled: true }],
};

describe("story file names", () => {
  it("formatStoryId pads the number to two digits", () => {
    expect(formatStoryId("ROW", 1)).toBe("ROW-01");
    expect(formatStoryId("ROW", 123)).toBe("ROW-123");
  });

  it("parseStoryFileName reads the key and the number", () => {
    expect(parseStoryFileName("ROW-07.md")).toEqual({ projectKey: "ROW", number: 7 });
    expect(parseStoryFileName("row-07.md")).toBeUndefined();
    expect(parseStoryFileName("ROW-07.txt")).toBeUndefined();
    expect(parseStoryFileName("notes.md")).toBeUndefined();
  });
});

describe("orderStoryData", () => {
  it("puts title, stage and the configured fields first, then the rest", () => {
    const data = { extra: 1, a: "a", stage: "BACKLOG", b: "b", title: "T" };
    expect(Object.keys(orderStoryData(CONFIG, data))).toEqual(["title", "stage", "b", "a", "extra"]);
  });
});

describe("story file IO", () => {
  const project = useTestProject();

  it("writes a story and reads it back", async () => {
    const path = storyPath(project.paths, "ROW", 1);
    await writeStoryFile(CONFIG, path, { data: { a: null, title: "T", stage: "BACKLOG", b: "x" }, body: "Body" });
    expect(await project.read("stories/ROW-01.md")).toBe("---\ntitle: T\nstage: BACKLOG\nb: x\na: null\n---\n\nBody\n");
    expect(await readStoryFile(project.paths, "ROW-01.md")).toEqual({
      id: "ROW-01",
      projectKey: "ROW",
      number: 1,
      path,
      doc: { data: { title: "T", stage: "BACKLOG", b: "x", a: null }, body: "Body" },
    });
  });

  it("readStoryFile rejects a name that is not a story", async () => {
    await expect(readStoryFile(project.paths, "notes.md")).rejects.toThrow(/Not a story file name/);
  });

  it("readStoryFiles sorts by number and skips other files", async () => {
    await project.write("stories/ROW-10.md", "---\ntitle: Ten\n---\n");
    await project.write("stories/ROW-02.md", "---\ntitle: Two\n---\n");
    await project.write("stories/notes.md", "hello");
    expect((await readStoryFiles(project.paths)).map((file) => file.id)).toEqual(["ROW-02", "ROW-10"]);
  });

  it("listStoryFileNames parses the story file names without a read of the files", async () => {
    await project.write("stories/ROW-10.md", "not frontmatter");
    await project.write("stories/ROW-7.md", "");
    await project.write("stories/notes.md", "hello");
    expect(await listStoryFileNames(project.paths)).toEqual([
      { id: "ROW-10", projectKey: "ROW", number: 10, fileName: "ROW-10.md" },
      { id: "ROW-7", projectKey: "ROW", number: 7, fileName: "ROW-7.md" },
    ]);
  });

  it("rewriteStories writes only the stories that changed", async () => {
    await project.write("stories/ROW-01.md", "---\ntitle: One\nstage: A\n---\n");
    await project.write("stories/ROW-02.md", "---\ntitle: Two\nstage: B\n---\n");
    const count = await rewriteStories(project.paths, CONFIG, (data) => {
      if (data.stage !== "A") return false;
      data.stage = "C";
      return true;
    });
    expect(count).toBe(1);
    expect(await project.read("stories/ROW-01.md")).toContain("stage: C");
    expect(await project.read("stories/ROW-02.md")).toBe("---\ntitle: Two\nstage: B\n---\n");
  });
});
