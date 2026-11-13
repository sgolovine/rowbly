import { type Command, InvalidArgumentError } from "commander";
import { RowblyError, ValidationError } from "../../services/errors/errors.js";
import type { FieldValue } from "../../services/fields/fields.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";

/**
 * Sets the exit code of the process. The process stops by itself after all output is written, so a command does
 * not call `process.exit`.
 */
export function setExitCode(code: number | undefined): void {
  // biome-ignore lint/plugin: `process.exitCode` is the Node API that sets the exit code of the process.
  process.exitCode = code;
}

function printJsonError(error: RowblyError): void {
  const { code, message, hint, details } = error;

  console.error(JSON.stringify({ error: { code, message, hint, details } }, null, 2));
}

function printTextError(error: RowblyError): void {
  const issues = error.details.issues;

  console.error(`Error: ${error.message}`);

  // One issue is the message already; a list helps only when there are more.
  if (Array.isArray(issues) && issues.length > 1) {
    for (const issue of issues as { message: string }[]) {
      console.error(`  - ${issue.message}`);
    }
  }

  if (error.hint) {
    console.error(`Hint: ${error.hint}`);
  }
}

/** Prints a `RowblyError` and sets exit code 1. Any other error is a bug, so it is thrown again. */
function reportError(error: unknown, json: boolean | undefined): void {
  if (!(error instanceof RowblyError)) {
    throw error;
  }

  if (json) {
    printJsonError(error);
  } else {
    printTextError(error);
  }

  setExitCode(1);
}

/**
 * Runs a command's service call and prints its result: `text(result)` normally, the result as JSON
 * with `--json`. A `RowblyError` is printed with its hint and sets exit code 1; anything else is a bug
 * and is rethrown.
 */
export async function run<T>(
  command: Command,
  call: (ctx: ServiceContext) => Promise<T>,
  text: (result: T, ctx: ServiceContext) => string | Promise<string>,
): Promise<void> {
  const { json, cwd } = command.optsWithGlobals<{ json?: boolean; cwd?: string }>();
  const ctx = { cwd };

  try {
    const result = await call(ctx);

    console.log(json ? JSON.stringify(result, null, 2) : await text(result, ctx));
  } catch (error) {
    reportError(error, json);
  }
}

/** Collects a repeatable option into an array. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function fieldFlag(flag: string): [string, string] {
  const at = flag.indexOf("=");

  if (at <= 0) {
    throw new ValidationError(`--field expects key=value, got "${flag}"`);
  }

  return [flag.slice(0, at).trim(), flag.slice(at + 1)];
}

/** `--field key=value` flags as a field input; values stay text for the service to parse. */
export function parseFieldFlags(flags: string[] | undefined): Record<string, string> | undefined {
  if (!flags || flags.length === 0) {
    return undefined;
  }

  return Object.fromEntries(flags.map((flag) => fieldFlag(flag)));
}

/** Parses a positive whole number option. */
export function parsePosition(value: string): number {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 1) {
    throw new InvalidArgumentError("Expected a position: 1, 2, …");
  }

  return number;
}

/** The text of a field value; an unset value is a dash. */
export function formatValue(value: FieldValue): string {
  return value === null ? "—" : String(value);
}
