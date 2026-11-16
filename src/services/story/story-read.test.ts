import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../config/config.js";
import { addCustomField } from "../custom-field/custom-field.js";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { readStoryFiles } from "../story-files/story-files.js";
import { useTestProject } from "../test-project/test-project.js";
import { createStory, updateStory } from "./story.js";
import { findStoryFile, getStory, getStoryDetails, searchStories } from "./story-read.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile), readdir: vi.fn(actual.readdir), rename: vi.fn(actual.rename) };
});

describe("story-read", () => {
  const project = useTestProject();

  afterEach(() => {
    vi.mocked(fs.readFile).mockClear();
    vi.mocked(fs.readdir).mockClear();
    vi.mocked(fs.rename).mockClear();
  });

  function story(title: string, stage: string, position?: number): string {
    const line = position === undefined ? "" : `position: ${position}\n`;
    return `---\ntitle: ${title}\nstage: ${stage}\n${line}---\n\nBody of ${title}\n`;
  }

  async function writeBoard(): Promise<void> {
    await project.write("stories/BACKLOG/ROW-01.md", story("One", "BACKLOG", 1));
    await project.write("stories/BACKLOG/ROW-02.md", story("Two", "BACKLOG", 2));
    await project.write("stories/DONE/ROW-03.md", story("Three", "DONE", 1));
    await project.write("stories/BACKLOG/ROW-04.md", story("Four", "BACKLOG"));
  }

  /** The same board, with ROW-01 and ROW-03 in the old flat layout. */
  async function writeMixedBoard(): Promise<void> {
    await project.write("stories/ROW-01.md", story("One", "BACKLOG", 1));
    await project.write("stories/BACKLOG/ROW-02.md", story("Two", "BACKLOG", 2));
    await project.write("stories/ROW-03.md", story("Three", "DONE", 1));
    await project.write("stories/BACKLOG/ROW-04.md", story("Four", "BACKLOG"));
  }

  /** The number of reads of each story file since the last clear. */
  function storyReads(before: (order: number) => boolean = () => true): Map<string, number> {
    const { calls, invocationCallOrder } = vi.mocked(fs.readFile).mock;
    const paths = calls
      .filter((_, index) => before(invocationCallOrder[index] as number))
      .map(([path]) => String(path))
      .filter((path) => path.startsWith(project.paths.storiesDir));
    return paths.reduce((counts, path) => counts.set(path, (counts.get(path) ?? 0) + 1), new Map<string, number>());
  }

  function storiesDirListed(): boolean {
    return vi.mocked(fs.readdir).mock.calls.some(([path]) => String(path) === project.paths.storiesDir);
  }

  describe("getStory", () => {
    it("reads each story file at most one time", async () => {
      await writeBoard();
      vi.mocked(fs.readFile).mockClear();

      const found = await getStory({ id: "ROW-02" }, project.ctx);

      expect(found.position).toBe(2);
      expect(found.attachmentCount).toBe(0);
      const reads = storyReads();
      expect(reads.size).toBe(4);
      expect([...reads.values()].every((count) => count === 1)).toBe(true);
    });

    it("places a story with no position after the positioned stories of its stage", async () => {
      await writeBoard();
      await project.write("stories/BACKLOG/ROW-05.md", story("Five", "BACKLOG"));

      expect((await getStory({ id: "ROW-04" }, project.ctx)).position).toBe(3);
      expect((await getStory({ id: "ROW-05" }, project.ctx)).position).toBe(4);
    });

    it("throws a ValidationError with the doctor hint for a stage that is not in the config", async () => {
      await writeBoard();
      await project.write("stories/NOPE/ROW-05.md", story("Five", "NOPE"));

      const error = await getStory({ id: "ROW-05" }, project.ctx).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).hint).toMatch(/rowbly doctor/);
    });

    it("reads Story files in Stage folders and directly in stories/ together", async () => {
      await writeMixedBoard();

      expect(await getStory({ id: "ROW-01" }, project.ctx)).toMatchObject({
        stage: "BACKLOG",
        position: 1,
        path: join(project.paths.storiesDir, "ROW-01.md"),
      });
      expect(await getStory({ id: "ROW-02" }, project.ctx)).toMatchObject({
        position: 2,
        path: join(project.paths.storiesDir, "BACKLOG", "ROW-02.md"),
      });
      expect((await getStory({ id: "ROW-03" }, project.ctx)).stage).toBe("DONE");
    });
  });

  describe("findStoryFile", () => {
    it("finds a story file with a name that is not canonical", async () => {
      await project.write("stories/ROW-1.md", story("One", "BACKLOG", 1));
      const config = await readConfig(project.paths);

      const file = await findStoryFile(project.paths, config, "ROW-01");

      expect(file.path).toBe(join(project.paths.storiesDir, "ROW-1.md"));
      expect(file.doc.data.title).toBe("One");
    });

    it("reads only the file of the story", async () => {
      await writeBoard();
      const config = await readConfig(project.paths);
      vi.mocked(fs.readFile).mockClear();
      vi.mocked(fs.readdir).mockClear();

      const file = await findStoryFile(project.paths, config, "3");

      expect(file.id).toBe("ROW-03");
      expect([...storyReads().keys()]).toEqual([join(project.paths.storiesDir, "DONE", "ROW-03.md")]);
    });

    it("prefers the canonical file name to a name that is not canonical", async () => {
      await project.write("stories/ROW-3.md", story("Old", "DONE", 1));
      await project.write("stories/DONE/ROW-03.md", story("Three", "DONE", 1));
      const config = await readConfig(project.paths);

      expect((await findStoryFile(project.paths, config, "3")).doc.data.title).toBe("Three");
    });

    it("throws a NotFoundError for an unknown number", async () => {
      await writeBoard();
      const config = await readConfig(project.paths);

      await expect(findStoryFile(project.paths, config, "ROW-09")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("searches only the given list and reads nothing", async () => {
      await writeBoard();
      const config = await readConfig(project.paths);
      const files = await readStoryFiles(project.paths);
      vi.mocked(fs.readFile).mockClear();
      vi.mocked(fs.readdir).mockClear();

      expect((await findStoryFile(project.paths, config, "ROW-04", files)).doc.data.title).toBe("Four");
      await expect(findStoryFile(project.paths, config, "ROW-09", files)).rejects.toBeInstanceOf(NotFoundError);
      expect(vi.mocked(fs.readFile)).not.toHaveBeenCalled();
      expect(storiesDirListed()).toBe(false);
    });
  });

  describe("searchStories", () => {
    function manifest(names: string[]): string {
      const records = names.map((name, index) => ({
        id: `a0000000${index}-0000-4000-8000-000000000000`,
        name,
        type: "image/png",
        size: 8,
        createdAt: "2024-01-01T00:00:00.000Z",
      }));
      return JSON.stringify(records);
    }

    async function writeManifest(id: string, text: string): Promise<void> {
      await fs.mkdir(join(project.paths.dir, "attachments", id), { recursive: true });
      await project.write(`attachments/${id}/manifest.json`, text);
    }

    /** The paths of the manifest reads since the last clear. */
    function manifestReads(): string[] {
      return vi
        .mocked(fs.readFile)
        .mock.calls.map(([path]) => String(path))
        .filter((path) => path.endsWith("manifest.json"));
    }

    it("does not read the manifest of a story that the stage filter removes", async () => {
      await writeBoard();
      await writeManifest("ROW-03", "not json");

      const backlog = await searchStories({ stage: "BACKLOG" }, project.ctx);

      expect(backlog.map((s) => s.id)).toEqual(["ROW-01", "ROW-02", "ROW-04"]);
      await expect(searchStories({}, project.ctx)).rejects.toBeInstanceOf(ValidationError);
    });

    it("finds Story files in Stage folders and directly in stories/ in board order", async () => {
      await writeMixedBoard();

      const found = await searchStories({}, project.ctx);

      expect(found.map((s) => [s.id, s.stage, s.position])).toEqual([
        ["ROW-01", "BACKLOG", 1],
        ["ROW-02", "BACKLOG", 2],
        ["ROW-04", "BACKLOG", 3],
        ["ROW-03", "DONE", 1],
      ]);
      expect((await searchStories({ query: "three" }, project.ctx)).map((s) => s.id)).toEqual(["ROW-03"]);
    });

    it("does not read the manifest of a story that a field filter removes", async () => {
      await writeBoard();
      await writeManifest("ROW-03", "not json");
      await writeManifest("ROW-02", manifest(["shot.png"]));
      await addCustomField({ label: "Owner", type: "string" }, project.ctx);
      await project.write(
        "stories/BACKLOG/ROW-02.md",
        `---\ntitle: Two\nstage: BACKLOG\nposition: 2\nowner: ann\n---\n\nBody\n`,
      );
      vi.mocked(fs.readFile).mockClear();

      const found = await searchStories({ fields: { owner: "ann" } }, project.ctx);

      expect(found.map((s) => [s.id, s.attachmentCount])).toEqual([["ROW-02", 1]]);
      expect(manifestReads()).toEqual([join(project.paths.dir, "attachments", "ROW-02", "manifest.json")]);
    });

    it("reads no manifest for a story without an attachment folder", async () => {
      await writeBoard();
      await writeManifest("ROW-02", manifest(["a.png", "b.png"]));
      vi.mocked(fs.readFile).mockClear();
      vi.mocked(fs.readdir).mockClear();

      const found = await searchStories({}, project.ctx);

      expect(found.map((s) => [s.id, s.position, s.attachmentCount])).toEqual([
        ["ROW-01", 1, 0],
        ["ROW-02", 2, 2],
        ["ROW-04", 3, 0],
        ["ROW-03", 1, 0],
      ]);
      expect(manifestReads()).toEqual([join(project.paths.dir, "attachments", "ROW-02", "manifest.json")]);
      const attachmentLists = vi
        .mocked(fs.readdir)
        .mock.calls.filter(([path]) => String(path) === join(project.paths.dir, "attachments"));
      expect(attachmentLists).toHaveLength(1);
    });

    it("matches the attachment names of a story with the query words", async () => {
      await writeBoard();
      await writeManifest("ROW-04", manifest(["diagram.png"]));

      const found = await searchStories({ query: "diagram" }, project.ctx);

      expect(found.map((s) => [s.id, s.attachmentCount])).toEqual([["ROW-04", 1]]);
    });

    it("throws a ValidationError for a symlink at the attachments folder", async () => {
      await writeBoard();
      await fs.mkdir(join(project.paths.root, "elsewhere"));
      await fs.symlink(join(project.paths.root, "elsewhere"), join(project.paths.dir, "attachments"));

      await expect(searchStories({}, project.ctx)).rejects.toBeInstanceOf(ValidationError);
    });

    it("throws a ValidationError for a symlink at the folder of a returned story", async () => {
      await writeBoard();
      await fs.mkdir(join(project.paths.root, "elsewhere"));
      await fs.mkdir(join(project.paths.dir, "attachments"));
      await fs.symlink(join(project.paths.root, "elsewhere"), join(project.paths.dir, "attachments", "ROW-01"));

      await expect(searchStories({}, project.ctx)).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("updateStory", () => {
    it("reads each story file at most one time before the write", async () => {
      await writeBoard();
      vi.mocked(fs.readFile).mockClear();
      vi.mocked(fs.rename).mockClear();

      const updated = await updateStory({ id: "ROW-02", title: "Two again" }, project.ctx);

      expect(updated.title).toBe("Two again");
      // The changed story has the only updatedAt of its stage, so it goes to the top.
      expect(updated.position).toBe(1);
      const renames = vi.mocked(fs.rename).mock;
      const write = renames.calls.findIndex(([, to]) => String(to).startsWith(project.paths.storiesDir));
      expect(write).toBeGreaterThanOrEqual(0);
      const writeOrder = renames.invocationCallOrder[write] as number;
      const reads = storyReads((order) => order < writeOrder);
      expect(reads.size).toBe(4);
      expect([...reads.values()].every((count) => count === 1)).toBe(true);
    });

    it("reads each story file at most one time to check dependsOn before the write", async () => {
      await writeBoard();
      vi.mocked(fs.readFile).mockClear();
      vi.mocked(fs.rename).mockClear();

      const updated = await updateStory({ id: "ROW-02", dependsOn: ["ROW-01", "ROW-03"] }, project.ctx);

      expect(updated.dependsOn).toEqual(["ROW-01", "ROW-03"]);
      const renames = vi.mocked(fs.rename).mock;
      const write = renames.calls.findIndex(([, to]) => String(to).startsWith(project.paths.storiesDir));
      const reads = storyReads((order) => order < (renames.invocationCallOrder[write] as number));
      expect(reads.size).toBe(4);
      expect([...reads.values()].every((count) => count === 1)).toBe(true);
    });
  });

  describe("dependsOn", () => {
    it("reads a missing key as [] and a bad value as []", async () => {
      await project.write("stories/ROW-01.md", story("One", "BACKLOG"));
      await project.write("stories/ROW-02.md", "---\ntitle: Two\nstage: BACKLOG\ndependsOn: ROW-01\n---\n");
      await project.write("stories/ROW-03.md", "---\ntitle: Three\nstage: BACKLOG\ndependsOn: [ROW-01, 7]\n---\n");
      expect((await getStory({ id: "ROW-01" }, project.ctx)).dependsOn).toEqual([]);
      expect((await getStory({ id: "ROW-02" }, project.ctx)).dependsOn).toEqual([]);
      expect((await getStory({ id: "ROW-03" }, project.ctx)).dependsOn).toEqual(["ROW-01"]);
    });
  });

  describe("dependency state", () => {
    async function seed(): Promise<void> {
      const at = (iso: string) => ({ ...project.ctx, now: () => new Date(iso) });
      await createStory({ title: "Done upstream", stage: "DONE" }, at("2025-01-01T00:00:00Z"));
      await createStory({ title: "Open upstream" }, at("2025-01-02T00:00:00Z"));
      await createStory({ title: "Blocked", dependsOn: ["ROW-01", "ROW-02"] }, at("2025-01-03T00:00:00Z"));
      await createStory({ title: "Ready", dependsOn: ["ROW-01"] }, at("2025-01-04T00:00:00Z"));
    }

    it("gives blocks and waitingFor with the story", async () => {
      await seed();
      expect(await getStoryDetails({ id: "ROW-03" }, project.ctx)).toMatchObject({
        id: "ROW-03",
        dependsOn: ["ROW-01", "ROW-02"],
        blocks: [],
        waitingFor: ["ROW-02"],
        attachmentCount: 0,
      });
      expect(await getStoryDetails({ id: "ROW-01" }, project.ctx)).toMatchObject({
        blocks: ["ROW-03", "ROW-04"],
        waitingFor: [],
      });
    });

    it("filters the search by blocked or ready, together with the other filters", async () => {
      await seed();
      const ids = (stories: { id: string }[]) => stories.map((s) => s.id);
      expect(ids(await searchStories({ dependency: "blocked" }, project.ctx))).toEqual(["ROW-03"]);
      expect(ids(await searchStories({ dependency: "ready" }, project.ctx))).toEqual(["ROW-04", "ROW-02", "ROW-01"]);
      expect(ids(await searchStories({ dependency: "ready", stage: "BACKLOG" }, project.ctx))).toEqual([
        "ROW-04",
        "ROW-02",
      ]);
      expect(ids(await searchStories({ dependency: "ready", query: "upstream" }, project.ctx))).toEqual([
        "ROW-02",
        "ROW-01",
      ]);
      expect(await searchStories({ dependency: "blocked", query: "upstream" }, project.ctx)).toEqual([]);
    });
  });
});
