// Tests watch-stages.mjs as a subprocess, because the script has no exports and runs on import.
//
// Run with `pnpm test:factory`. This suite uses node:test and is separate from the Vitest suite in src/.

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "watch-stages.mjs");
const repoRoot = resolve(here, "../../..");

// Stands in for rowbly: logs its arguments and plays one response per call, repeating the last response.
const FAKE_ROWBLY = `
import { appendFileSync, readFileSync } from "node:fs";
const [responsesFile, callsFile, ...args] = process.argv.slice(2);
appendFileSync(callsFile, JSON.stringify(args) + "\\n");
const calls = readFileSync(callsFile, "utf8").trim().split("\\n").length;
const responses = JSON.parse(readFileSync(responsesFile, "utf8"));
const response = responses[Math.min(calls, responses.length) - 1];
if (response.fail) {
  process.stderr.write(response.fail + " on call " + calls);
  process.exitCode = 1;
} else {
  process.stdout.write(response.raw ?? JSON.stringify(response.stories));
}
`;

const stories = (stages) => ({ stories: Object.entries(stages).map(([id, stage]) => ({ id, stage, title: id })) });
const parseLines = (text) => text.split("\n").filter(Boolean).map((line) => JSON.parse(line));

let dir;
let rootDir;
let fake;
let responsesFile;
let callsFile;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rowbly-watch-stages-"));
  rootDir = join(dir, "project");
  fake = join(dir, "fake-rowbly.mjs");
  responsesFile = join(dir, "responses.json");
  callsFile = join(dir, "calls.jsonl");
  await writeFile(fake, FAKE_ROWBLY);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const respond = (...responses) => writeFile(responsesFile, JSON.stringify(responses));
const fakeCommand = () => ["--", process.execPath, fake, responsesFile, callsFile];
const recordedCalls = async () => parseLines(await readFile(callsFile, "utf8").catch(() => ""));

/** Runs the script to its exit and gives the exit code, the JSON lines of stdout and the text of stderr. */
async function runScript(args, options) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], options);
    return { code: 0, lines: parseLines(stdout), stderr };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return { code: error.code, lines: parseLines(error.stdout), stderr: error.stderr };
  }
}

const once = (...command) => runScript(["--root", rootDir, "--once", ...command]);

/** Starts the script in its polling mode. The function gives the output so far, and stops the process at the end. */
async function whilePolling(test) {
  const child = spawn(process.execPath, [
    script,
    "--root",
    rootDir,
    "--interval",
    "0.02",
    ...fakeCommand(),
  ]);
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  try {
    await test(() => parseLines(stdout));
  } finally {
    child.kill();
  }
}

async function waitFor(condition) {
  for (let elapsed = 0; elapsed < 20_000; elapsed += 20) {
    if (await condition()) return;
    await sleep(20);
  }
  assert.fail(`Timed out while waiting for: ${condition}`);
}

describe("watch-stages --once", () => {
  it("reports every existing story on startup with its lock", async () => {
    const current = stories({ "ROW-01": "DOING", "ROW-02": "DOING", "ROW-03": "DOING" }).stories;
    current[1].agentLock = { agent: "other-worker", stage: "DOING", lockedAt: "2026-11-10T20:00:00Z" };
    await respond({ stories: current });

    const { code, lines } = await once(...fakeCommand());

    assert.equal(code, 0);
    assert.deepEqual(lines, [{ event: "watching", stories: 3 }, { event: "stories", stories: current }]);
  });

  it("calls the command with the root, --json and search-stories", async () => {
    await respond(stories({}));
    await once(...fakeCommand());
    assert.deepEqual(await recordedCalls(), [["-C", rootDir, "--json", "search-stories"]]);
  });

  it("reports unchanged stories again on a later run", async () => {
    const current = stories({ "ROW-01": "DOING" });
    await respond(current);
    const first = await once(...fakeCommand());
    const second = await once(...fakeCommand());
    assert.deepEqual(first.lines, [{ event: "watching", stories: 1 }, { event: "stories", ...current }]);
    assert.deepEqual(second.lines, first.lines);
  });

  it("reports new stories and omits deleted stories", async () => {
    await respond(stories({ "ROW-01": "DOING" }), stories({ "ROW-02": "DOING" }));
    await once(...fakeCommand());
    const { lines } = await once(...fakeCommand());
    assert.deepEqual(lines[1], { event: "stories", ...stories({ "ROW-02": "DOING" }) });
  });

  it("reports a command failure with its output and exits 1", async () => {
    await respond({ fail: "no project" });
    const { code, lines } = await once(...fakeCommand());
    assert.equal(code, 1);
    assert.deepEqual(lines, [{ event: "error", message: "no project on call 1" }]);
  });

  it("reports an error when the command does not print JSON", async () => {
    await respond({ raw: "not json" });
    const { code, lines } = await once(...fakeCommand());
    assert.equal(code, 1);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].event, "error");
  });

  it("reports an error when the command does not print a list", async () => {
    await respond({ raw: '{"error":"nope"}' });
    const { code, lines } = await once(...fakeCommand());
    assert.equal(code, 1);
    assert.deepEqual(lines, [{ event: "error", message: "search-stories did not return a list" }]);
  });
});

