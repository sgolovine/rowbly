// Tests factory.mjs as a subprocess, with a stand-in for the rowbly command.
//
// Run with `pnpm test:factory`. This suite uses node:test and is separate from the Vitest suite in src/.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./factory.mjs", import.meta.url));
const repoRoot = resolve(script, "../../../..");

// Stands in for rowbly: answers from a JSON file that the test changes.
const FAKE_ROWBLY = `
import { readFileSync } from "node:fs";
const [worldFile, ...args] = process.argv.slice(2);
const world = JSON.parse(readFileSync(worldFile, "utf8"));
const [resource, action, id] = args.slice(args.indexOf("--json") + 1);
const fail = (message) => {
  process.stderr.write(JSON.stringify({ error: { code: "NOT_FOUND", message } }));
  process.exit(1);
};
if (world.fail) fail(world.fail);
const invalid = world.invalid ?? [];
if (resource === "story" && action === "search") {
  if (invalid.length > 0) fail(invalid[0] + " is invalid");
  console.log(JSON.stringify(world.stories));
} else if (resource === "story" && action === "get") {
  const story = world.stories.find((story) => story.id.toLowerCase() === id.toLowerCase());
  if (story && !invalid.includes(story.id)) console.log(JSON.stringify(story));
  else fail("no story");
} else if (resource === "project") console.log(JSON.stringify({ instructions: world.instructions ?? "" }));
else if (resource === "doctor") {
  console.log(JSON.stringify({ issues: world.issues ?? [] }));
  if (world.issues?.length) process.exitCode = 1;
} else fail("unknown command");
`;

const STAGES = { BACKLOG: "hold", IN_REFINEMENT: "work", IN_DEVELOPMENT: "work", IN_REVIEW: "work", DONE: "hold" };
const story = (id, stage, extra = {}) => ({ id, number: Number(id.split("-")[1]), stage, title: id, description: "", fields: {}, ...extra });

let dir;
let root;
let fake;
let worldFile;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "rowbly-factory-")));
  root = join(dir, "project");
  fake = join(dir, "fake-rowbly.mjs");
  worldFile = join(dir, "world.json");
  await mkdir(join(root, ".rowbly", "stages"), { recursive: true });
  await writeFile(fake, FAKE_ROWBLY);
  const stages = Object.keys(STAGES).map((key) => ({ key, label: key, enabled: true }));
  await writeFile(join(root, ".rowbly", "rowbly.config.json"), JSON.stringify({ projectKey: "ROW", stages }));
  for (const key of Object.keys(STAGES)) await writePrompt(key, `Prompt of ${key}.`);
  await world({ stories: [] });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const world = (value) => writeFile(worldFile, JSON.stringify(value));
const writePrompt = (key, text) => writeFile(join(root, ".rowbly", "stages", `${key}.md`), text);
const statePath = () => join(root, ".rowbly", "state.json");
const readState = async () => JSON.parse(await readFile(statePath(), "utf8"));

/** Runs one command. Gives the exit code, the parsed JSON of stdout or stderr, and the text of stdout. */
function factory(...args) {
  const withFake = args.includes("--") ? args : [...args, "--", process.execPath, fake, worldFile];
  const result = spawnSync(process.execPath, [script, ...withFake.slice(0, withFake.indexOf("--")), "--root", root,
    ...withFake.slice(withFake.indexOf("--"))], { encoding: "utf8", cwd: dir });
  let json = null;
  try {
    json = JSON.parse(result.status === 0 ? result.stdout : result.stderr);
  } catch {
    // `message` prints plain text.
  }
  return { code: result.status, json, text: result.stdout, stderr: result.stderr };
}

const classifyAll = () => {
  for (const [key, promptClass] of Object.entries(STAGES)) {
    assert.equal(factory("classify", "--stage", key, "--class", promptClass).code, 0);
  }
};
const scan = (...args) => factory("scan", "--no-commit", ...args);
const actionsOf = (result) => result.json.actions.join("\n");

