#!/usr/bin/env node
// The tool of the factory supervisor. Each command prints JSON with an `actions` list: the next steps, in order.
// A failure prints `{ "error": … , "actions": … }` to stderr and exits with 1. `message` prints plain text.
// Usage: node factory.mjs <command> [--root <dir>] [options] [-- <rowbly command>]

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { renderWorkerMessage } from "./worker-message.mjs";
import { commitProject, lockPath } from "./commit-project.mjs";
import { readState, resetState, statePath, withStateLock, writeState } from "./factory-state.mjs";
import { evaluateScan, normalizeStatus, pendingReports, recordLaunchFailure, recordStart, releaseStory } from "./supervisor-policy.mjs";

const run = promisify(execFile);
const self = fileURLToPath(import.meta.url);
const USAGE = `Usage: node factory.mjs <command> [--root <dir>] [options] [-- <rowbly command>]

Commands:
  check                                   Do the start checks of the Project.
  classify --stage <KEY> --class <work|hold|invalid>
                                          Save the class of a Stage prompt.
  scan [--worker <id>=<status>[=<result>]]... [--busy <story>]... [--max-active <n>] [--no-commit]
                                          Do one scan. Give one --worker for each worker that the state records as active.
  message --story <id>                    Print the first message for the worker of a Story.
  started --story <id> --worker-id <id> [--stage <KEY>] [--type <thread|subagent>] [--model <name>] [--machine <name>]
                                          Record a worker that started.
  launch-failed --story <id> [--error <text>]
                                          Record a launch that gave no worker.
  release --story <id>                    Make a parked Story eligible again.
  note [--text <text>] [--clear]          Save a note that each scan shows. Without options, show the notes.
  commit                                  Commit the canonical Project files.
  reset-state                             Move a state file that is not valid out of the way.

Put a value that has spaces in quotes, for example --worker "thread-1=completed=changes required".`;

const CLASSES = ["work", "hold", "invalid"];
const SCANS_BEFORE_IDLE = 10;
const SCANS_BETWEEN_RECHECKS = 30;
const MINUTES_BETWEEN_STALL_NOTICES = 30;
const ROWBLY_FAILURES_BEFORE_ACTION = 3;
const ROWBLY_FAILURES_BETWEEN_ACTIONS = 30;
const stopped = new Set(["completed", "failed", "blocked", "interrupted"]);
const CONTINUE = "Do not start a worker now. Do the scan again at its next time.";

class Problem extends Error {
  constructor(message, actions = [], extra = {}) {
    super(message);
    Object.assign(this, { actions, ...extra });
  }
}

const separator = process.argv.indexOf("--");
const argv = process.argv.slice(2, separator === -1 ? undefined : separator);
const override = separator === -1 ? [] : process.argv.slice(separator + 1);
if (argv.length === 0 || argv.some((arg) => ["--help", "-h", "help"].includes(arg))) {
  console.log(USAGE);
  process.exit(0);
}
let values = {};
let command;
let usageError = null;
try {
  const args = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      worker: { type: "string", multiple: true, default: [] },
      busy: { type: "string", multiple: true, default: [] },
      "max-active": { type: "string" },
      "no-commit": { type: "boolean", default: false },
      stage: { type: "string" },
      class: { type: "string" },
      story: { type: "string" },
      "worker-id": { type: "string" },
      type: { type: "string" },
      model: { type: "string" },
      machine: { type: "string" },
      error: { type: "string" },
      text: { type: "string" },
      clear: { type: "boolean", default: false },
    },
  });
  values = args.values;
  if (args.positionals.length !== 1) throw new Error(`Give one command. You gave: ${args.positionals.join(" ") || "none"}.`);
  [command] = args.positionals;
} catch (error) {
  usageError = error;
}

function findRoot(start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".rowbly"))) return dir;
    if (dir === dirname(dir)) return null;
  }
}