describe("watch-stages usage", () => {
  const usageCases = {
    "no --root": [],
    "a command separator with no command": ["--root", "project", "--"],
    "an interval that is not a number": ["--root", "project", "--interval", "soon"],
    "an interval of zero": ["--root", "project", "--interval", "0"],
  };

  for (const [name, args] of Object.entries(usageCases)) {
    it(`prints the usage and exits 2 for ${name}`, async () => {
      const { code, lines, stderr } = await runScript(args);

      assert.equal(code, 2);
      assert.deepEqual(lines, []);
      assert.match(stderr, /^Usage: watch-stages\.mjs/);
    });
  }
});

describe("watch-stages polling", () => {
  it("announces once and reports all stories on every poll", async () => {
    const current = stories({ "ROW-01": "DOING" });
    await respond(current);
    await whilePolling(async (output) => {
      await waitFor(() => output().length >= 4);
      assert.deepEqual(output()[0], { event: "watching", stories: 1 });
      assert.ok(output().slice(1).every((event) => {
        assert.deepEqual(event, { event: "stories", ...current });
        return true;
      }));
    });
  });

  it("reports repeated failures one time, on the third failure", async () => {
    await respond({ fail: "down" });
    await whilePolling(async (output) => {
      await waitFor(async () => (await recordedCalls()).length >= 6);
      assert.deepEqual(output(), [{ event: "error", message: "down on call 3" }]);
    });
  });

  it("reports the current stories after recovery without a stage change", async () => {
    const current = stories({ "ROW-01": "DOING" });
    await respond(current, { fail: "blip" }, current);
    await whilePolling(async (output) => {
      await waitFor(() => output().length >= 3);
      assert.deepEqual(output().slice(0, 3), [
        { event: "watching", stories: 1 },
        { event: "stories", ...current },
        { event: "stories", ...current },
      ]);
    });
  });

  it("reports a released lock while the story stays in the same stage", async () => {
    const current = stories({ "ROW-01": "DOING" });
    const locked = { ...current.stories[0], agentLock: { agent: "other", stage: "DOING" } };
    await respond({ stories: [locked] }, current);
    await whilePolling(async (output) => {
      await waitFor(() => output().length >= 3);
      assert.deepEqual(output()[1], { event: "stories", stories: [locked] });
      assert.deepEqual(output()[2], { event: "stories", ...current });
    });
  });
});

describe("watch-stages with the real CLI", () => {
  const cliCommand = [process.execPath, "--import", "tsx", join(repoRoot, "src/cli.ts")];

  // The working directory lets the child processes resolve the `tsx` loader.
  const options = () => ({ cwd: repoRoot, env: { ...process.env, HOME: dir, USERPROFILE: dir } });
  const watch = () => runScript(["--root", dir, "--once", "--", ...cliCommand], options());
  const rowbly = (...args) => execFileAsync(cliCommand[0], [...cliCommand.slice(1), "-C", dir, ...args], options());

  it("reports a story that moves to a different stage", async () => {
    await rowbly("init", "--name", "Watch", "--key", "ROW");
    await rowbly("create-story", "--title", "A story", "--stage", "BACKLOG");

    const first = await watch();
    assert.equal(first.lines[1].event, "stories");
    assert.equal(first.lines[1].stories[0].stage, "BACKLOG");

    await rowbly("update-story", "ROW-01", "--stage", "DONE");

    const second = await watch();
    assert.equal(second.code, 0);
    assert.deepEqual(second.lines[0], { event: "watching", stories: 1 });
    assert.equal(second.lines[1].event, "stories");
    assert.equal(second.lines[1].stories[0].id, "ROW-01");
    assert.equal(second.lines[1].stories[0].stage, "DONE");
  });
});
