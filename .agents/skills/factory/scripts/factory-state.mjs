#!/usr/bin/env node
// Read and replace the factory state. Assignment belongs to the supervisor.
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const statuses = new Set(["preparing", "running", "completed", "failed", "blocked", "interrupted"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function validate(state) {
  if (!object(state) || state.version !== 1 || !object(state.scan) || !object(state.scan.stages) ||
    !Object.values(state.scan.stages).every((stage) => typeof stage === "string") ||
    !Array.isArray(state.attempts) || !state.attempts.every((attempt) => object(attempt) &&
      ["story", "stage", "workerId"].every((key) => typeof attempt[key] === "string") && statuses.has(attempt.status))) {
    throw new Error("Invalid version 1 factory state");
  }
  return state;
}

let values;
let command;
try {
  const args = parseArgs({ options: { root: { type: "string" } }, allowPositionals: true });
  values = args.values;
  [command] = args.positionals;
  if (!values.root || args.positionals.length !== 1 || !["read", "write"].includes(command)) throw new Error();
} catch {
  console.error("Usage: factory-state.mjs <read|write> --root <root>");
  process.exit(2);
}

const directory = resolve(values.root, ".rowbly");
const path = join(directory, "state.json");
const temporary = `${path}.tmp-${process.pid}`;
let ownsTemporary = false;
const hint = "Repair the JSON and version 1 state, or check the harness for active workers, then move the file away.";

async function readState() {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, updatedAt: null, scan: { stages: {} }, attempts: [] };
    throw error;
  }
  return validate(JSON.parse(content));
}

try {
  if (!(await stat(directory)).isDirectory()) throw new Error("The Project path is not a directory");
  if (command === "read") {
    console.log(JSON.stringify(await readState()));
  } else {
    // Do not replace a malformed file, even when the new input is valid.
    await readState();
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const state = validate(JSON.parse(input));
    state.updatedAt = new Date().toISOString();
    const file = await open(temporary, "wx", 0o600);
    ownsTemporary = true;
    try {
      await file.writeFile(`${JSON.stringify(state, null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    ownsTemporary = false;
  }
} catch (error) {
  if (ownsTemporary) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      error.message += `; temporary file cleanup failed: ${cleanupError.message}`;
    }
  }
  console.error(JSON.stringify({ error: { message: error.message, path, hint } }));
  process.exitCode = 1;
}