const root = findRoot(values.root ?? process.cwd());
const quote = (text) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);
/** A command line of this script, for an action text. */
const call = (...args) => `node ${quote(self)} ${args.join(" ")} --root ${quote(root ?? "<root>")}`;
const need = (name) => {
  if (!values[name]) throw new Problem(`The option --${name} is necessary.`, [`Run the command again with --${name}.`]);
  return values[name];
};
const git = async (dir, ...args) => (await run("git", ["-C", dir, ...args], { timeout: 60_000 })).stdout.trim();

let rowblyCommand = override.length > 0 ? override : ["rowbly"];
async function rowbly(...args) {
  const [file, ...first] = rowblyCommand;
  try {
    const { stdout } = await run(file, [...first, "-C", root, "--json", ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
    return JSON.parse(stdout);
  } catch (error) {
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    throw new Problem(`\`${rowblyCommand.join(" ")} ${args.join(" ")}\` failed: ${detail}`);
  }
}

/**
 * All Stories that Rowbly can read. One Story file that is not valid makes `story search` fail, and that must not
 * stop the other Stories. The command then reads each Story by itself and gives the IDs of the files that fail.
 */
async function readStories() {
  try {
    const stories = await rowbly("story", "search");
    if (!Array.isArray(stories)) throw new Problem("`story search` did not give a list.");
    return { stories, invalid: [] };
  } catch (error) {
    const files = await readdir(join(root, ".rowbly", "stories")).catch(() => []);
    const stories = [];
    const invalid = [];
    for (const id of files.filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3))) {
      await rowbly("story", "get", id).then((story) => stories.push(story), () => invalid.push(id));
    }
    // No Story that Rowbly can read: the cause is the command, not a file.
    if (stories.length === 0) throw error;
    return { stories: stories.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)), invalid };
  }
}

/** The issues of `doctor`. The command exits with 1 when it finds an error, and still prints its report. */
async function doctorIssues() {
  const [file, ...first] = rowblyCommand;
  const output = await run(file, [...first, "-C", root, "--json", "doctor"], { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 })
    .then(({ stdout }) => stdout, (error) => error.stdout ?? "");
  try {
    return JSON.parse(output).issues ?? [];
  } catch {
    return [];
  }
}

/** The state, with the Rowbly command that `check` saved. An invalid file gives the repair as an action. */
async function loadState() {
  let state;
  try {
    state = await readState(root);
  } catch (error) {
    throw new Problem(`The state file is not valid: ${error.message}`, [
      "Do not start a worker now.",
      `Run: ${call("reset-state")}`,
    ], { path: statePath(root) });
  }
  if (override.length > 0) state.rowbly = override;
  else if (Array.isArray(state.rowbly) && state.rowbly.length > 0) rowblyCommand = state.rowbly;
  return state;
}

/** One read-change-write of the state. The change gets the state and gives the new state, or nothing. */
const update = (change) => withStateLock(root, async () => {
  const state = await loadState();
  const next = await change(state);
  if (next) await writeState(root, next);
  return next ?? state;
});

const promptPath = (key) => join(root, ".rowbly", "stages", `${key}.md`);
const hashOf = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

