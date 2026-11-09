import { type Command, InvalidArgumentError } from "commander";
import { RowblyError, ValidationError } from "../../services/errors/errors.js";
import type { FieldValue } from "../../services/fields/fields.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";

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
  try {
    const ctx = { cwd };
    const result = await call(ctx);
    console.log(json ? JSON.stringify(result, null, 2) : await text(result, ctx));
  } catch (error) {
    if (!(error instanceof RowblyError)) throw error;
    if (json) {
      const { code, message, hint, details } = error;
      console.error(JSON.stringify({ error: { code, message, hint, details } }, null, 2));
    } else {
      console.error(`Error: ${error.message}`);
      const issues = error.details.issues;
      if (Array.isArray(issues) && issues.length > 1) {
        for (const issue of issues as { message: string }[]) console.error(`  - ${issue.message}`);
      }
      if (error.hint) console.error(`Hint: ${error.hint}`);
    }
    process.exitCode = 1;
  }
}

/** Collects a repeatable option into an array. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** `--field key=value` flags as a field input; values stay text for the service to parse. */
export function parseFieldFlags(flags: string[] | undefined): Record<string, string> | undefined {
  if (!flags || flags.length === 0) return undefined;
  const fields: Record<string, string> = {};
  for (const flag of flags) {
    const at = flag.indexOf("=");
    if (at <= 0) throw new ValidationError(`--field expects key=value, got "${flag}"`);
    fields[flag.slice(0, at).trim()] = flag.slice(at + 1);
  }
  return fields;
}

/** Parses a positive whole number option. */
export function parsePosition(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new InvalidArgumentError("Expected a position: 1, 2, …");
  return number;
}

export function formatValue(value: FieldValue): string {
  return value === null ? "—" : String(value);
}
