#!/usr/bin/env node
// Prints one JSON line for each Story that changes Stage in a Rowbly Project.
//
// Usage: node watch-stages.mjs --root <dir> --state <file> [--interval <seconds>] [--once] [-- <rowbly command>]
//
// A missing state file records a baseline and prints no change. An existing state file continues from
// its snapshot, so a new run also reports the changes that occurred between two runs.
//
// Output lines:
//   {"event":"watching","stories":3}
//   {"event":"stage-change","story":"ROW-01","from":"BACKLOG","to":"IN_REFINEMENT"}
//   {"event":"error","message":"..."}

import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";

const run = promisify(execFile);
const FAILURES_BEFORE_REPORT = 3;

const separator = process.argv.indexOf("--");
const hasCommand = separator !== -1;
const { values } = parseArgs({
  args: process.argv.slice(2, hasCommand ? separator : undefined),
  options: {
    root: { type: "string" },
    state: { type: "string" },
    interval: { type: "string", default: "5" },
    once: { type: "boolean", default: false },
  },
});
const [command, ...commandArgs] = hasCommand ? process.argv.slice(separator + 1) : ["rowbly"];
const intervalMs = Number(values.interval) * 1000;

if (!values.root || !values.state || !command || !(intervalMs > 0)) {
  console.error("Usage: watch-stages.mjs --root <dir> --state <file> [--interval <seconds>] [--once] [-- <command>]");
  process.exit(2);
}

const emit = (line) => console.log(JSON.stringify(line));

async function readStages() {
  const { stdout } = await run(command, [...commandArgs, "-C", values.root, "--json", "search-stories"], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
  const stories = JSON.parse(stdout);
  if (!Array.isArray(stories)) throw new Error("search-stories did not return a list");
  return Object.fromEntries(stories.map((story) => [story.id, story.stage]));
}

async function loadSnapshot() {
  let text;
  try {
    text = await readFile(values.state, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(text);
}

async function saveSnapshot(snapshot) {
  const temporary = `${values.state}.tmp`;
  await writeFile(temporary, JSON.stringify(snapshot));
  await rename(temporary, values.state);
}

/** Prints before it saves: a crash between the two repeats a change and does not lose one. */
function reportChanges(previous, current) {
  for (const [story, to] of Object.entries(current)) {
    const from = previous[story];
    if (from !== undefined && from !== to) emit({ event: "stage-change", story, from, to });
  }
}

function describe(error) {
  const detail = error.stdout?.trim() || error.stderr?.trim();
  return detail || error.message;
}

let snapshot;
try {
  snapshot = await loadSnapshot();
} catch (error) {
  emit({ event: "error", message: `Cannot read the state file: ${error.message}` });
  process.exit(1);
}

let announced = false;
let failures = 0;

for (;;) {
  try {
    const current = await readStages();
    failures = 0;
    if (!announced) {
      emit({ event: "watching", stories: Object.keys(current).length });
      announced = true;
    }
    if (snapshot) reportChanges(snapshot, current);
    await saveSnapshot(current);
    snapshot = current;
  } catch (error) {
    failures += 1;
    if (values.once || failures === FAILURES_BEFORE_REPORT) emit({ event: "error", message: describe(error) });
    if (values.once) process.exit(1);
  }
  if (values.once) break;
  await sleep(intervalMs);
}