describe("check", () => {
  it("asks for the class of each prompt, then passes", async () => {
    const first = factory("check");
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.json.result, "todo");
    assert.match(first.json.report, /\[TODO\] 6\. Stage prompt content: BACKLOG \(unclassified\)/);
    assert.equal(first.json.actions.filter((action) => action.includes("classify --stage")).length, 5);
    classifyAll();
    const second = factory("check");
    assert.equal(second.json.result, "pass");
    assert.match(second.json.report, /\[PASS\] 1\. Project: .*project\n\[PASS\] 2\. CLI/);
    assert.match(second.json.report, /\[PASS\] 6\. Stage prompt content: BACKLOG \(hold\), IN_REFINEMENT \(work\)/);
    assert.match(actionsOf(second), /Step 2: Harness checks/);
    assert.equal((await readState()).writeLock, second.json.writeLock);
  });

  it("fails without a Project and skips the other checks", () => {
    const result = spawnSync(process.execPath, [script, "check", "--root", dir], { encoding: "utf8" });
    const { result: verdict, report } = JSON.parse(result.stdout);
    assert.equal(verdict, "fail");
    assert.match(report, /\[FAIL\] 1\. Project/);
    assert.equal(report.match(/\[SKIP\]/g).length, 7);
  });

  it("warns for a prompt file that does not exist, and does not fail", async () => {
    classifyAll();
    await rm(join(root, ".rowbly", "stages", "IN_REVIEW.md"));
    const { json } = factory("check");
    assert.equal(json.result, "pass");
    assert.match(json.report, /\[WARN\] 5\. Stage prompt files: .*IN_REVIEW\.md does not exist/);
  });

  it("fails when no Stage has a work prompt", () => {
    for (const key of Object.keys(STAGES)) factory("classify", "--stage", key, "--class", "hold");
    assert.match(factory("check").json.report, /\[FAIL\] 6\. Stage prompt content: .*no Stage has a work prompt/);
  });

  it("fails when the Rowbly command fails, and names the repair", async () => {
    await world({ fail: "unknown command 'story'" });
    const { json } = factory("check");
    assert.equal(json.result, "fail");
    assert.match(json.report, /\[FAIL\] 2\. CLI: .*unknown command 'story'/);
    assert.match(actionsOf({ json }), /The Rowbly command fails/);
  });

  it("fails for a doctor error in the config, and only notes other errors", async () => {
    await world({ stories: [], issues: [{ severity: "error", file: ".rowbly/stories/ROW-01.md", message: "bad" }] });
    assert.match(factory("check").json.report, /\[PASS\] 3\. Config: Note: doctor shows 1 error/);
    await world({ stories: [], issues: [{ severity: "error", file: ".rowbly/rowbly.config.json", message: "bad key" }] });
    assert.match(factory("check").json.report, /\[FAIL\] 3\. Config: bad key/);
  });

  it("warns for a state file that is not valid, and gives the repair", async () => {
    await writeFile(statePath(), "{ not json");
    const { json } = factory("check");
    assert.match(json.report, /\[WARN\] 7\. State file/);
    assert.match(actionsOf({ json }), /reset-state/);
  });

  it("saves a different Rowbly command for the later commands", async () => {
    classifyAll();
    factory("check");
    assert.deepEqual((await readState()).rowbly, [process.execPath, fake, worldFile]);
  });
});

describe("classify", () => {
  it("asks again after the prompt file changes, and gives no worker until then", async () => {
    classifyAll();
    await world({ stories: [story("ROW-01", "IN_REVIEW"), story("ROW-02", "IN_REFINEMENT")] });
    await writePrompt("IN_REVIEW", "A new prompt.");
    const { json } = scan();
    assert.deepEqual(json.start.map(({ story }) => story), ["ROW-02"]);
    assert.deepEqual(json.waiting, [{ story: "ROW-01", stage: "IN_REVIEW", reason: "stage prompt not classified" }]);
    assert.match(json.actions[0], /IN_REVIEW\.md\. Select its class .* classify --stage IN_REVIEW/);
    factory("classify", "--stage", "in_review", "--class", "work");
    assert.deepEqual(scan().json.start.map(({ story }) => story), ["ROW-01", "ROW-02"]);
  });

  it("rejects an unknown class", () => {
    assert.equal(factory("classify", "--stage", "DONE", "--class", "maybe").code, 1);
  });
});

