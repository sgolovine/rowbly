import { chmod, mkdir, readFile, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { getFactoryActivity } from "./factory-activity.js";

const STORIES = [
  { id: "ROW-01", stage: "IN_DEVELOPMENT" },
  { id: "ROW-02", stage: "IN_REVIEW" },
];

const attempt = (fields: Record<string, unknown>) => ({
  story: "ROW-01",
  stage: "IN_DEVELOPMENT",
  workerId: "worker-1",
  model: "claude-opus",
  status: "running",
  ...fields,
});

const state = (attempts: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, updatedAt: null, scan: { count: 1, stages: {} }, attempts, ...extra });

describe("getFactoryActivity", () => {
  const project = useTestProject();
  const path = () => join(project.paths.dir, "state.json");
  const read = () => getFactoryActivity({ stories: STORIES }, project.ctx);
  const activity = async () => (await read()).stories;

  describe("activity rules", () => {
    it("gives no activity without an attempt", async () => {
      await project.write("state.json", state([]));
      expect(await read()).toEqual({ path: path(), status: "ok", stories: {} });
    });

    it("gives no activity when all attempts are terminal", async () => {
      await project.write("state.json", state([attempt({ status: "completed" }), attempt({ status: "failed" })]));
      expect(await activity()).toEqual({});
    });

    it("gives the model of one active attempt", async () => {
      await project.write("state.json", state([attempt({ status: "completed" }), attempt({ status: "preparing" })]));
      expect(await activity()).toEqual({ "ROW-01": { kind: "active", label: "claude-opus", host: "local" } });
    });

    it("gives the worker ID when the model is absent", async () => {
      await project.write("state.json", state([attempt({ model: undefined })]));
      expect(await activity()).toEqual({ "ROW-01": { kind: "active", label: "worker-1", host: "local" } });
    });

    it("gives the recorded host of an active attempt, and local for an old attempt without it", async () => {
      await project.write(
        "state.json",
        state([attempt({ host: "builder" }), attempt({ story: "ROW-02", stage: "IN_REVIEW", host: undefined })]),
      );
      expect(await read()).toEqual({
        path: path(),
        status: "ok",
        stories: {
          "ROW-01": { kind: "active", label: "claude-opus", host: "builder" },
          "ROW-02": { kind: "active", label: "claude-opus", host: "local" },
        },
      });
    });

    it("gives unavailable for an attempt with a host that is not a string", async () => {
      await project.write("state.json", state([attempt({ host: 7 })]));
      expect(await read()).toMatchObject({ status: "unavailable", message: "attempts[0].host must be a string" });
    });

    it("gives a conflict for a later terminal attempt after an active one", async () => {
      await project.write(
        "state.json",
        state([attempt({ workerId: "old" }), attempt({ workerId: "new", status: "completed" })]),
      );
      expect(await activity()).toEqual({ "ROW-01": { kind: "conflict" } });
    });

    it("gives a conflict for two active attempts", async () => {
      await project.write("state.json", state([attempt({ workerId: "a" }), attempt({ workerId: "b" })]));
      expect(await activity()).toEqual({ "ROW-01": { kind: "conflict" } });
    });

    it("ignores an attempt for another Stage", async () => {
      await project.write("state.json", state([attempt({ stage: "IN_REFINEMENT" })]));
      expect(await read()).toEqual({ path: path(), status: "ok", stories: {} });
    });

    it("ignores a later attempt for another Stage", async () => {
      await project.write("state.json", state([attempt({}), attempt({ stage: "IN_REFINEMENT", status: "failed" })]));
      expect(await activity()).toEqual({ "ROW-01": { kind: "active", label: "claude-opus", host: "local" } });
    });

    it("ignores an attempt for a deleted Story", async () => {
      await project.write("state.json", state([attempt({ story: "ROW-99" })]));
      expect(await read()).toEqual({ path: path(), status: "ok", stories: {} });
    });

    it.each(["workerId", "stage", "status"])("gives unknown when %s is absent", async (key) => {
      await project.write("state.json", state([attempt({ [key]: undefined })]));
      const result = await read();
      expect(result.status).toBe("incomplete");
      expect(result.message).toBe(`Missing attempts[0].${key}`);
      expect(result.stories).toEqual({ "ROW-01": { kind: "unknown" } });
    });

    it("gives the activity of each Story separately", async () => {
      await project.write(
        "state.json",
        state([attempt({}), attempt({ story: "ROW-02", stage: "IN_REVIEW", workerId: "w2", model: undefined })]),
      );
      expect(await activity()).toEqual({
        "ROW-01": { kind: "active", label: "claude-opus", host: "local" },
        "ROW-02": { kind: "active", label: "w2", host: "local" },
      });
    });
  });

  describe("state file cases", () => {
    it("gives missing when the file does not exist", async () => {
      expect(await read()).toEqual({ path: path(), status: "missing", stories: {} });
    });

    it("gives unavailable when the file cannot be read", async () => {
      await mkdir(path());
      const result = await read();
      expect(result).toMatchObject({ path: path(), status: "unavailable", stories: {} });
      expect(result.message).toContain("EISDIR");
    });

    it.skipIf(process.getuid?.() === 0)("gives unavailable for a permission error", async () => {
      await project.write("state.json", state([attempt({})]));
      await chmod(path(), 0o000);
      try {
        const result = await read();
        expect(result).toMatchObject({ status: "unavailable", stories: {} });
        expect(result.message).toContain("EACCES");
      } finally {
        await chmod(path(), 0o600);
      }
    });

    it.each([
      ["text that is not JSON", "{ nope", /not valid JSON/],
      [
        "conflict markers",
        `<<<<<<< HEAD\n${state([attempt({})])}\n=======\n${state([])}\n>>>>>>> main\n`,
        /conflict markers/,
      ],
      ["an array", "[]", /not a JSON object/],
      ["no version", JSON.stringify({ scan: {}, attempts: [] }), /version is missing/],
      ["an unsupported version", state([], { version: 2 }), /Unsupported version 2/],
      ["attempts of the wrong type", state([], { attempts: {} }), /attempts must be an array/],
      ["scan of the wrong type", state([], { scan: [] }), /scan must be an object/],
      ["a field of the wrong type", state([attempt({ workerId: 7 })]), /attempts\[0\]\.workerId must be a string/],
      ["an unknown status", state([attempt({ status: "sleeping" })]), /"sleeping" is not a known status/],
    ])("gives unavailable and no activity for %s", async (_name, content, message) => {
      await project.write("state.json", content);
      const result = await read();
      expect(result).toMatchObject({ path: path(), status: "unavailable", stories: {} });
      expect(result.message).toMatch(message);
    });

    it("gives unavailable for an invalid attempt, also when other attempts are valid", async () => {
      await project.write(
        "state.json",
        state([attempt({ story: "ROW-02", stage: "IN_REVIEW" }), attempt({ status: 1 })]),
      );
      expect(await read()).toMatchObject({ status: "unavailable", stories: {} });
    });

    it.each(["scan", "attempts"])("gives incomplete when %s is absent", async (key) => {
      const content = JSON.parse(state([attempt({})]));
      delete content[key];
      await project.write("state.json", JSON.stringify(content));
      const result = await read();
      expect(result.status).toBe("incomplete");
      expect(result.message).toBe(`Missing ${key}`);
      expect(result.stories).toEqual(
        key === "scan" ? { "ROW-01": { kind: "active", label: "claude-opus", host: "local" } } : {},
      );
    });

    it("gives incomplete for an attempt without a Story, and the activity of the attempts that match", async () => {
      await project.write(
        "state.json",
        state([attempt({ story: undefined }), attempt({ story: "ROW-02", stage: "IN_REVIEW" })]),
      );
      expect(await read()).toEqual({
        path: path(),
        status: "incomplete",
        message: "Missing attempts[0].story",
        stories: { "ROW-02": { kind: "active", label: "claude-opus", host: "local" } },
      });
    });

    it("names only the first missing parts", async () => {
      await project.write("state.json", JSON.stringify({ version: 1, attempts: [{}] }));
      expect((await read()).message).toBe("Missing scan, attempts[0].story, attempts[0].stage and 2 more");
    });

    it("keeps the extra fields of the state format", async () => {
      await project.write(
        "state.json",
        state([attempt({ options: [{ id: "effort", value: "high" }], startedAt: "2026-11-10T00:00:00Z" })], {
          updatedAt: "2026-11-10T00:00:00Z",
        }),
      );
      expect((await read()).status).toBe("ok");
    });
  });

  it.each([
    ["an invalid file", "{ nope"],
    ["a file with conflict markers", "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> main\n"],
  ])("does not change %s", async (_name, content) => {
    await project.write("state.json", content);
    const before = await stat(path());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await read()).status).toBe("unavailable");
    expect(await readFile(path(), "utf8")).toBe(content);
    expect((await stat(path())).mtimeMs).toBe(before.mtimeMs);
  });

  it.skipIf(process.getuid?.() === 0)("does not change an unreadable file", async () => {
    await project.write("state.json", "{ nope");
    await chmod(path(), 0o000);
    const before = await stat(path());
    try {
      expect((await read()).status).toBe("unavailable");
      expect((await stat(path())).mtimeMs).toBe(before.mtimeMs);
      expect((await stat(path())).size).toBe(before.size);
    } finally {
      await chmod(path(), 0o600);
    }
    expect(await readFile(path(), "utf8")).toBe("{ nope");
  });

  describe("cache of the state file", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Counts the parses of the state file only, because other reads also use `JSON.parse`. */
    const countParses = (content: string) => {
      const parse = vi.spyOn(JSON, "parse");

      return () => parse.mock.calls.filter(([text]) => text === content).length;
    };

    it("parses an unchanged file only one time", async () => {
      const content = state([attempt({})]);
      await project.write("state.json", content);
      const parses = countParses(content);
      const first = await read();
      const second = await read();
      expect(parses()).toBe(1);
      expect(second).toEqual(first);
      expect(second.stories).toEqual({ "ROW-01": { kind: "active", label: "claude-opus", host: "local" } });
    });

    it("gives the activity of the new content after the file changes", async () => {
      await project.write("state.json", state([attempt({})]));
      expect(await activity()).toEqual({ "ROW-01": { kind: "active", label: "claude-opus", host: "local" } });
      await project.write("state.json", state([attempt({ status: "completed" }), attempt({ status: "failed" })]));
      expect(await activity()).toEqual({});
    });

    it("reads the file again when only the modification time changes", async () => {
      await project.write("state.json", state([attempt({ model: "model-a" })]));
      expect(await activity()).toEqual({ "ROW-01": { kind: "active", label: "model-a", host: "local" } });
      const before = await stat(path());
      await project.write("state.json", state([attempt({ model: "model-b" })]));
      await utimes(path(), before.atime, new Date(before.mtimeMs + 5000));
      expect((await stat(path())).size).toBe(before.size);
      expect(await activity()).toEqual({ "ROW-01": { kind: "active", label: "model-b", host: "local" } });
    });

    it("gives missing after the file is removed", async () => {
      await project.write("state.json", state([attempt({})]));
      expect((await read()).status).toBe("ok");
      await rm(path());
      expect(await read()).toEqual({ path: path(), status: "missing", stories: {} });
    });

    it("gives ok after an invalid file becomes valid", async () => {
      await project.write("state.json", "{ nope");
      expect((await read()).status).toBe("unavailable");
      await project.write("state.json", state([attempt({})]));
      expect(await read()).toEqual({
        path: path(),
        status: "ok",
        stories: { "ROW-01": { kind: "active", label: "claude-opus", host: "local" } },
      });
    });

    it("keeps the file order of the attempts of a Story between the attempts of other Stories", async () => {
      await project.write(
        "state.json",
        state([
          attempt({ workerId: "old" }),
          attempt({ story: "ROW-02", stage: "IN_REVIEW", status: "completed" }),
          attempt({ story: "ROW-00", stage: "IN_REVIEW" }),
          attempt({ workerId: "new", status: "completed" }),
          attempt({ story: "ROW-02", stage: "IN_REVIEW", workerId: "w2" }),
        ]),
      );
      expect(await activity()).toEqual({
        "ROW-01": { kind: "conflict" },
        "ROW-02": { kind: "active", label: "claude-opus", host: "local" },
      });
    });

    it("gives the activity of each Story list from one unchanged file", async () => {
      const content = state([attempt({}), attempt({ story: "ROW-02", stage: "IN_REVIEW", workerId: "w2" })]);
      await project.write("state.json", content);
      const parses = countParses(content);
      const first = await getFactoryActivity({ stories: [{ id: "ROW-01", stage: "IN_DEVELOPMENT" }] }, project.ctx);
      const second = await getFactoryActivity({ stories: [{ id: "ROW-02", stage: "IN_REVIEW" }] }, project.ctx);
      const moved = await getFactoryActivity({ stories: [{ id: "ROW-01", stage: "IN_REVIEW" }] }, project.ctx);
      expect(parses()).toBe(1);
      expect(first.stories).toEqual({ "ROW-01": { kind: "active", label: "claude-opus", host: "local" } });
      expect(second.stories).toEqual({ "ROW-02": { kind: "active", label: "claude-opus", host: "local" } });
      expect(moved.stories).toEqual({});
    });
  });
});