async function readPrompt(key) {
  try {
    return await readFile(promptPath(key), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** The Stages of the config, in board order, each with the class of its prompt. */
async function readStages(state) {
  const config = JSON.parse(await readFile(join(root, ".rowbly", "rowbly.config.json"), "utf8"));
  if (!Array.isArray(config.stages)) throw new Problem("The config has no `stages` list.");
  return Promise.all(config.stages.map(async ({ key, enabled }) => {
    const text = await readPrompt(key);
    const saved = state.prompts?.[key];
    let promptClass = "unclassified";
    if (text === null) promptClass = "missing";
    else if (text.trim() === "") promptClass = "invalid";
    else if (saved?.hash === hashOf(text)) promptClass = saved.class;
    return { key, enabled: enabled !== false, promptClass, path: promptPath(key) };
  }));
}

const classifyActions = (stages) => stages
  .filter((stage) => stage.enabled && stage.promptClass === "unclassified")
  .map((stage) => `Read ${stage.path}. Select its class (work, hold or invalid). Then run: ${call("classify", "--stage", stage.key, "--class <class>")}`);

/**
 * The ID and the Stage of a Story from the text that the supervisor gave. A wrong ID must not make the supervisor
 * scan again, because the scan then starts a second worker for the Story.
 */
async function resolveStory(state, input) {
  const known = [...new Set([...Object.keys(state.scan.stages), ...state.attempts.map((attempt) => attempt.story)])];
  const id = known.find((id) => id.toLowerCase() === input.toLowerCase());
  if (id && (values.stage || state.scan.stages[id])) return { id, stage: values.stage ?? state.scan.stages[id] };
  try {
    const story = await rowbly("story", "get", input);
    return { id: story.id, stage: values.stage ?? story.stage };
  } catch {
    if (values.stage) return { id: id ?? input.toUpperCase(), stage: values.stage };
    throw new Problem(`Rowbly has no Story "${input}".`, [
      "Run the command again with the Story ID from the `start` list of the scan. Do not do a new scan first.",
    ]);
  }
}

/** The `--worker <id>=<status>[=<result>]` options. An ID can contain `=`, so the known IDs match first. */
function parseWorkers(ids) {
  const workers = new Map();
  const warnings = [];
  for (const text of values.worker) {
    const id = ids.filter((id) => text.startsWith(`${id}=`)).sort((a, b) => b.length - a.length)[0] ?? text.split("=")[0];
    const [status, ...rest] = text.slice(id.length + 1).split("=");
    if (!id || !status) {
      throw new Problem(`"--worker ${text}" is not correct.`, ["Use --worker <id>=<status> or --worker <id>=<status>=<result>."]);
    }
    const known = normalizeStatus(status);
    if (!known) warnings.push(`The status "${status}" of worker ${id} is not known. It counts as running.`);
    const result = rest.join("=").trim().toLowerCase();
    workers.set(id, { workerId: id, status: known ?? "running", ...(result ? { result } : {}) });
  }
  return { workers, warnings };
}

const minutesSince = (time) => Math.max(0, Math.floor((Date.now() - Date.parse(time)) / 60_000));
const label = (key) => key.toLowerCase().replaceAll("_", " ");

async function scan() {
  if (values["max-active"] !== undefined && !/^\d+$/.test(values["max-active"])) {
    throw new Problem("--max-active must be a whole number, for example --max-active 3.", ["Correct the option and run the scan again."]);
  }
  let moved = [];
  const output = await withStateLock(root, async () => {
    const state = await loadState();
    const active = state.attempts.filter((attempt) => !stopped.has(attempt.status));
    const { workers, warnings } = parseWorkers(active.map((attempt) => attempt.workerId));
    const unknown = active.filter((attempt) => !workers.has(attempt.workerId));
    if (unknown.length > 0) {
      // Without a status, a worker counts as active for all time. Ask for each status before the scan.
      const flags = [
        ...values.worker.map((text) => `--worker ${quote(text)}`),
        ...unknown.map((attempt) => `--worker ${quote(`${attempt.workerId}=<status>=<result>`)}`),
        ...values.busy.map((story) => `--busy ${quote(story)}`),
        ...(values["max-active"] === undefined ? [] : [`--max-active ${values["max-active"]}`]),
        ...(values["no-commit"] ? ["--no-commit"] : []),
      ];
      return {
        needStatus: unknown.map(({ story, stage, workerId, model, machine, startedAt }) => (
          { story, stage, workerId, model, machine, minutes: startedAt ? minutesSince(startedAt) : null })),
        actions: [
          'Get the status of each worker in "needStatus" from the harness. Use "Worker status" in SKILL.md.',
          `Then run this command, with the status and the result in place of <status> and <result>: ${call("scan", ...flags)}`,
        ],
      };
    }
    // The limit stays in the state, so that a later scan without the option still obeys it.
    if (values["max-active"] !== undefined) state.maxActive = Number(values["max-active"]);
    const stages = await readStages(state);
    let stories;
    let invalid;
    try {
      ({ stories, invalid } = await readStories());
    } catch (error) {
      // Tell the supervisor to repair the command only after some failures in a row, and then not on each scan.
      const failures = (state.rowblyFailures ?? 0) + 1;
      await writeState(root, { ...state, rowblyFailures: failures });
      const repair = failures >= ROWBLY_FAILURES_BEFORE_ACTION &&
        (failures - ROWBLY_FAILURES_BEFORE_ACTION) % ROWBLY_FAILURES_BETWEEN_ACTIONS === 0;
      error.actions = [
        ...(repair ? [`The Rowbly command failed on ${failures} scans in a row. Do "The Rowbly command fails" in the problems table of SKILL.md.`] : []),
        CONTINUE,
      ];
      throw error;
    }
    delete state.rowblyFailures;
    const idOf = (input) => stories.find((story) => story.id.toLowerCase() === input.toLowerCase())?.id ?? input;
    const harnessWorkers = [...workers.values(), ...values.busy.map((story) => ({ story: idOf(story), status: "running" }))];
    const plan = evaluateScan(state, { stories, stages, harnessWorkers, maxActive: state.maxActive });
    const next = plan.state;
    const before = state.scan.stages;
    moved = stories.filter((story) => before[story.id] !== undefined && before[story.id] !== story.stage);
    const actions = classifyActions(stages);

    const problems = {};
    for (const stage of stages) {
      if (stage.enabled && ["missing", "invalid"].includes(stage.promptClass)) {
        problems[`prompt:${stage.key}:${stage.promptClass}`] =
          `The prompt of Stage ${stage.key} is ${stage.promptClass} (${stage.path}). Stories in this Stage get no worker.`;
      }
    }
    for (const id of invalid) problems[`story:${id}`] = `Rowbly cannot read the file of Story ${id}. This Story gets no worker.`;
    const fresh = Object.keys(problems).filter((key) => !next.problems?.[key]);
    const reports = fresh.map((key) => problems[key]);
    if (fresh.some((key) => key.startsWith("story:"))) actions.push('Do "A Story file is not valid" in the problems table of SKILL.md.');
    next.problems = Object.fromEntries(Object.keys(problems).map((key) => [key, true]));
    for (const report of pendingReports(next)) {
      if (report.event === "parked") {
        reports.push(`${report.story} is parked in ${report.stage}: ${report.reason}. It gets no worker until a person changes the Story, moves it or asks for a release.`);
        next.parked[report.story].reported = true;
        continue;
      }
      // A harness can give the same ID to two workers. Take the attempt that still has this report.
      const flag = report.event === "started" ? "startReported" : "reported";
      const attempt = next.attempts.find((attempt) => attempt.workerId === report.workerId && !attempt[flag] &&
        (flag === "startReported" ? attempt[flag] === false : stopped.has(attempt.status)));
      if (!attempt) continue;
      reports.push(report.event === "started"
        ? `${report.story} ${attempt.stage}: worker ${report.workerId} started.`
        : `${report.story} ${attempt.stage}: worker ${report.workerId} stopped. Status: ${attempt.status}. Result: ${report.result ?? "not known"}.`);
      attempt[flag] = true;
    }

    // Repeat this action each 30 minutes, not on each scan.
    for (const worker of plan.stalled) {
      const attempt = next.attempts.find((attempt) => attempt.workerId === worker.workerId && !stopped.has(attempt.status));
      if (attempt.stallNoticeAt && minutesSince(attempt.stallNoticeAt) < MINUTES_BETWEEN_STALL_NOTICES) continue;
      attempt.stallNoticeAt = new Date().toISOString();
      actions.push(`Worker ${worker.workerId} of ${worker.story} has run for ${worker.minutes} minutes. Do "A worker that does not stop" in the problems table of SKILL.md.`);
    }
    // The Stories nearest to the last Stage come first, as in the worker limit.
    const order = (decision) => stages.findIndex((stage) => stage.key === decision.stage);
    const start = plan.decisions.filter((decision) => ["start", "retry"].includes(decision.action))
      .sort((a, b) => order(b) - order(a))
      .map(({ story, stage, attempt, reason, previous }) => {
        // Each worker of a Story gets a new number, so that the branch of its worktree does not exist.
        const number = next.attempts.filter((item) => item.story === story).length + 1;
        return { story, stage, attempt, reason, branch: `${story}-${stage}-${number}`.toLowerCase(), ...(previous ? { previous } : {}) };
      });
    for (const { story, stage } of start) {
      actions.push([
        `Start a worker for ${story} in ${stage}. Do "Start a worker" in SKILL.md.`,
        `Get its first message with: ${call("message", "--story", story)}`,
        `After the launch, run: ${call("started", "--story", story, "--worker-id <id>", "--model <model>")}`,
        `If the launch fails, run: ${call("launch-failed", "--story", story, '--error "<error text>"')}`,
      ].join(" "));
    }
    const quiet = ["hold stage", "stage unavailable", "parked", "worker stop unconfirmed", "active or unknown harness worker"];
    const waiting = plan.decisions.filter((decision) => decision.action === "skip" && !quiet.includes(decision.reason))
      .map(({ story, stage, reason, retryAt }) => ({ story, stage, reason, ...(retryAt ? { retryAt } : {}) }));
    const running = next.attempts.filter((attempt) => !stopped.has(attempt.status))
      .map(({ story, stage, workerId, machine, startedAt }) => (
        { story, stage, workerId, ...(machine ? { machine } : {}), minutes: startedAt ? minutesSince(startedAt) : null }));
    const parked = Object.entries(next.parked).map(([story, { stage, reason, since }]) => ({ story, stage, reason, since }));

    const wasIdle = (state.scan.idle ?? 0) >= SCANS_BEFORE_IDLE;
    const idle = running.length === 0 && start.length === 0 && waiting.length === 0 && values.busy.length === 0;
    next.scan.idle = idle ? (state.scan.idle ?? 0) + 1 : 0;
    if (next.scan.idle === SCANS_BEFORE_IDLE) {
      actions.push(`No Story had work for ${SCANS_BEFORE_IDLE} scans. If the harness can change the schedule, change it to one scan each 5 minutes.`);
    }
    if (wasIdle && !idle) actions.push("Work is available again. If you changed the schedule, change it back to one scan each minute.");
    const notes = next.notes ?? [];
    const recheck = notes.length > 0 && next.scan.count % SCANS_BETWEEN_RECHECKS === 0;
    if (recheck) actions.push('Try the first choice of each note again. Do "Notes" in SKILL.md.');

    await writeState(root, next);
    actions.push(...reports.map((report) => `Tell the user: ${report}`));
    return {
      scan: next.scan.count, actions, start, waiting, active: running, parked, notes,
      ...(next.maxActive === undefined ? {} : { maxActive: next.maxActive }),
      recheck, ...(warnings.length > 0 ? { warnings } : {}),
    };
  });
  if (output.needStatus) return output;

  // The commit waits for the write lock of the Project, so it runs after the state lock is free.
  output.commit = { status: "skipped" };
  if (!values["no-commit"]) {
    const message = moved.length === 1 ? `chore(rowbly): record ${moved[0].id} move to ${label(moved[0].stage)}` : undefined;
    const commit = await commitProject(root, { message });
    output.commit = commit;
    const trouble = ["failed", "conflict", "held"].includes(commit.status) ? JSON.stringify(commit) : null;
    await update((state) => {
      if ((state.commitProblem ?? null) === trouble) return null;
      const next = { ...state, commitProblem: trouble };
      if (!trouble) delete next.commitProblem;
      else output.actions.push(`Tell the user: The commit of the Project files did not complete (${commit.status}). The factory continues. Detail: ${commit.detail ?? commit.held?.join(", ")}`);
      return next;
    });
  }
  if (output.actions.length === 0) output.actions.push("No action is necessary. End this scan.");
  return output;
}

async function message() {
  const state = await loadState();
  const story = await rowbly("story", "get", need("story"));
  const stage = (await readStages(state)).find((stage) => stage.key === story.stage);
  if (!stage?.enabled || stage.promptClass !== "work") {
    throw new Problem(`${story.id} is in Stage ${story.stage}, which is not a work Stage now.`);
  }
  const attempts = state.attempts.filter((attempt) => attempt.story === story.id);
  const last = attempts.at(-1);
  const attempt = attempts.filter((item) => item.stage === story.stage && !item.budgetReset).length + 1;
  let earlier = "";
  if (last && last.stage === story.stage && !last.observedStageDeparture && stopped.has(last.status)) {
    earlier = ["failed", "interrupted"].includes(last.status)
      ? `An earlier worker (${last.workerId}) stopped with an error before it completed the work.
Examine the Story, the branch and the pull request for the work that it left. Continue from that work. Do not start again.`
      : `An earlier worker (${last.workerId}) stopped with the result \`${last.result ?? "not known"}\`, and the Story did not move.
Read \`## Blockers\` and \`## Assumptions\` in the Story. Examine the branch and the pull request for the work that it left.
Do not give the same result again if a decision of yours can prevent it. Do the remaining steps of the Stage prompt.`;
  }
  const { instructions } = await rowbly("project", "get-instructions");
  const fields = {
    story: story.id,
    stage: story.stage,
    attempt: String(attempt),
    root,
    rowbly: rowblyCommand.map(quote).join(" "),
    lock: await lockPath(root),
    instructions: instructions?.trim() || "This Project has no instructions.",
    prompt: (await readPrompt(story.stage)).trim(),
  };
  const template = await readFile(new URL("../references/worker-message.md", import.meta.url), "utf8");
  const text = template.replace("{{earlier}}\n", earlier ? `${earlier}\n` : "");
  return renderWorkerMessage(text, fields);
}

async function started() {
  const worker = { workerId: need("worker-id"), workerType: values.type ?? "thread" };
  if (values.model) worker.model = values.model;
  if (values.machine) worker.machine = values.machine;
  need("story");
  let recorded;
  await update(async (state) => {
    const { id, stage } = await resolveStory(state, values.story);
    recorded = { story: id, stage, ...worker };
    const active = state.attempts.find((attempt) => attempt.story === id && !stopped.has(attempt.status));
    // The same command a second time changes nothing.
    if (active?.workerId === worker.workerId) return null;
    if (active) {
      throw new Problem(`${id} has the worker ${active.workerId}, which the state records as active.`, [
        `Worker ${worker.workerId} is a second worker for ${id}. Stop it in the harness.`,
      ]);
    }
    const next = recordStart(state, id, stage, worker);
    next.attempts.at(-1).startReported = true;
    return next;
  });
  return { recorded, actions: [`Tell the user: ${recorded.story} ${recorded.stage}: worker ${worker.workerId} started.`] };
}

async function launchFailed() {
  need("story");
  let failure;
  let id;
  await update(async (state) => {
    ({ id } = await resolveStory(state, values.story));
    const next = recordLaunchFailure(state, id, values.error ?? "no error text");
    failure = next.launchFailures[id];
    return next;
  });
  const first = `Tell the user: The launch of a worker for ${id} failed: ${failure.error}. The factory tries again after a delay.`;
  return {
    story: id,
    failures: failure.count,
    actions: [...(failure.count === 1 ? [first] : []), "Continue with the next action. A later scan gives the start action for this Story again."],
  };
}

async function classify() {
  const key = need("stage").toUpperCase();
  if (!CLASSES.includes(need("class"))) throw new Problem(`The class must be one of: ${CLASSES.join(", ")}.`, ["Run the command again with one of these classes."]);
  const text = await readPrompt(key);
  if (text === null) throw new Problem(`${promptPath(key)} does not exist.`, ["Continue. Stories in this Stage get no worker."]);
  const state = await update((state) => ({ ...state, prompts: { ...state.prompts, [key]: { hash: hashOf(text), class: values.class } } }));
  const actions = classifyActions(await readStages(state));
  return { stage: key, class: values.class, actions: actions.length > 0 ? actions : ["All Stage prompts have a class. Continue."] };
}

/** The same directory in the main checkout, if `dir` is in a linked Git worktree. Such a worktree has a copy of `.rowbly/`. */
async function canonicalRoot(dir) {
  try {
    if ((await git(dir, "rev-parse", "--path-format=absolute", "--git-dir")) ===
      (await git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir"))) return null;
    const main = (await git(dir, "worktree", "list", "--porcelain")).split("\n")[0].replace(/^worktree /, "");
    return join(main, relative(await git(dir, "rev-parse", "--show-toplevel"), dir));
  } catch {
    return null;
  }
}

async function check() {
  const checks = [];
  const add = (name, result, detail = "") => checks.push({ number: checks.length + 1, name, result, detail });
  const names = ["Project", "CLI", "Config", "Enabled Stages", "Stage prompt files", "Stage prompt content", "State file", "Git commits"];
  const actions = [];
  let lock = null;
  const canonical = root ? await canonicalRoot(root) : null;
  if (!root || canonical) {
    if (canonical) {
      add("Project", "FAIL", `${root} is in a linked Git worktree, and its .rowbly/ is a copy. The Project is in ${canonical}`);
      actions.push(`Run: node ${quote(self)} check --root ${quote(canonical)}`);
    } else add("Project", "FAIL", `No .rowbly/ at or above ${resolve(values.root ?? process.cwd())}`);
    for (const name of names.slice(1)) add(name, "SKIP");
  } else {
    add("Project", "PASS", root);
    let state = null;
    try {
      state = await loadState();
    } catch (error) {
      actions.push(...error.actions);
    }
    try {
      const { invalid } = await readStories();
      const note = invalid.length > 0 ? `; Rowbly cannot read ${invalid.join(", ")}, and these Stories get no worker` : "";
      add("CLI", invalid.length > 0 ? "WARN" : "PASS", `${rowblyCommand.join(" ")}${note}`);
      if (invalid.length > 0) actions.push('Do "A Story file is not valid" in the problems table of SKILL.md.');
    } catch (error) {
      add("CLI", "FAIL", error.message);
      actions.push('Do "The Rowbly command fails" in the problems table of SKILL.md. Then do the check again.');
    }
    let stages = [];
    try {
      stages = await readStages(state ?? {});
      const issues = checks[1].result === "FAIL" ? [] : await doctorIssues();
      const errors = issues.filter((issue) => issue.severity === "error" && !issue.fixed);
      const config = errors.filter((issue) => issue.file?.endsWith("rowbly.config.json"));
      const other = errors.length - config.length;
      if (config.length > 0) add("Config", "FAIL", config.map((issue) => issue.message).join("; "));
      else add("Config", "PASS", other > 0 ? `Note: doctor shows ${other} error(s) in other files` : "");
    } catch (error) {
      add("Config", "FAIL", `.rowbly/rowbly.config.json: ${error.message}`);
    }
    const enabled = stages.filter((stage) => stage.enabled);
    if (checks[2].result === "FAIL") for (const name of names.slice(3, 6)) add(name, "SKIP");
    else {
      add("Enabled Stages", enabled.length > 0 ? "PASS" : "FAIL", enabled.map((stage) => stage.key).join(", ") || "The config has no enabled Stage");
      const missing = enabled.filter((stage) => stage.promptClass === "missing");
      add("Stage prompt files", missing.length > 0 ? "WARN" : "PASS",
        missing.map((stage) => `${stage.path} does not exist; Stories in ${stage.key} get no worker`).join("; "));
      const open = classifyActions(stages);
      const classes = enabled.filter((stage) => stage.promptClass !== "missing").map((stage) => `${stage.key} (${stage.promptClass})`).join(", ");
      const hasWork = enabled.some((stage) => stage.promptClass === "work");
      const invalid = enabled.some((stage) => stage.promptClass === "invalid");
      let result = "PASS";
      if (open.length > 0) result = "TODO";
      else if (!hasWork) result = "FAIL";
      else if (invalid) result = "WARN";
      const notes = [classes];
      if (result === "FAIL") notes.push("no Stage has a work prompt, so the factory has no work");
      if (invalid) notes.push("Stories in a Stage with an invalid prompt get no worker");
      add("Stage prompt content", result, notes.filter(Boolean).join("; "));
      if (state) actions.push(...open);
      if (open.length > 0) actions.push(`After you classify each prompt, run: ${call("check")}`);
    }
    if (!state) add("State file", "WARN", `${statePath(root)} is not valid; reset-state moves it away`);
    else {
      const ignored = await run("git", ["-C", root, "check-ignore", "-q", ".rowbly/state.json"]).then(() => true, (error) => error.code !== 1);
      add("State file", ignored ? "PASS" : "WARN", ignored ? "" : "Add .rowbly/state.json* to .gitignore");
    }
    lock = await lockPath(root);
    const inGit = await git(root, "rev-parse", "--show-toplevel").then(() => true, () => false);
    const hasFlock = await run("flock", ["--version"]).then(() => true, () => false);
    const gaps = [inGit ? "" : "no Git repository, so no automatic commits", hasFlock ? "" : "flock is not available, so writes have no lock"];
    add("Git commits", inGit && hasFlock ? "PASS" : "WARN", gaps.filter(Boolean).join("; "));
    if (state) await update((current) => ({ ...current, writeLock: lock }));
  }
  const failed = checks.some((item) => item.result === "FAIL");
  const todo = checks.some((item) => item.result === "TODO");
  const report = checks.map((item) => `[${item.result}] ${item.number}. ${item.name}${item.detail ? `: ${item.detail}` : ""}`).join("\n");
  if (failed && !canonical) actions.push('Try the repair for each FAIL. See "Step 4: Report" in SKILL.md.');
  else if (!failed && !todo) actions.push('Continue with "Step 2: Harness checks" in SKILL.md.');
  return { root, result: failed ? "fail" : todo ? "todo" : "pass", report, writeLock: lock, actions };
}

async function note() {
  const state = await update((state) => {
    if (!values.clear && !values.text) return null;
    return { ...state, notes: [...(values.clear ? [] : (state.notes ?? [])), ...(values.text ? [values.text] : [])] };
  });
  return { notes: state.notes ?? [], actions: [] };
}

async function release() {
  need("story");
  let id;
  await update(async (state) => {
    ({ id } = await resolveStory(state, values.story));
    return releaseStory(state, id);
  });
  return { released: id, actions: ["The next scan can start a worker for this Story."] };
}

async function reset() {
  const { moved, attempts } = await withStateLock(root, () => resetState(root));
  return {
    moved,
    keptAttempts: attempts,
    actions: [
      'List the workers of the harness for this Project. Their titles have the form "<story> <STAGE KEY>", for example "ROW-07 IN_REVIEW".',
      `For each worker that still runs, run: ${call("started", "--story <story>", "--stage <STAGE KEY>", "--worker-id <id>")} The command changes nothing for a worker that the state has.`,
      `Then run: ${call("check")}`,
    ],
  };
}

const commands = {
  check,
  classify,
  scan,
  message,
  started,
  "launch-failed": launchFailed,
  release,
  note,
  commit: async () => ({ commit: await commitProject(root), actions: [] }),
  "reset-state": reset,
};

try {
  if (usageError || !commands[command]) {
    throw new Problem(usageError?.message ?? `"${command}" is not a command.`, ["Correct the command and run it again.", USAGE]);
  }
  if (!root && command !== "check") {
    throw new Problem(`No .rowbly/ at or above ${resolve(values.root ?? process.cwd())}.`, ["Give the Project directory with --root <dir>."]);
  }
  const result = await commands[command]();
  console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
} catch (error) {
  // A worker that cannot get its message must not stop the other starts of the scan.
  const fallback = command === "message" ? "Do not start this worker. Continue with the next action." : CONTINUE;
  const actions = error.actions?.length > 0 ? error.actions : [fallback];
  console.error(JSON.stringify({ error: { message: error.message, ...(error.path ? { path: error.path } : {}) }, actions }, null, 2));
  process.exitCode = 1;
}
