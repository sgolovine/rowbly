import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { durationSeconds } from "../check-queue/check-order.js";
import type { CheckOutcome } from "../check-queue/check-types.js";
import { ValidationError } from "../errors/errors.js";
import { type CheckSpec, FILES_PLACEHOLDER } from "../factory-settings/check-settings.js";
import { toolParameters } from "../tool-schema/tool-schema.js";

/** The check that the tool asks for, with the command to run. */
export interface CheckCall {
  readonly spec: CheckSpec;
  readonly scope: "full" | "narrow";
  readonly files: readonly string[];
  readonly command: string;
}

/** Runs one check through the queue and waits for its result. */
export type RunCheck = (
  call: CheckCall,
  signal: AbortSignal | undefined,
  onProgress: (text: string) => void,
) => Promise<CheckOutcome>;

interface CheckInput {
  readonly check: string;
  readonly files?: readonly string[];
}

type ProgressUpdate = (partial: { content: { type: "text"; text: string }[]; details: object }) => void;

/** Quotes a value for a POSIX shell. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Checks that a file is a relative path inside the worktree. */
function assertInside(worktree: string, file: string): void {
  const rel = relative(worktree, resolve(worktree, file));

  if (!file || file.includes("\0") || isAbsolute(file) || !rel || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new ValidationError(`Use a relative path inside the worktree: ${file}`);
  }
}

function findSpec(checks: readonly CheckSpec[], key: string): CheckSpec {
  const spec = checks.find((check) => check.key === key);

  if (!spec) {
    throw new ValidationError(`Unknown check: ${key}. Configured checks: ${checks.map((c) => c.key).join(", ")}`);
  }

  return spec;
}

/** Gives the check call: the narrow command with the quoted files, or the full command. */
export function checkCall(checks: readonly CheckSpec[], worktree: string, input: CheckInput): CheckCall {
  const spec = findSpec(checks, input.check);
  const files = input.files ?? [];

  for (const file of files) {
    assertInside(worktree, file);
  }

  if (!spec.narrowCommand || files.length === 0) {
    return { spec, scope: "full", files: [], command: spec.command };
  }

  const quoted = files.map(shellQuote).join(" ");

  return { spec, scope: "narrow", files, command: spec.narrowCommand.replaceAll(FILES_PLACEHOLDER, quoted) };
}

/** Writes the result of a check for the worker. */
export function formatOutcome(outcome: CheckOutcome, now: number): string {
  const { job } = outcome;

  return [
    `status: ${job.status}`,
    `exitCode: ${job.exitCode ?? "none"}`,
    `durationSeconds: ${durationSeconds(job, now) ?? 0}`,
    `scope: ${job.scope}`,
    `head: ${job.head ?? "unknown"}`,
    `log: ${outcome.log}`,
    "output:",
    outcome.output,
  ].join("\n");
}

/** Gives the function that sends a progress text through `onUpdate`. */
function progressSender(onUpdate: ProgressUpdate | undefined): (text: string) => void {
  return (text) => onUpdate?.({ content: [{ type: "text", text }], details: {} });
}

async function execute(
  checks: readonly CheckSpec[],
  worktree: string,
  run: RunCheck,
  args: { input: CheckInput; signal?: AbortSignal; onUpdate?: ProgressUpdate },
) {
  const call = checkCall(checks, worktree, args.input);
  const outcome = await run(call, args.signal, progressSender(args.onUpdate));
  const { job } = outcome;

  return {
    content: [{ type: "text" as const, text: formatOutcome(outcome, Date.now()) }],
    details: { status: job.status, exitCode: job.exitCode ?? null, scope: job.scope, head: job.head, log: outcome.log },
  };
}

/** Makes the `run_check` tool. The factory runs the check in its queue, and the tool waits for the result. */
export function createCheckTool(checks: readonly CheckSpec[], worktree: string, run: RunCheck) {
  return {
    name: "run_check",
    label: "Run check",
    description:
      "Run a configured check of the Project through the factory queue and wait for the result. " +
      `Checks: ${checks.map((check) => check.key).join(", ")}. Give the changed files to run the narrow form.`,
    parameters: toolParameters(
      z.object({
        check: z.string().max(100),
        files: z.array(z.string().max(1000)).max(200).optional(),
      }),
    ),
    execute(_id: string, input: CheckInput, signal?: AbortSignal, onUpdate?: ProgressUpdate) {
      return execute(checks, worktree, run, { input, signal, onUpdate });
    },
  };
}
