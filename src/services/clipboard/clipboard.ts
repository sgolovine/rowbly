import { ValidationError } from "../errors/errors.js";
import { readClipboardFiles } from "./clipboard-files.js";
import { readNative } from "./clipboard-native.js";
import {
  type ClipboardFailure,
  type ClipboardFailureReason,
  type ClipboardImageType,
  type ClipboardReadResult,
  MAX_BYTES,
  outputLines,
  png,
  runCommand,
} from "./clipboard-state.js";

export type { ClipboardFailureReason, ClipboardImageType, ClipboardReadResult } from "./clipboard-state.js";

/** The image types that `wl-paste` can give, in the order of preference. */
const WAYLAND_IMAGE_TYPES: readonly ClipboardImageType[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** The native results after which a Wayland session tries `wl-paste`. */
const WAYLAND_FALLBACK: readonly ClipboardFailureReason[] = ["unsupported", "no-display", "no-image"];

/** Gives the types of the Wayland clipboard, or the failure of `wl-paste --list-types`. */
async function waylandTypes(deadline: number): Promise<readonly string[] | ClipboardFailure | undefined> {
  if (process.platform !== "linux" || !process.env.WAYLAND_DISPLAY) {
    return undefined;
  }

  const types = await runCommand("wl-paste", ["--list-types"], deadline, MAX_BYTES);

  return Buffer.isBuffer(types) ? outputLines(types) : types;
}

/** Gives the one copied file, a fatal failure, or `undefined` when the clipboard has no file. */
async function readFile(
  deadline: number,
  types: readonly string[] | undefined,
): Promise<ClipboardReadResult | undefined> {
  const paths = await readClipboardFiles(deadline, types);

  if (paths === undefined || "reason" in paths) {
    return paths;
  }

  if (paths.length > 1) {
    return { reason: "multiple-files" };
  }

  return paths[0] === undefined ? undefined : { kind: "file", path: paths[0] };
}

/** Reads the first image type of the Wayland clipboard that Rowbly can attach. */
async function readWaylandImage(types: readonly string[], deadline: number): Promise<ClipboardReadResult> {
  const type = WAYLAND_IMAGE_TYPES.find((candidate) => types.includes(candidate));

  if (!type) {
    return { reason: "no-image" };
  }

  const bytes = await runCommand("wl-paste", ["--type", type], deadline, MAX_BYTES);

  if (!Buffer.isBuffer(bytes)) {
    return bytes;
  }

  if (type === "image/png") {
    return png(bytes);
  }

  return bytes.length ? { kind: "image", bytes, type } : { reason: "no-image" };
}

/** Gives the native result, or the image of `wl-paste` when the native read fails in a Wayland session. */
function waylandFallback(
  native: ClipboardReadResult,
  types: readonly string[] | ClipboardFailure | undefined,
  deadline: number,
): Promise<ClipboardReadResult> | ClipboardReadResult {
  if (!("reason" in native) || !WAYLAND_FALLBACK.includes(native.reason) || types === undefined) {
    return native;
  }

  if ("reason" in types) {
    return native.reason === "no-image" ? native : types;
  }

  return readWaylandImage(types, deadline);
}

/**
 * Reads a copied file or an image without touching the Data Root or printing. The order is the file list, the native
 * PNG read, then the image types of `wl-paste`. All attempts share a three-second deadline.
 */
export async function readClipboard(): Promise<ClipboardReadResult> {
  const deadline = Date.now() + 3000;
  const types = await waylandTypes(deadline);

  if (types && "reason" in types && types.reason === "timeout") {
    return types;
  }

  const listed = types && !("reason" in types) ? types : undefined;
  const file = await readFile(deadline, listed);

  if (file) {
    return file;
  }

  return waylandFallback(await readNative(deadline), types, deadline);
}

/** Gives the install hint of the clipboard command of the session. */
function installHint(): string {
  if (process.env.WAYLAND_DISPLAY) {
    return "Install wl-clipboard for Wayland. ";
  }

  return process.platform === "linux" && process.env.DISPLAY ? "Install xclip for X11. " : "";
}

/** Gives the ValidationError for a clipboard failure, with a hint for a file attachment. */
export function clipboardFailure(reason: ClipboardFailureReason, story?: string): ValidationError {
  const messages: Record<ClipboardFailureReason, string> = {
    unsupported: "Clipboard access is unsupported",
    "no-display": "No display is available for clipboard access",
    "no-image": "No file or image on the clipboard",
    "too-large": "Clipboard image exceeds 10 MiB",
    timeout: "Clipboard read timed out",
    "multiple-files": "The clipboard has more than one file; copy one file",
  };
  const fallback = story
    ? `Use \`rowbly add-attachment ${story} <file>\` to attach a file.`
    : "Save the Story first, then use its Attachments tab to add a file.";

  return new ValidationError(messages[reason], { details: { reason }, hint: `${installHint()}${fallback}` });
}