describe("scan", () => {
  beforeEach(classifyAll);

  it("starts a worker for each Story in a work Stage, nearest to the last Stage first", async () => {
    await world({ stories: [story("ROW-01", "BACKLOG"), story("ROW-02", "IN_REFINEMENT"), story("ROW-03", "IN_REVIEW")] });
    const { code, json } = scan();
    assert.equal(code, 0);
    assert.equal(json.scan, 1);
    assert.deepEqual(json.start, [
      { story: "ROW-03", stage: "IN_REVIEW", attempt: 1, reason: "new stage stay", branch: "row-03-in_review-1" },
      { story: "ROW-02", stage: "IN_REFINEMENT", attempt: 1, reason: "new stage stay", branch: "row-02-in_refinement-1" },
    ]);
    assert.match(json.actions[0], /^Start a worker for ROW-03 in IN_REVIEW\..* message --story ROW-03 .* started --story ROW-03 --worker-id <id> .* launch-failed --story ROW-03/);
  });

  it("obeys the worker limit", async () => {
    await world({ stories: [story("ROW-02", "IN_REFINEMENT"), story("ROW-03", "IN_REVIEW")] });
    const { json } = scan("--max-active", "1");
    assert.deepEqual(json.start.map(({ story }) => story), ["ROW-03"]);
    assert.deepEqual(json.waiting, [{ story: "ROW-02", stage: "IN_REFINEMENT", reason: "worker limit" }]);
  });

  it("asks for the status of each active worker before it scans", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    scan();
    assert.equal(factory("started", "--story", "row-01", "--worker-id", "mcp:w1", "--model", "opus").code, 0);
    const blind = scan("--max-active", "2");
    assert.deepEqual(blind.json.needStatus.map(({ story, workerId, model }) => ({ story, workerId, model })), [
      { story: "ROW-01", workerId: "mcp:w1", model: "opus" },
    ]);
    assert.match(blind.json.actions[1], /scan --worker 'mcp:w1=<status>=<result>' --max-active 2 --no-commit/);
    assert.equal((await readState()).scan.count, 1);

    const running = scan("--worker", "mcp:w1=running");
    assert.equal(running.json.scan, 2);
    assert.deepEqual(running.json.actions, ["No action is necessary. End this scan."]);
    assert.deepEqual(running.json.active.map(({ workerId }) => workerId), ["mcp:w1"]);
  });

  it("starts the next Stage when a worker stops and the Story moved", async () => {
    await world({ stories: [story("ROW-01", "IN_DEVELOPMENT")] });
    scan();
    factory("started", "--story", "ROW-01", "--worker-id", "w1");
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    const { json } = scan("--worker", "w1=completed=Complete");
    assert.deepEqual(json.start, [{ story: "ROW-01", stage: "IN_REVIEW", attempt: 1, reason: "new stage stay", branch: "row-01-in_review-2" }]);
    assert.match(actionsOf({ json }), /Tell the user: ROW-01 IN_DEVELOPMENT: worker w1 stopped\. Status: completed\. Result: complete\./);
    assert.doesNotMatch(actionsOf(scan()), /Tell the user/);
  });

  it("starts a new worker when a worker stops and the Story did not move, then parks the Story", async () => {
    await world({ stories: [story("ROW-01", "IN_DEVELOPMENT")] });
    for (let index = 1; index <= 4; index += 1) {
      const plan = scan();
      assert.equal(plan.json.start[0].attempt, index);
      if (index > 1) assert.equal(plan.json.start[0].reason, "worker stopped without a stage move");
      factory("started", "--story", "ROW-01", "--worker-id", `w${index}`);
      assert.equal(scan("--worker", `w${index}=completed=blocked`).json.waiting[0].reason, "stop confirmed this scan");
    }
    const parked = scan();
    assert.deepEqual(parked.json.start, []);
    assert.equal(parked.json.parked[0].story, "ROW-01");
    assert.match(actionsOf(parked), /Tell the user: ROW-01 is parked in IN_DEVELOPMENT: 4 workers stopped/);
    assert.doesNotMatch(actionsOf(scan()), /Tell the user/);

    assert.equal(factory("release", "--story", "ROW-01").code, 0);
    assert.deepEqual(scan().json.start, [
      { story: "ROW-01", stage: "IN_DEVELOPMENT", attempt: 1, reason: "new stage stay", branch: "row-01-in_development-5" },
    ]);
  });

  it("starts a worker again after a failure", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    scan();
    factory("started", "--story", "ROW-01", "--worker-id", "w1");
    scan("--worker", "w1=failed");
    const { json } = scan();
    assert.deepEqual(json.start[0].previous, { workerId: "w1", status: "failed", result: "failed" });
  });

  it("counts a worker with a status that it does not know as running, with a warning", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    scan();
    factory("started", "--story", "ROW-01", "--worker-id", "w1");
    const { json } = scan("--worker", "w1=thinking");
    assert.match(json.warnings[0], /"thinking" of worker w1 is not known/);
    assert.equal(json.active.length, 1);
  });

  it("names a worker that runs for a long time, one time each 30 minutes", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    scan();
    factory("started", "--story", "ROW-01", "--worker-id", "w1");
    const state = await readState();
    state.attempts[0].startedAt = new Date(Date.now() - 100 * 60_000).toISOString();
    await writeFile(statePath(), JSON.stringify(state));
    assert.match(actionsOf(scan("--worker", "w1=running")), /Worker w1 of ROW-01 has run for 100 minutes\. Do "A worker that does not stop"/);
    assert.deepEqual(scan("--worker", "w1=running").json.actions, ["No action is necessary. End this scan."]);
  });

  it("gives no worker to a Story that a different supervisor works on", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    assert.deepEqual(scan("--busy", "row-01").json.start, []);
  });

  it("reports a missing prompt one time and continues with the other Stages", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW"), story("ROW-02", "IN_REFINEMENT")] });
    await rm(join(root, ".rowbly", "stages", "IN_REVIEW.md"));
    const first = scan();
    assert.deepEqual(first.json.start.map(({ story }) => story), ["ROW-02"]);
    assert.match(actionsOf(first), /Tell the user: The prompt of Stage IN_REVIEW is missing/);
    assert.doesNotMatch(actionsOf(scan()), /is missing/);
  });

  it("changes nothing when the Rowbly command fails, and tells the supervisor to continue", async () => {
    await world({ fail: "unknown command 'story'" });
    const { code, json } = scan();
    assert.equal(code, 1);
    assert.match(json.error.message, /story search` failed: .*unknown command 'story'/);
    assert.match(json.actions.join("\n"), /Do the scan again at its next time/);
    assert.equal((await readState()).scan.count, undefined);
  });

  it("gives the repair for a state file that is not valid", async () => {
    await writeFile(statePath(), "{ not json");
    const broken = scan();
    assert.equal(broken.code, 1);
    assert.equal(broken.json.error.path, statePath());
    assert.match(broken.json.actions.join("\n"), /reset-state/);
    const reset = factory("reset-state");
    assert.match(reset.json.moved, /state\.json\.invalid-/);
    assert.equal((await readdir(join(root, ".rowbly"))).filter((name) => name.startsWith("state.json.invalid-")).length, 1);
    assert.match(reset.json.actions.join("\n"), /started --story <story> --stage <STAGE KEY> --worker-id <id>/);
    assert.equal(scan().code, 0);
  });

  it("tells the supervisor to make the schedule slower after 10 idle scans, and faster when work comes", async () => {
    for (let index = 1; index <= 9; index += 1) assert.deepEqual(scan().json.actions, ["No action is necessary. End this scan."]);
    assert.match(actionsOf(scan()), /one scan each 5 minutes/);
    assert.deepEqual(scan().json.actions, ["No action is necessary. End this scan."]);
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    assert.match(actionsOf(scan()), /back to one scan each minute/);
  });

  it("shows the notes on each scan, and asks for a new check of them each 30 scans", async () => {
    factory("note", "--text", "rook does not answer; workers run on thinkpad");
    for (let index = 1; index <= 29; index += 1) assert.equal(scan().json.recheck, false);
    const { json } = scan();
    assert.deepEqual(json.notes, ["rook does not answer; workers run on thinkpad"]);
    assert.equal(json.recheck, true);
    assert.match(actionsOf({ json }), /Try the first choice of each note again/);
    assert.deepEqual(factory("note", "--clear").json.notes, []);
  });

  it("uses the Rowbly command that check saved", async () => {
    factory("check");
    const result = spawnSync(process.execPath, [script, "scan", "--no-commit", "--root", root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  });
});

describe("problems that must not stop the factory", () => {
  beforeEach(classifyAll);

  it("continues with the other Stories when Rowbly cannot read one Story file", async () => {
    await mkdir(join(root, ".rowbly", "stories"));
    for (const id of ["ROW-01", "ROW-02"]) await writeFile(join(root, ".rowbly", "stories", `${id}.md`), "");
    await world({ stories: [story("ROW-01", "IN_REVIEW"), story("ROW-02", "IN_REVIEW")], invalid: ["ROW-02"] });
    const first = scan();
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(first.json.start.map(({ story }) => story), ["ROW-01"]);
    assert.match(actionsOf(first), /Tell the user: Rowbly cannot read the file of Story ROW-02/);
    assert.match(actionsOf(first), /Do "A Story file is not valid"/);
    assert.doesNotMatch(actionsOf(scan()), /ROW-02/);
    assert.match(factory("check").json.report, /\[WARN\] 2\. CLI: .*Rowbly cannot read ROW-02/);
  });

  it("tells the supervisor to repair the Rowbly command after 3 failures in a row, not on each scan", async () => {
    await world({ fail: "boom" });
    const repair = /failed on 3 scans in a row\. Do "The Rowbly command fails"/;
    assert.doesNotMatch(actionsOf(scan()), repair);
    assert.doesNotMatch(actionsOf(scan()), repair);
    assert.match(actionsOf(scan()), repair);
    assert.doesNotMatch(actionsOf(scan()), /The Rowbly command fails/);
    await world({ stories: [] });
    assert.equal(scan().code, 0);
    assert.equal((await readState()).rowblyFailures, undefined);
  });

  it("waits after a launch that failed, and tells the user one time", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    scan();
    const first = factory("launch-failed", "--story", "ROW-01", "--error", "usage limit reached");
    assert.match(first.json.actions[0], /Tell the user: The launch of a worker for ROW-01 failed: usage limit reached/);
    const waiting = scan().json;
    assert.deepEqual(waiting.start, []);
    assert.equal(waiting.waiting[0].reason, "launch delay");
    assert.doesNotMatch(actionsOf(factory("launch-failed", "--story", "ROW-01")), /Tell the user/);
    const state = await readState();
    state.launchFailures["ROW-01"].at = new Date(Date.now() - 3_600_000).toISOString();
    await writeFile(statePath(), JSON.stringify(state));
    assert.equal(scan().json.start.length, 1);
    factory("started", "--story", "ROW-01", "--worker-id", "w1");
    assert.deepEqual((await readState()).launchFailures, {});
  });

  it("accepts a worker ID that has an equals sign", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    scan();
    factory("started", "--story", "ROW-01", "--worker-id", "a=b");
    const { json } = scan("--worker", "a=b=completed=ready");
    assert.equal(json.scan, 2);
    assert.match(actionsOf({ json }), /worker a=b stopped\. Status: completed\. Result: ready\./);
  });

  it("keeps the worker limit for a later scan without the option", async () => {
    await world({ stories: [story("ROW-02", "IN_REFINEMENT"), story("ROW-03", "IN_REVIEW")] });
    assert.equal(scan("--max-active", "1").json.start.length, 1);
    const later = scan().json;
    assert.equal(later.start.length, 1);
    assert.equal(later.maxActive, 1);
    assert.equal(scan("--max-active", "").code, 1);
  });

  it("records a worker one time when `started` runs two times", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    scan();
    factory("started", "--story", "ROW-01", "--worker-id", "w1");
    assert.equal(factory("started", "--story", "ROW-01", "--worker-id", "w1").code, 0);
    assert.equal((await readState()).attempts.length, 1);
  });

  it("records a worker for a Story that no scan showed, so that the Story gets no second worker", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    const { code, json } = factory("started", "--story", "row-01", "--worker-id", "w1");
    assert.equal(code, 0);
    assert.deepEqual([json.recorded.story, json.recorded.stage], ["ROW-01", "IN_REVIEW"]);
    assert.deepEqual(scan().json.needStatus.map(({ workerId }) => workerId), ["w1"]);
  });

  it("keeps the valid parts of a state file that is not valid", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    const prompts = (await readState()).prompts;
    await writeFile(statePath(), JSON.stringify({
      version: 1, scan: { stages: {}, count: 7 }, notes: ["a note"], prompts,
      attempts: [{ story: "ROW-01", stage: "IN_REVIEW", workerId: "w1", status: "running" }, { story: "ROW-02", status: "strange" }],
    }));
    assert.equal(scan().code, 1);
    assert.equal(factory("reset-state").json.keptAttempts, 1);
    const state = await readState();
    assert.deepEqual([state.scan.count, state.notes, state.prompts], [7, ["a note"], prompts]);
    assert.deepEqual(scan().json.needStatus.map(({ workerId }) => workerId), ["w1"]);
  });

  it("does not lose a change when commands run at the same time", async () => {
    const runs = Array.from({ length: 8 }, (_, index) => new Promise((done) => {
      spawn(process.execPath, [script, "note", "--text", `note ${index}`, "--root", root]).on("close", done);
    }));
    assert.deepEqual(await Promise.all(runs), Array(8).fill(0));
    assert.equal((await readState()).notes.length, 8);
    assert.deepEqual((await readdir(join(root, ".rowbly"))).filter((name) => name.endsWith(".lock")), []);
  });

  it("fails the Project check in a linked Git worktree, and names the Project", async () => {
    const git = (...args) => spawnSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" });
    git("init", "-q");
    await writeFile(join(root, ".gitignore"), ".rowbly/state.json*\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    assert.equal(git("worktree", "add", "-q", join(dir, "linked"), "-b", "linked").status, 0);
    const result = spawnSync(process.execPath, [script, "check", "--root", join(dir, "linked")], { encoding: "utf8" });
    const { result: verdict, report, actions } = JSON.parse(result.stdout);
    assert.equal(verdict, "fail");
    assert.match(report, /\[FAIL\] 1\. Project: .*linked is in a linked Git worktree.* The Project is in .*project/);
    assert.match(actions[0], new RegExp(`check --root ${root}$`));
    assert.equal(actions.length, 1);
  });
});

describe("with the real CLI", () => {
  const cli = [process.execPath, "--import", "tsx", join(repoRoot, "src/cli.ts")];

  it("scans a Project, also when one Story file is not valid", async () => {
    const real = join(dir, "real");
    await mkdir(real);
    // The working directory lets the child processes resolve the `tsx` loader.
    const options = { cwd: repoRoot, encoding: "utf8", env: { ...process.env, HOME: dir, USERPROFILE: dir } };
    const rowbly = (...args) => spawnSync(cli[0], [...cli.slice(1), "-C", real, ...args], options);
    const run = (...args) => {
      const result = spawnSync(process.execPath, [script, ...args, "--root", real, "--", ...cli], options);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    assert.equal(rowbly("init", "--name", "Real", "--key", "ROW").status, 0);
    rowbly("story", "create", "--title", "First", "--stage", "IN_REVIEW");
    rowbly("story", "create", "--title", "Second", "--stage", "IN_REVIEW");
    for (const [key, promptClass] of Object.entries(STAGES)) run("classify", "--stage", key, "--class", promptClass);
    assert.match(run("check").report, /\[PASS\] 2\. CLI/);
    assert.deepEqual(run("scan", "--no-commit").start.map(({ story }) => story), ["ROW-01", "ROW-02"]);

    await writeFile(join(real, ".rowbly", "stories", "ROW-02.md"), "<<<<<<< HEAD\n---\ntitle: Second\n=======\n");
    const broken = run("scan", "--no-commit");
    assert.deepEqual(broken.start.map(({ story }) => story), ["ROW-01"]);
    assert.match(broken.actions.join("\n"), /Rowbly cannot read the file of Story ROW-02/);
  });
});

describe("scan with Git", () => {
  const git = (...args) => spawnSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" });

  it("commits the Project files, with the Story in the message after one move", async () => {
    classifyAll();
    git("init", "-q");
    await writeFile(join(root, ".gitignore"), ".rowbly/state.json*\n");
    await mkdir(join(root, ".rowbly", "stories"));
    await writeFile(join(root, ".rowbly", "stories", "ROW-01.md"), "one");
    git("add", "-A");
    git("commit", "-qm", "init");
    const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
    const run = () => JSON.parse(spawnSync(process.execPath, [script, "scan", "--root", root, "--", process.execPath, fake, worldFile], { encoding: "utf8", env }).stdout);

    await world({ stories: [story("ROW-01", "IN_DEVELOPMENT")] });
    assert.equal(run().commit.status, "clean");
    await writeFile(join(root, ".rowbly", "stories", "ROW-01.md"), "two");
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    const { commit } = run();
    assert.equal(commit.status, "committed");
    assert.deepEqual(commit.paths, [".rowbly/stories/ROW-01.md"]);
    assert.match(git("log", "-1", "--format=%s").stdout, /^chore\(rowbly\): record ROW-01 move to in review$/m);
    assert.equal(git("status", "--porcelain").stdout, "");
  });
});

describe("message", () => {
  beforeEach(classifyAll);

  it("gives the first message of a worker, with the Project instructions and the Stage prompt", async () => {
    await world({ stories: [story("ROW-01", "IN_DEVELOPMENT")], instructions: "Use pnpm.\n" });
    await writePrompt("IN_DEVELOPMENT", "Use the `develop` skill on this story.\n");
    factory("classify", "--stage", "IN_DEVELOPMENT", "--class", "work");
    factory("check");
    const { code, text } = factory("message", "--story", "row-01");
    assert.equal(code, 0);
    assert.match(text, /^You are a factory worker\. Do the work of Stage IN_DEVELOPMENT for Story ROW-01\.\nThis is worker 1 for this Story in this Stage\.\n\n## Rowbly and Git/);
    assert.match(text, new RegExp(`flock -w 60 ${(await readState()).writeLock} `));
    assert.match(text, /## No person is available/);
    assert.match(text, /## Project instructions\n\nUse pnpm\.\n\n## Stage prompt\n\nUse the `develop` skill on this story\.\n$/);
    assert.doesNotMatch(text, /\{\{/);
  });

  it("tells a later worker what the earlier worker did", async () => {
    await world({ stories: [story("ROW-01", "IN_DEVELOPMENT")] });
    scan();
    factory("started", "--story", "ROW-01", "--worker-id", "w1");
    scan("--worker", "w1=completed=blocked");
    assert.match(factory("message", "--story", "ROW-01").text,
      /This is worker 2 for this Story in this Stage\.\nAn earlier worker \(w1\) stopped with the result `blocked`, and the Story did not move\.\nRead `## Blockers`/);
    scan();
    factory("started", "--story", "ROW-01", "--worker-id", "w2");
    scan("--worker", "w2=interrupted");
    assert.match(factory("message", "--story", "ROW-01").text, /An earlier worker \(w2\) stopped with an error/);
  });

  it("gives no message for a Story that is not in a work Stage", async () => {
    await world({ stories: [story("ROW-01", "DONE")] });
    const { code, json } = factory("message", "--story", "ROW-01");
    assert.equal(code, 1);
    assert.match(json.actions.join("\n"), /Do not start this worker/);
  });
});

