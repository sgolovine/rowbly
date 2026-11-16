import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../config/config.js";
import { pathExists } from "../files/files.js";
import { useTestProject } from "../test-project/test-project.js";
import {
  dependsOnOf,
  formatStoryId,
  listStoryFileNames,
  orderStoryData,
  parseStoryFileName,
  readStoryFile,
  readStoryFiles,
  rewriteStories,
  type StoryFile,
  saveStoryFile,
  sortStoryFiles,
  storyPath,
  storyTimeOf,
  tagsOf,
  withDependsOn,
  withTags,
  withUpdatedAt,
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

  it("puts dependsOn after position and before the configured fields", () => {
    const data = { a: "a", dependsOn: ["ROW-01"], position: 1, title: "T", stage: "BACKLOG" };
    expect(Object.keys(orderStoryData(CONFIG, data))).toEqual(["title", "stage", "position", "dependsOn", "a"]);
  });

  it("puts createdAt and updatedAt after dependsOn and before the configured fields", () => {
    const data = { a: "a", updatedAt: "u", createdAt: "c", dependsOn: ["ROW-01"], title: "T", stage: "BACKLOG" };
    expect(Object.keys(orderStoryData(CONFIG, data))).toEqual([
      "title",
      "stage",
      "dependsOn",
      "createdAt",
      "updatedAt",
      "a",
    ]);
  });
});

describe("tags", () => {
  it("puts tags after dependsOn and before the times and the configured fields", () => {
    const data = { a: "a", createdAt: "c", tags: ["docs"], dependsOn: ["ROW-01"], title: "T", stage: "BACKLOG" };
    expect(Object.keys(orderStoryData(CONFIG, data))).toEqual([
      "title",
      "stage",
      "dependsOn",
      "tags",
      "createdAt",
      "a",
    ]);
  });

  it("tagsOf reads the list, ignores items that are not strings, and gives [] for a bad value", () => {
    expect(tagsOf({ tags: ["docs", 2, "frontend"] })).toEqual(["docs", "frontend"]);
    expect(tagsOf({})).toEqual([]);
    expect(tagsOf({ tags: "docs" })).toEqual([]);
  });

  it("withTags sets the list and removes the key for an empty list", () => {
    expect(withTags({ title: "T" }, ["docs"])).toEqual({ title: "T", tags: ["docs"] });
    expect(withTags({ title: "T", tags: ["docs"] }, [])).toEqual({ title: "T" });
  });
});

describe("story times", () => {
  it("storyTimeOf gives the saved string, or null for a missing or invalid value", () => {
    expect(storyTimeOf({ createdAt: "2025-01-02T03:04:05.678Z" }, "createdAt")).toBe("2025-01-02T03:04:05.678Z");
    expect(storyTimeOf({}, "createdAt")).toBeNull();
    expect(storyTimeOf({ updatedAt: "yesterday" }, "updatedAt")).toBeNull();
    expect(storyTimeOf({ updatedAt: 5 }, "updatedAt")).toBeNull();
    expect(storyTimeOf({ updatedAt: new Date() }, "updatedAt")).toBeNull();
  });

  it("withUpdatedAt sets an ISO 8601 UTC string", () => {
    expect(withUpdatedAt({ title: "T" }, new Date("2025-01-02T03:04:05.678Z"))).toEqual({
      title: "T",
      updatedAt: "2025-01-02T03:04:05.678Z",
    });
  });
});

