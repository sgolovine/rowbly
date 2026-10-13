import { isRowblyError } from '../core';
import { colors } from './colors';

export interface OutputStreams {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

const processStreams: OutputStreams = { stdout: process.stdout, stderr: process.stderr };

export interface PrintResultOptions<T> {
  json: boolean;
  /** Human-mode rendering; an empty string prints nothing. */
  human: (data: T) => string;
  streams?: OutputStreams;
}

/** Writes a command's result to stdout: pretty JSON with `--json`, otherwise `human(data)`. */
export function printResult<T>(data: T, { json, human, streams = processStreams }: PrintResultOptions<T>): void {
  if (json) {
    streams.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const text = human(data);
  if (text !== '') streams.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

export interface PrintOptions {
  json: boolean;
  streams?: OutputStreams;
}

export interface ErrorPayload {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/** The contracts §6 JSON error shape. Anything that is not a `RowblyError` is `INTERNAL`. */
export function errorPayload(err: unknown): ErrorPayload {
  if (isRowblyError(err)) return { error: { code: err.code, message: err.message, details: err.details } };
  return { error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err), details: {} } };
}

/** Writes an error to stderr: `{"error":{…}}` with `--json`, otherwise `error: <message>` plus an optional hint. */
export function printError(err: unknown, { json, streams = processStreams }: PrintOptions): void {
  const payload = errorPayload(err);
  if (json) {
    streams.stderr.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  streams.stderr.write(`${colors.red(`error: ${payload.error.message}`)}\n`);
  if (isRowblyError(err) && err.hint) streams.stderr.write(`${colors.dim(`hint: ${err.hint}`)}\n`);
}

/** Writes warnings to stderr: `{"warning":…}` lines with `--json`, otherwise `warning: <message>`. */
export function printWarnings(warnings: readonly string[], { json, streams = processStreams }: PrintOptions): void {
  for (const warning of warnings) {
    streams.stderr.write(json ? `${JSON.stringify({ warning })}\n` : `${colors.yellow(`warning: ${warning}`)}\n`);
  }
}
