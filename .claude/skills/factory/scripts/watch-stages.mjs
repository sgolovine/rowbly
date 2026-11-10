#!/usr/bin/env node
// Reports all current Stories on each scan, including startup.
// Worker assignment and duplicate prevention belong to the supervisor.
// Usage: node watch-stages.mjs --root <dir> [--interval <seconds>] [--once] [-- <rowbly command>]

import { execFile } from "node:child_process";
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
    interval: { type: "string", default: "5" },
    once: { type: "boolean", default: false },
  },
});
const [command, ...commandArgs] = hasCommand ? process.argv.slice(separator + 1) : ["rowbly"];
const intervalMs = Number(values.interval) * 1000;

if (!values.root || !command || !(intervalMs > 0)) {
  console.error("Usage: watch-stages.mjs --root <dir> [--interval <seconds>] [--once] [-- <command>]");
  process.exit(2);
}

const emit = (line) => console.log(JSON.stringify(line));

async function readStories() {
  const { stdout } = await run(command, [...commandArgs, "-C", values.root, "--json", "story", "search"], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
  const stories = JSON.parse(stdout);
  if (!Array.isArray(stories)) throw new Error("story search did not return a list");
  return stories;
}

function describe(error) {
  const detail = error.stdout?.trim() || error.stderr?.trim();
  return detail || error.message;
}

let announced = false;
let failures = 0;

for (;;) {
  try {
    const stories = await readStories();
    failures = 0;
    if (!announced) {
      emit({ event: "watching", stories: stories.length });
      announced = true;
    }
    emit({ event: "stories", stories });
  } catch (error) {
    failures += 1;
    if (values.once || failures === FAILURES_BEFORE_REPORT) emit({ event: "error", message: describe(error) });
    if (values.once) process.exit(1);
  }
  if (values.once) break;
  await sleep(intervalMs);
}