describe("sortStoryFiles", () => {
  const file = (number: number, data: Record<string, unknown>): StoryFile => ({
    id: formatStoryId("ROW", number),
    projectKey: "ROW",
    number,
    path: `/stories/ROW-0${number}.md`,
    doc: { data, body: "" },
  });
  const numbers = (files: StoryFile[]) => sortStoryFiles(files).map((f) => f.number);

  it("puts the most recently updated story first, and compares the times, not the strings", () => {
    const files = [
      file(1, { updatedAt: "2025-01-01T00:00:00.000Z" }),
      file(2, { updatedAt: "2025-03-01T00:00:00.000Z" }),
      file(3, { updatedAt: "2025-02-01T00:00:00+05:00" }),
      file(4, { updatedAt: "2025-02-01T00:00:00.000Z" }),
    ];
    expect(numbers(files)).toEqual([2, 4, 3, 1]);
  });

  it("puts a story with a missing or invalid updatedAt after the stories with one", () => {
    const files = [
      file(1, {}),
      file(2, { updatedAt: "nope" }),
      file(3, { updatedAt: "2025-01-01T00:00:00.000Z" }),
      file(4, { updatedAt: 5 }),
    ];
    expect(numbers(files)).toEqual([3, 1, 2, 4]);
  });

  it("puts the stories with the same updatedAt in the order of their numbers", () => {
    const time = "2025-01-01T00:00:00.000Z";
    expect(numbers([file(3, { updatedAt: time }), file(1, { updatedAt: time }), file(2, { updatedAt: time })])).toEqual(
      [1, 2, 3],
    );
  });

  it("ignores the position key", () => {
    const files = [
      file(1, { position: 1, updatedAt: "2025-01-01T00:00:00.000Z" }),
      file(2, { position: 2, updatedAt: "2025-01-02T00:00:00.000Z" }),
    ];
    expect(numbers(files)).toEqual([2, 1]);
  });
});

describe("dependsOn", () => {
  it("dependsOnOf reads the list, ignores items that are not strings, and gives [] for a bad value", () => {
    expect(dependsOnOf({ dependsOn: ["ROW-01", 2, "ROW-03"] })).toEqual(["ROW-01", "ROW-03"]);
    expect(dependsOnOf({})).toEqual([]);
    expect(dependsOnOf({ dependsOn: "ROW-01" })).toEqual([]);
  });

  it("withDependsOn sets the list and removes the key for an empty list", () => {
    expect(withDependsOn({ title: "T" }, ["ROW-01"])).toEqual({ title: "T", dependsOn: ["ROW-01"] });
    expect(withDependsOn({ title: "T", dependsOn: ["ROW-01"] }, [])).toEqual({ title: "T" });
  });
});

