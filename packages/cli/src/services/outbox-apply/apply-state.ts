// The shared types and helpers of the outbox apply on the main machine.

import { NotFoundError, RowblyError } from "../errors/errors.js";
import {
  HostAuthFailedError,
  HostTimeoutError,
  HostUnreachableError,
  HostVersionMismatchError,
} from "../host-transport/host-errors.js";
import { recordRef, resolveStoryRef, type Story } from "../story/story.js";
import type { ProjectPaths, ServiceContext } from "../workspace/workspace.js";
import type { OutboxSource } from "./outbox-source.js";

/** One change or entry that the main machine did not apply, because the value on the main machine is different. */
export interface OutboxConflict {
  readonly host: string;
  /** The `seq` of the entry, or 0 for an entry without a valid `seq`. */
  readonly seq: number;
  readonly storyId?: string;
  /** The path of a field change. */
  readonly path?: string;
  /** The attachment id of an attachment entry. */
  readonly attachmentId?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  /** The value on the main machine. */
  readonly current?: unknown;
  readonly reason: string;
  /** The path of the kept file of an `attachment.add` conflict. */
  readonly png?: string;
}

/** The abandoned Thread of a host whose later entries the apply holds. */
export interface AbandonedHold {
  readonly threadId: string;
  /** Only the entries with a greater `seq` are held. */
  readonly appliedSeq: number;
}

/** The fixed environment of one apply. */
export interface ApplyEnv {
  readonly host: string;
  readonly paths: ProjectPaths;
  /** The context of the services, without a recorder. */
  readonly ctx: ServiceContext;
  readonly source: Pick<OutboxSource, "blob">;
  /** The abandoned Threads of the host. The apply holds their later entries and does not apply them. */
  readonly abandoned?: readonly AbandonedHold[];
}

/** The Story of an entry, or the reason why the main machine cannot use it. */
export type FoundStory =
  | { readonly story: Story; readonly problem?: undefined }
  | { readonly story?: undefined; readonly problem: string };

/** The errors of the connection. The sync stops and tries again later, because the entry did not get a decision. */
const TRANSPORT_FAILURES = [HostUnreachableError, HostAuthFailedError, HostTimeoutError, HostVersionMismatchError];

/** Tells if the error is a failure of the connection to the host. */
export function isTransportFailure(error: unknown): boolean {
  return TRANSPORT_FAILURES.some((type) => error instanceof type);
}

/** Gives the message of an expected failure. Throws each other error again, because it is not a conflict. */
export function rowblyProblem(error: unknown): string {
  if (!(error instanceof RowblyError)) {
    throw error;
  }

  return error.message;
}

/**
 * Gives the Story of the entry: the Story with the `storyUid` of the entry first, then the Story with its ID. An
 * entry of an older build has no `storyUid`. A missing or invalid Story gives the reason.
 */
export async function findStory(
  env: ApplyEnv,
  entry: { readonly storyId: string; readonly storyUid?: string },
): Promise<FoundStory> {
  try {
    return { story: await resolveStoryRef(recordRef(entry.storyId, entry.storyUid), env.ctx) };
  } catch (error) {
    return { problem: error instanceof NotFoundError ? "The Story does not exist" : rowblyProblem(error) };
  }
}