describe("started", () => {
  beforeEach(classifyAll);

  it("rejects a second worker for a Story with an active worker", async () => {
    await world({ stories: [story("ROW-01", "IN_REVIEW")] });
    scan();
    factory("started", "--story", "ROW-01", "--worker-id", "w1", "--machine", "rook");
    const second = factory("started", "--story", "ROW-01", "--worker-id", "w2");
    assert.equal(second.code, 1);
    assert.match(second.json.actions.join("\n"), /Worker w2 is a second worker for ROW-01\. Stop it in the harness/);
    const [attempt] = (await readState()).attempts;
    assert.deepEqual([attempt.workerId, attempt.machine, attempt.status, attempt.startReported], ["w1", "rook", "running", true]);
  });

  it("rejects a Story that the last scan did not show", () => {
    assert.equal(factory("started", "--story", "ROW-99", "--worker-id", "w1").code, 1);
  });
});

it("prints the usage for --help", () => {
  const result = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: node factory\.mjs <command>/);
});

it("gives the usage as an action for a command or an option that it does not know", () => {
  for (const args of [["launch"], ["scan", "--worker", "w1=completed=changes", "required"], ["scan", "--fast"]]) {
    const result = factory(...args);
    assert.equal(result.code, 1);
    assert.ok(result.json.error.message);
    assert.match(result.json.actions.join("\n"), /Usage: node factory\.mjs <command>/);
  }
});