describe("story file IO", () => {
  const project = useTestProject();

  it("writes a story and reads it back", async () => {
    const path = storyPath(project.paths, "ROW", 1, "BACKLOG");
    await writeStoryFile(CONFIG, path, { data: { a: null, title: "T", stage: "BACKLOG", b: "x" }, body: "Body" });
    expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(
      "---\ntitle: T\nstage: BACKLOG\nb: x\na: null\n---\n\nBody\n",
    );
    expect(await readStoryFile(path)).toEqual({
      id: "ROW-01",
      projectKey: "ROW",
      number: 1,
      path,
      doc: { data: { title: "T", stage: "BACKLOG", b: "x", a: null }, body: "Body" },
    });
  });

  it("writes updatedAt when the write has a time, and reads the times back as strings", async () => {
    const path = storyPath(project.paths, "ROW", 1, "BACKLOG");
    const now = new Date("2025-01-02T03:04:05.678Z");
    await writeStoryFile(
      CONFIG,
      path,
      { data: { a: "x", title: "T", stage: "BACKLOG", createdAt: "2024-12-31T00:00:00.000Z" }, body: "" },
      now,
    );
    expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(
      "---\ntitle: T\nstage: BACKLOG\ncreatedAt: 2024-12-31T00:00:00.000Z\nupdatedAt: 2025-01-02T03:04:05.678Z\na: x\n---\n\n",
    );
    const { data } = (await readStoryFile(path)).doc;
    expect(data.createdAt).toBe("2024-12-31T00:00:00.000Z");
    expect(data.updatedAt).toBe("2025-01-02T03:04:05.678Z");
    expect(typeof data.updatedAt).toBe("string");
  });

  it("keeps the saved updatedAt when the write has no time", async () => {
    const path = storyPath(project.paths, "ROW", 1, "BACKLOG");
    await writeStoryFile(CONFIG, path, { data: { title: "T", updatedAt: "2024-01-01T00:00:00.000Z" }, body: "" });
    expect((await readStoryFile(path)).doc.data.updatedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("readStoryFile rejects a name that is not a story", async () => {
    await expect(readStoryFile(project.path("stories/notes.md"))).rejects.toThrow(/Not a story file name/);
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
    await project.write("stories/BACKLOG/ROW-03.md", "");
    await project.write("stories/not-a-stage/ROW-04.md", "");
    expect(await listStoryFileNames(project.paths)).toEqual([
      {
        id: "ROW-10",
        projectKey: "ROW",
        number: 10,
        fileName: "ROW-10.md",
        path: project.path("stories/ROW-10.md"),
        folder: null,
      },
      {
        id: "ROW-7",
        projectKey: "ROW",
        number: 7,
        fileName: "ROW-7.md",
        path: project.path("stories/ROW-7.md"),
        folder: null,
      },
      {
        id: "ROW-03",
        projectKey: "ROW",
        number: 3,
        fileName: "ROW-03.md",
        path: project.path("stories/BACKLOG/ROW-03.md"),
        folder: "BACKLOG",
      },
    ]);
  });

  it("readStoryFiles reads the Stage folders and the flat folder together", async () => {
    await project.write("stories/ROW-02.md", "---\ntitle: Two\nstage: BACKLOG\n---\n");
    await project.write("stories/BACKLOG/ROW-01.md", "---\ntitle: One\nstage: BACKLOG\n---\n");
    await project.write("stories/DONE/ROW-03.md", "---\ntitle: Three\nstage: DONE\n---\n");
    const files = await readStoryFiles(project.paths);
    expect(files.map((file) => file.id)).toEqual(["ROW-01", "ROW-02", "ROW-03"]);
    expect(files.map((file) => file.path)).toEqual([
      project.path("stories/BACKLOG/ROW-01.md"),
      project.path("stories/ROW-02.md"),
      project.path("stories/DONE/ROW-03.md"),
    ]);
  });

  it("saveStoryFile moves the file to the folder of its Stage and removes the empty old folder", async () => {
    const config = { ...CONFIG, stages: [...CONFIG.stages, { key: "DONE", label: "Done", enabled: true }] };
    await project.write("stories/BACKLOG/ROW-01.md", "---\ntitle: One\nstage: BACKLOG\n---\n");
    const from = project.path("stories/BACKLOG/ROW-01.md");
    const path = await saveStoryFile(project.paths, config, from, { data: { title: "One", stage: "DONE" }, body: "" });
    expect(path).toBe(project.path("stories/DONE/ROW-01.md"));
    expect(await project.read("stories/DONE/ROW-01.md")).toContain("stage: DONE");
    expect(await pathExists(project.path("stories/BACKLOG"))).toBe(false);
  });

  it("saveStoryFile keeps a Story with an unknown Stage, or with a different file at the new path, in place", async () => {
    await project.write("stories/ROW-01.md", "---\ntitle: One\nstage: NOPE\n---\n");
    await project.write("stories/ROW-02.md", "---\ntitle: Two\nstage: BACKLOG\n---\n");
    await project.write("stories/BACKLOG/ROW-02.md", "---\ntitle: Copy\nstage: BACKLOG\n---\n");
    const one = project.path("stories/ROW-01.md");
    const two = project.path("stories/ROW-02.md");
    expect(await saveStoryFile(project.paths, CONFIG, one, { data: { title: "One", stage: "NOPE" }, body: "" })).toBe(
      one,
    );
    expect(await saveStoryFile(project.paths, CONFIG, two, { data: { title: "2", stage: "BACKLOG" }, body: "" })).toBe(
      two,
    );
    expect(await project.read("stories/BACKLOG/ROW-02.md")).toContain("title: Copy");
  });

  it("rewriteStories writes only the stories that changed", async () => {
    await project.write("stories/ROW-01.md", "---\ntitle: One\nstage: A\n---\n");
    await project.write("stories/ROW-02.md", "---\ntitle: Two\nstage: B\n---\n");
    const config = { ...CONFIG, stages: [{ key: "C", label: "C", enabled: true }] };
    const count = await rewriteStories(
      project.paths,
      config,
      (data) => {
        if (data.stage !== "A") return false;
        data.stage = "C";
        return true;
      },
      new Date("2025-01-02T03:04:05.678Z"),
    );
    expect(count).toBe(1);
    expect(await pathExists(project.path("stories/ROW-01.md"))).toBe(false);
    expect(await project.read("stories/C/ROW-01.md")).toContain("stage: C");
    expect(await project.read("stories/C/ROW-01.md")).toContain("updatedAt: 2025-01-02T03:04:05.678Z");
    expect(await project.read("stories/ROW-02.md")).toBe("---\ntitle: Two\nstage: B\n---\n");
  });
});
