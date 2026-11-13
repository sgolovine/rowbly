import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, it } from "node:test";

const script = new URL("./factory-state.mjs", import.meta.url);
let root;
let directory;
let path;
const empty = () => ({ version: 1, scan: { stages: {} }, attempts: [] });
const attempt = (status) => ({ story: "ROW-08", stage: "IN_DEVELOPMENT", workerId: status, status,
  workerType: "thread", model: "gpt-sol", result: null, reported: false, options: { effort: "medium" } });
const run = (command, input, options = {}) => spawnSync(process.execPath,
  [script.pathname, command, "--root", root], { encoding: "utf8", input: input === undefined ? undefined : JSON.stringify(input), ...options });
const checkError = (result) => {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
  const { error } = JSON.parse(result.stderr);
  assert.equal(error.path, resolve(path));
  assert.match(error.hint, /repair/i);
  assert.match(error.hint, /harness.*active workers/);
  assert.ok(error.message);
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rowbly-factory-state-"));
  directory = join(root, ".rowbly");
  path = join(directory, "state.json");
  await mkdir(directory);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("reads an empty state without creating a file", async () => {
  const result = run("read");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ...empty(), updatedAt: null });
  assert.deepEqual(await readdir(directory), []);
});

it("persists stages, extra keys and active and completed attempts across new processes", () => {
  const state = { ...empty(), updatedAt: "2000-01-01T00:00:00.000Z",
    scan: { stages: { "ROW-08": "IN_DEVELOPMENT" }, count: 12 },
    attempts: [attempt("running"), attempt("completed")] };
  const before = Date.now();
  const written = run("write", state);
  assert.equal(written.status, 0, written.stderr);
  const result = run("read");
  assert.equal(result.status, 0, result.stderr);
  const restored = JSON.parse(result.stdout);
  assert.deepEqual(restored.scan, state.scan);
  assert.deepEqual(restored.attempts, state.attempts);
  assert.ok(Date.parse(restored.updatedAt) >= before);
});

const invalid = [null, [], {}, { ...empty(), version: 2 }, { ...empty(), scan: { stages: [] } },
  { ...empty(), scan: { stages: { "ROW-08": 8 } } }, { ...empty(), attempts: {} },
  ...[null, {}, { ...attempt("running"), story: 8 }, { ...attempt("running"), stage: null },
    { ...attempt("running"), workerId: false }, attempt("unknown")].map((value) => ({ ...empty(), attempts: [value] }))];
for (const [index, state] of invalid.entries()) {
  it(`rejects invalid document ${index} on read and write without changing the file`, async () => {
    const malformed = JSON.stringify(state);
    await writeFile(path, malformed);
    checkError(run("read"));
    checkError(run("write", empty()));
    assert.equal(await readFile(path, "utf8"), malformed);
    const original = JSON.stringify(empty());
    await writeFile(path, original);
    checkError(run("write", state));
    assert.equal(await readFile(path, "utf8"), original);
    assert.deepEqual(await readdir(directory), ["state.json"]);
  });
}

it("preserves bad JSON and rejects bad stdin", async () => {
  await writeFile(path, "{bad JSON\n");
  checkError(run("read"));
  checkError(run("write", empty()));
  assert.equal(await readFile(path, "utf8"), "{bad JSON\n");
  await writeFile(path, JSON.stringify(empty()));
  checkError(run("write", undefined, { input: "{bad JSON" }));
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), empty());
});

for (const operation of ["sync", "rename"]) {
  it(`removes the temporary file and preserves the earlier state after a failed ${operation}`, async () => {
    const original = JSON.stringify({ ...empty(), attempts: [attempt("running")] });
    await writeFile(path, original);
    // Inject the failure in the child process after the temporary file exists.
    const hook = join(root, "fail-io.mjs");
    await writeFile(hook, `import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      const fail = async () => { throw Object.assign(new Error("Permission denied"), { code: "EACCES" }); };
      if (${JSON.stringify(operation)} === "rename") fs.rename = fail;
      else { const open = fs.open; fs.open = async (...args) => {
        const file = await open(...args); file.sync = fail; return file;
      }; }
      syncBuiltinESMExports();
    `);
    checkError(run("write", empty(), { env: { ...process.env, NODE_OPTIONS: `--import=${hook}` } }));
    assert.equal(await readFile(path, "utf8"), original);
    assert.deepEqual(await readdir(directory), ["state.json"]);
    assert.equal(run("read").status, 0);
  });
}

it("fails for a missing Project directory without creating it", async () => {
  await rm(directory, { recursive: true });
  checkError(run("read"));
  checkError(run("write", empty()));
  assert.deepEqual(await readdir(root), []);
});

it("prints usage and exits 2 for invalid arguments", () => {
  for (const args of [[], ["read"], ["remove", "--root", root], ["read", "--root", root, "extra"], ["--unknown"]]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^Usage:/);
  }
});

it("preserves the earlier state when the Project directory is read-only", async (t) => {
  if (process.getuid?.() === 0) return t.skip("Root bypasses directory permissions");
  const original = JSON.stringify(empty());
  await writeFile(path, original);
  await chmod(directory, 0o555);
  try {
    checkError(run("write", { ...empty(), attempts: [attempt("running")] }));
    assert.equal(await readFile(path, "utf8"), original);
    assert.deepEqual(await readdir(directory), ["state.json"]);
  } finally {
    await chmod(directory, 0o755);
  }
});

it("takes over a definitely dead state owner and preserves a live old lock", async () => {
  const { newOwner } = await import("./ownership-lock.mjs");
  const { withStateLock } = await import("./factory-state.mjs");
  const owner = await newOwner();
  await writeFile(`${path}.lock`, JSON.stringify({ ...owner, processIdentity: "old-boot:1" }));
  await withStateLock(root, async () => {
    const held = JSON.parse(await readFile(`${path}.lock`, "utf8"));
    assert.notEqual(held.token, owner.token);
    const { acquireOwner } = await import("./ownership-lock.mjs");
    const blocked = await acquireOwner(`${path}.lock`, `${path}.lock.guard`, await newOwner());
    assert.equal(blocked.acquired, false);
  });
  assert.deepEqual(await readdir(directory), []);
});
