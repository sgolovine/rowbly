// The read of a file that the user copied in a file manager. The result is a path only. This module does not read the file.
import { fileURLToPath } from "node:url";
import { type ClipboardFailure, outputLines, runCommand } from "./clipboard-state.js";

/** A list of copied paths, a fatal failure, or `undefined` when the clipboard has no file list. */
type FileListResult = readonly string[] | ClipboardFailure | undefined;

const MAX_LIST_BYTES = 64 * 1024;
const URI_LIST = "text/uri-list";
const GNOME_FILES = "x-special/gnome-copied-files";
const MAC_SCRIPT = "POSIX path of (the clipboard as «class furl»)";
const WINDOWS_SCRIPT = "Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }";

function localPath(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

/** Gives the local paths of a `text/uri-list`. It ignores comments, empty lines and URIs that are not `file://`. */
export function parseUriList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && line.startsWith("file://"))
    .map(localPath)
    .filter((path): path is string => path !== undefined);
}

/** Gives the output of a file-list command. Only a timeout is fatal. A different failure means no file list. */
async function listOutput(
  file: string,
  args: readonly string[],
  deadline: number,
): Promise<Buffer | ClipboardFailure | undefined> {
  const output = await runCommand(file, args, deadline, MAX_LIST_BYTES);

  if (Buffer.isBuffer(output)) {
    return output;
  }

  return output.reason === "timeout" ? output : undefined;
}

/** Reads the paths of the first known file-list type, with the command that reads one type from the clipboard. */
async function readListType(
  types: readonly string[],
  read: (type: string) => Promise<Buffer | ClipboardFailure | undefined>,
): Promise<FileListResult> {
  const type = [URI_LIST, GNOME_FILES].find((candidate) => types.includes(candidate));

  if (!type) {
    return undefined;
  }

  const output = await read(type);

  if (!Buffer.isBuffer(output)) {
    return output;
  }

  // The GNOME type starts with the line `copy` or `cut`.
  const text = type === GNOME_FILES ? outputLines(output).slice(1).join("\n") : output.toString("utf8");

  return parseUriList(text);
}

function readWaylandFiles(types: readonly string[], deadline: number): Promise<FileListResult> {
  return readListType(types, (type) => listOutput("wl-paste", ["--type", type], deadline));
}

async function readX11Files(deadline: number): Promise<FileListResult> {
  const targets = await listOutput("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"], deadline);

  if (!Buffer.isBuffer(targets)) {
    return targets;
  }

  return readListType(outputLines(targets), (type) =>
    listOutput("xclip", ["-selection", "clipboard", "-t", type, "-o"], deadline),
  );
}

async function readCommandPaths(file: string, args: readonly string[], deadline: number): Promise<FileListResult> {
  const output = await listOutput(file, args, deadline);

  if (!Buffer.isBuffer(output)) {
    return output;
  }

  return outputLines(output)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Reads the copied files of the platform. On Wayland the caller gives the types of `wl-paste --list-types`, because the
 * image read uses the same list.
 */
export function readClipboardFiles(
  deadline: number,
  waylandTypes: readonly string[] | undefined,
): Promise<FileListResult> {
  if (process.platform === "darwin") {
    return readCommandPaths("osascript", ["-e", MAC_SCRIPT], deadline);
  }

  if (process.platform === "win32") {
    return readCommandPaths("powershell", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT], deadline);
  }

  if (process.platform !== "linux") {
    return Promise.resolve(undefined);
  }

  if (process.env.WAYLAND_DISPLAY) {
    return waylandTypes ? readWaylandFiles(waylandTypes, deadline) : Promise.resolve(undefined);
  }

  return process.env.DISPLAY ? readX11Files(deadline) : Promise.resolve(undefined);
}
