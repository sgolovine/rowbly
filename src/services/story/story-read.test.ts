import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../config/config.js";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { readStoryFiles } from "../story-files/story-files.js";
import { useTestProject } from "../test-project/test-project.js";
import { updateStory } from "./story.js";
import { findStoryFile, getStory } from "./story-read.js";

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
    await project.write("stories/ROW-01.md", story("One", "BACKLOG", 1));
    await project.write("stories/ROW-02.md", story("Two", "BACKLOG", 2));
    await project.write("stories/ROW-03.md", story("Three", "DONE", 1));
    await project.write("stories/ROW-04.md", story("Four", "BACKLOG"));
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
      await project.write("stories/ROW-05.md", story("Five", "BACKLOG"));

      expect((await getStory({ id: "ROW-04" }, project.ctx)).position).toBe(3);
      expect((await getStory({ id: "ROW-05" }, project.ctx)).position).toBe(4);
    });

    it("throws a ValidationError with the doctor hint for a stage that is not in the config", async () => {
      await writeBoard();
      await project.write("stories/ROW-05.md", story("Five", "NOPE"));

      const error = await getStory({ id: "ROW-05" }, project.ctx).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).hint).toMatch(/rowbly doctor/);
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

    it("reads only the canonical file when it exists", async () => {
      await writeBoard();
      const config = await readConfig(project.paths);
      vi.mocked(fs.readFile).mockClear();
      vi.mocked(fs.readdir).mockClear();

      const file = await findStoryFile(project.paths, config, "3");

      expect(file.id).toBe("ROW-03");
      expect([...storyReads().keys()]).toEqual([join(project.paths.storiesDir, "ROW-03.md")]);
      expect(storiesDirListed()).toBe(false);
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

  describe("updateStory", () => {
    it("reads each story file at most one time before the write", async () => {
      await writeBoard();
      vi.mocked(fs.readFile).mockClear();
      vi.mocked(fs.rename).mockClear();

      const updated = await updateStory({ id: "ROW-02", title: "Two again" }, project.ctx);

      expect(updated.title).toBe("Two again");
      expect(updated.position).toBe(2);
      const renames = vi.mocked(fs.rename).mock;
      const write = renames.calls.findIndex(([, to]) => String(to).startsWith(project.paths.storiesDir));
      expect(write).toBeGreaterThanOrEqual(0);
      const writeOrder = renames.invocationCallOrder[write] as number;
      const reads = storyReads((order) => order < writeOrder);
      expect(reads.size).toBe(4);
      expect([...reads.values()].every((count) => count === 1)).toBe(true);
    });
  });
});
