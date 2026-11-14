import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acquireOwner, newOwner } from "../factory-ownership/ownership-lock.js";
import type { PolicyAttempt, PolicyState } from "../factory-policy/factory-policy.js";
import { useTempDir } from "../test-project/test-project.js";
import { readState, resetState, withStateLock, writeState } from "./state-file.js";

const failure = vi.hoisted(() => ({ operation: undefined as "sync" | "rename" | undefined }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const fail = async () => {
    throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
  };
  const open: typeof actual.open = async (...args) => {
    const file = await actual.open(...args);
    if (failure.operation === "sync") file.sync = fail;
    return file;
  };
  const rename: typeof actual.rename = (...args) => (failure.operation === "rename" ? fail() : actual.rename(...args));
  return { ...actual, open, rename };
});

const empty = (): PolicyState => ({ version: 1, scan: { stages: {} }, attempts: [] });
const attempt = (status: string) =>
  ({
    story: "ROW-08",
    stage: "IN_DEVELOPMENT",
    workerId: status,
    status,
    workerType: "thread",
    model: "gpt-sol",
    result: null,
    reported: false,
    options: { effort: "medium" },
  }) as PolicyAttempt;

describe("factory state file", () => {
  const dir = useTempDir();
  const root = () => dir.path;
  const directory = () => join(dir.path, ".rowbly");
  const path = () => join(directory(), "state.json");
  const expectStateError = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught as Error & { path?: string; hint?: string },
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.path).toBe(resolve(path()));
    expect(error?.hint).toMatch(/repair/i);
    expect(error?.hint).toMatch(/harness.*active workers/);
    expect(error?.message).toBeTruthy();
  };

  beforeEach(async () => {
    failure.operation = undefined;
    await mkdir(directory());
  });

  it("reads an empty state without creating a file", async () => {
    expect(await readState(root())).toEqual({ ...empty(), updatedAt: null });
    expect(await readdir(directory())).toEqual([]);
  });

  it("persists stages, extra keys and active and completed attempts", async () => {
    const state: PolicyState = {
      ...empty(),
      updatedAt: "2000-01-01T00:00:00.000Z",
      scan: { stages: { "ROW-08": "IN_DEVELOPMENT" }, count: 12 },
      attempts: [attempt("running"), attempt("completed")],
    };
    const before = Date.now();
    await writeState(root(), state);
    const restored = await readState(root());
    expect(restored.scan).toEqual(state.scan);
    expect(restored.attempts).toEqual(state.attempts);
    expect(Date.parse(restored.updatedAt ?? "")).toBeGreaterThanOrEqual(before);
  });

  const invalid: unknown[] = [
    null,
    [],
    {},
    { ...empty(), version: 2 },
    { ...empty(), scan: { stages: [] } },
    { ...empty(), scan: { stages: { "ROW-08": 8 } } },
    { ...empty(), attempts: {} },
    ...[
      null,
      {},
      { ...attempt("running"), story: 8 },
      { ...attempt("running"), stage: null },
      { ...attempt("running"), workerId: false },
      attempt("unknown"),
    ].map((value) => ({ ...empty(), attempts: [value] })),
  ];
  it.each(invalid.map((state, index) => [index, state]))(
    "rejects invalid document %i on read and write without changing the file",
    async (_index, state) => {
      const malformed = JSON.stringify(state);
      await writeFile(path(), malformed);
      await expectStateError(readState(root()));
      await expectStateError(writeState(root(), empty()));
      expect(await readFile(path(), "utf8")).toBe(malformed);
      const original = JSON.stringify(empty());
      await writeFile(path(), original);
      await expectStateError(writeState(root(), state as PolicyState));
      expect(await readFile(path(), "utf8")).toBe(original);
      expect(await readdir(directory())).toEqual(["state.json"]);
    },
  );

  it("preserves bad JSON", async () => {
    await writeFile(path(), "{bad JSON\n");
    await expectStateError(readState(root()));
    await expectStateError(writeState(root(), empty()));
    expect(await readFile(path(), "utf8")).toBe("{bad JSON\n");
  });

  it.each(["sync", "rename"] as const)(
    "removes the temporary file and preserves the earlier state after a failed %s",
    async (operation) => {
      const original = JSON.stringify({ ...empty(), attempts: [attempt("running")] });
      await writeFile(path(), original);
      failure.operation = operation;
      await expectStateError(writeState(root(), empty()));
      failure.operation = undefined;
      expect(await readFile(path(), "utf8")).toBe(original);
      expect(await readdir(directory())).toEqual(["state.json"]);
      await expect(readState(root())).resolves.toBeDefined();
    },
  );

  it("fails for a missing Project directory without creating it", async () => {
    await rm(directory(), { recursive: true });
    await expectStateError(readState(root()));
    await expectStateError(writeState(root(), empty()));
    expect(await readdir(root())).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)(
    "preserves the earlier state when the Project directory is read-only",
    async () => {
      const original = JSON.stringify(empty());
      await writeFile(path(), original);
      await chmod(directory(), 0o555);
      try {
        await expectStateError(writeState(root(), { ...empty(), attempts: [attempt("running")] }));
        expect(await readFile(path(), "utf8")).toBe(original);
        expect(await readdir(directory())).toEqual(["state.json"]);
      } finally {
        await chmod(directory(), 0o755);
      }
    },
  );

  it("takes over a definitely dead state owner and preserves a live old lock", async () => {
    const owner = await newOwner();
    const lock = `${path()}.lock`;
    await writeFile(lock, JSON.stringify({ ...owner, processIdentity: "old-boot:1" }));
    await withStateLock(root(), async () => {
      const held = JSON.parse(await readFile(lock, "utf8"));
      expect(held.token).not.toBe(owner.token);
      const blocked = await acquireOwner(lock, `${lock}.guard`, await newOwner());
      expect(blocked.acquired).toBe(false);
    });
    expect(await readdir(directory())).toEqual([]);
  });

  it("moves an invalid file away and keeps its valid parts", async () => {
    const old = { scan: { count: 4 }, attempts: [attempt("running"), { story: 1 }], notes: ["keep"], other: true };
    await writeFile(path(), JSON.stringify(old));
    const result = await resetState(root());
    expect(result.attempts).toBe(1);
    expect(await readFile(result.moved ?? "", "utf8")).toBe(JSON.stringify(old));
    const state = await readState(root());
    expect(state.scan).toEqual({ stages: {}, count: 4 });
    expect(state.attempts).toEqual([attempt("running")]);
    expect(state.notes).toEqual(["keep"]);
    expect(state.other).toBeUndefined();
    expect(await resetState(join(root(), "none")).catch(() => "error")).toBe("error");
  });

  it("starts a new state from a file that is not JSON, and does nothing without a file", async () => {
    expect(await resetState(root())).toEqual({ moved: null, attempts: 0 });
    await writeFile(path(), "{bad");
    expect((await resetState(root())).attempts).toBe(0);
    expect(await readState(root())).toMatchObject(empty());
  });
});
