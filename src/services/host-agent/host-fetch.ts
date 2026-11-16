// The fetch request files of the host agent. A worker CLI writes a request for an attachment file that is not on the
// host. The `host attach` channel sends each request to the main machine, and writes the failure answer.

import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { validateAttachmentId } from "../attachment-files/attachment-files.js";
import { writeFileAtomic } from "../files/files.js";
import { ensurePrivateDir, type HostAgentPaths, validateStoryId } from "./host-agent-paths.js";

/** The content of `fetch/<id>.json`. */
export interface FetchRequest {
  readonly version: 1;
  readonly storyId: string;
  readonly id: string;
  readonly requestedAt: string;
}

/** The longest failure message that the host keeps. */
const MESSAGE_LIMIT = 2000;

/** The request file of the attachment id. A bad id gives a ValidationError before a path is made. */
function requestPath(paths: HostAgentPaths, id: string): string {
  validateAttachmentId(id);

  return join(paths.fetch, `${id}.json`);
}

/** The failure answer file of the attachment id. */
function failurePath(paths: HostAgentPaths, id: string): string {
  validateAttachmentId(id);

  return join(paths.fetch, `${id}.failed.json`);
}

/** Writes a new fetch request. An old failure answer of the id goes first. A bad id gives a ValidationError. */
export async function writeFetchRequest(
  paths: HostAgentPaths,
  input: { readonly storyId: string; readonly id: string; readonly now: Date },
): Promise<FetchRequest> {
  const request: FetchRequest = {
    version: 1,
    storyId: validateStoryId(input.storyId),
    id: input.id,
    requestedAt: input.now.toISOString(),
  };
  const path = requestPath(paths, input.id);

  await ensurePrivateDir(paths.fetch);
  await rm(failurePath(paths, input.id), { force: true });
  await writeFileAtomic(path, `${JSON.stringify(request)}\n`, { mode: 0o600 });

  return request;
}

/** Removes the request and the failure answer of the id. */
export async function removeFetchRequest(paths: HostAgentPaths, id: string): Promise<void> {
  await rm(requestPath(paths, id), { force: true });
  await rm(failurePath(paths, id), { force: true });
}

function isRequest(value: unknown, id: string): value is FetchRequest {
  const request = value as Partial<FetchRequest> | null;

  return (
    typeof request === "object" &&
    request !== null &&
    request.version === 1 &&
    request.id === id &&
    typeof request.storyId === "string" &&
    /^[A-Z][A-Z0-9]*-\d+$/.test(request.storyId) &&
    typeof request.requestedAt === "string"
  );
}

/** Reads one request. A missing or bad file gives `undefined`. */
async function readRequest(paths: HostAgentPaths, id: string): Promise<FetchRequest | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(requestPath(paths, id), "utf8"));

    return isRequest(value, id) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Gives the attachment id of a request file name, or `undefined` for each other file. */
function requestId(file: string): string | undefined {
  if (!file.endsWith(".json") || file.endsWith(".failed.json")) {
    return undefined;
  }

  const id = file.slice(0, -5);

  try {
    validateAttachmentId(id);

    return id;
  } catch {
    return undefined;
  }
}

/** Gives the open fetch requests, in the order of their ids. A bad file is not in the list. */
export async function readFetchRequests(paths: HostAgentPaths): Promise<readonly FetchRequest[]> {
  const files = await readdir(paths.fetch).catch(() => [] as string[]);
  const ids = files
    .map(requestId)
    .filter((id): id is string => id !== undefined)
    .toSorted();
  const requests = await Promise.all(ids.map((id) => readRequest(paths, id)));

  return requests.filter((request): request is FetchRequest => request !== undefined);
}

/** Writes the failure answer of an open request. Without an open request, it writes nothing. */
export async function writeFetchFailure(paths: HostAgentPaths, id: string, message: string): Promise<boolean> {
  if (!(await readRequest(paths, id))) {
    return false;
  }

  const text = JSON.stringify({ message: message.slice(0, MESSAGE_LIMIT) });

  await writeFileAtomic(failurePath(paths, id), `${text}\n`, { mode: 0o600 });

  return true;
}

/** Reads the failure answer of the id. A missing answer gives `undefined`. A bad answer gives a general message. */
export async function readFetchFailure(paths: HostAgentPaths, id: string): Promise<string | undefined> {
  const text = await readFile(failurePath(paths, id), "utf8").catch(() => undefined);

  if (text === undefined) {
    return undefined;
  }

  try {
    const message = (JSON.parse(text) as { message?: unknown } | null)?.message;

    return typeof message === "string" ? message : "The main machine refused the request";
  } catch {
    return "The main machine refused the request";
  }
}
