// The shared types and the command runner of the clipboard reader.
import { type ExecFileException, execFile } from "node:child_process";

/** The image types that a clipboard read can give. */
export type ClipboardImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type ClipboardFailureReason =
  | "unsupported"
  | "no-display"
  | "no-image"
  | "too-large"
  | "timeout"
  | "multiple-files";

export type ClipboardFailure = { readonly reason: ClipboardFailureReason };

export type ClipboardImage = { readonly kind: "image"; readonly bytes: Uint8Array; readonly type: ClipboardImageType };

export type ClipboardReadResult = { readonly kind: "file"; readonly path: string } | ClipboardImage | ClipboardFailure;

export const MAX_BYTES = 10 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Gives an image result for PNG bytes, or a failure for bytes that are too large or are not a PNG. */
export function png(bytes: Buffer): ClipboardImage | ClipboardFailure {
  if (bytes.length > MAX_BYTES) {
    return { reason: "too-large" };
  }

  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { reason: "unsupported" };
  }

  return { kind: "image", bytes, type: "image/png" };
}

function commandResult(error: ExecFileException | null, stdout: Buffer, deadline: number): Buffer | ClipboardFailure {
  if (!error) {
    return stdout;
  }

  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return { reason: "too-large" };
  }

  if (error.killed || Date.now() >= deadline) {
    return { reason: "timeout" };
  }

  return { reason: error.code === "ENOENT" ? "unsupported" : "no-display" };
}

/** Runs a clipboard command with the time that remains before the deadline. A missing command gives `unsupported`. */
export function runCommand(
  file: string,
  args: readonly string[],
  deadline: number,
  maxBuffer: number,
): Promise<Buffer | ClipboardFailure> {
  const left = deadline - Date.now();

  if (left <= 0) {
    return Promise.resolve({ reason: "timeout" });
  }

  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { encoding: "buffer", timeout: left, killSignal: "SIGKILL", maxBuffer },
      (error, stdout) => resolve(commandResult(error, stdout, deadline)),
    );
  });
}

/** Splits the output of a command into its lines. */
export function outputLines(output: Buffer): string[] {
  return output.toString("utf8").split(/\r?\n/);
}
