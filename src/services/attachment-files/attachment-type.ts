// The MIME type of an attachment and the name of its file on disk.

const PNG_TYPE = "image/png";
const UNKNOWN_TYPE = "application/octet-stream";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MIME_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/;
const SAFE_EXTENSION = /^\.[a-z0-9]{1,16}$/;

/**
 * The MIME types of the known extensions. A different extension gives `application/octet-stream`. Only the signature
 * gives `image/png`, so that a PNG record always has PNG bytes.
 */
const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".log": "text/plain",
  ".html": "text/html",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
};

/** Tells whether the bytes start with the PNG signature. */
function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

/** Tells whether the value is a lower-case MIME type, for example `text/plain`. */
export function isMimeType(value: unknown): value is string {
  return typeof value === "string" && MIME_TYPE.test(value);
}

/** The lower-case extension of the name, with its dot, or an empty text when the name has no extension. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Gives the MIME type of an attachment: the PNG signature first, then the extension of the name. */
export function attachmentType(name: string, bytes: Uint8Array): string {
  if (isPng(bytes)) {
    return PNG_TYPE;
  }

  return EXTENSION_TYPES[extensionOf(name)] ?? UNKNOWN_TYPE;
}

/**
 * Gives the name of the file of an attachment record. A PNG is `<id>.png`, as in earlier versions. A different
 * type keeps the safe extension of its name, so that the application of the platform can open it.
 */
export function attachmentFileName(record: { readonly id: string; readonly name: string; readonly type: string }) {
  if (record.type === PNG_TYPE) {
    return `${record.id}.png`;
  }

  const extension = extensionOf(record.name);

  return SAFE_EXTENSION.test(extension) ? `${record.id}${extension}` : record.id;
}

/**
 * Tells whether `file` is a name that `attachmentFileName` can give for the id: the id alone, or the id with one safe
 * extension, for example `<id>.png` or `<id>.pdf`. Such a name is one safe path segment.
 */
export function isAttachmentFileName(id: string, file: unknown): file is string {
  if (typeof file !== "string" || !file.startsWith(id)) {
    return false;
  }

  const extension = file.slice(id.length);

  return extension === "" || SAFE_EXTENSION.test(extension);
}
