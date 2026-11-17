// The `host attach` channel of each worker host. One channel serves all active runs of the host.

import type { HostReceipt } from "../host-agent/host-agent-control.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import { openHostChannel } from "../host-transport/host-handshake.js";
import { Store, withEntry, withoutEntry } from "../store/store.js";
import { takeAttachmentRequest } from "./remote-attachment.js";
import { type RunHooks, takeReceipt, takeRunFrame } from "./remote-run.js";
import type { HostConnection, HostLink, RemoteEnv, RemoteRun } from "./remote-types.js";
import { isSessionFrame, takeSessionFrame } from "./session-mirror.js";

/** A frame of the channel after the hello frame. */
interface ChannelFrame {
  readonly type?: unknown;
  readonly run?: HostRunState;
  readonly receipt?: HostReceipt;
}

/** The active runs of a host. */
export function hostRuns(env: RemoteEnv, host: string): RemoteRun[] {
  return [...env.state.current.runs.values()].filter((run) => run.host === host);
}

/** Gives an `attachment-request` frame to the attachment handler of the link. */
function dispatchAttachmentRequest(env: RemoteEnv, host: string, value: unknown): void {
  const link = env.state.current.links.get(host);

  if (link) {
    void takeAttachmentRequest(env, link, value);
  }
}

/** Gives a run frame to the open run of its Thread, else to the hook of the other runs, for example an abandoned one. */
function dispatchRunFrame(env: RemoteEnv, host: string, hooks: RunHooks, frame: HostRunState): void {
  const run = env.state.current.runs.get(frame.threadId);

  if (run && run.host !== host) {
    return;
  }

  if (run && !run.store.current.closed) {
    takeRunFrame(run, frame, hooks);

    return;
  }

  hooks.otherRun?.(host, frame);
}

/** Gives a `session` frame to the mirror of its Thread, when the Thread is an active run of the host. */
function dispatchSessionFrame(env: RemoteEnv, host: string, value: unknown): void {
  if (!isSessionFrame(value)) {
    return;
  }

  const run = env.state.current.runs.get(value.threadId);

  if (run?.host === host) {
    void takeSessionFrame(env, host, value);
  }
}

/**
 * Gives each frame to the run of its Thread or of its command, to the session mirror, or to the attachment handler. A
 * frame of a different Thread is ignored.
 */
function dispatchFrame(env: RemoteEnv, host: string, hooks: RunHooks, value: unknown): void {
  const frame = (value ?? {}) as ChannelFrame;

  if (frame.type === "attachment-request") {
    dispatchAttachmentRequest(env, host, value);

    return;
  }

  if (frame.type === "session") {
    dispatchSessionFrame(env, host, value);

    return;
  }

  if (frame.type === "run" && frame.run) {
    dispatchRunFrame(env, host, hooks, frame.run);

    return;
  }

  if (frame.type === "receipt" && frame.receipt) {
    const id = frame.receipt.id;
    const run = hostRuns(env, host).find((candidate) => candidate.store.current.commandId === id);

    if (run) {
      takeReceipt(run, frame.receipt);
    }
  }
}

/** Records that the channel closed. A later launch opens a new channel. The runs of the host wait. */
function markClosed(env: RemoteEnv, host: string, closed: AbortController): void {
  closed.abort();
  env.state.update((state) => ({
    links: state.links.get(host)?.closed === closed ? withoutEntry(state.links, host) : state.links,
  }));
}

/** True when the host has an open channel, or a channel that opens now. */
export function linkOpen(env: RemoteEnv, host: string): boolean {
  const link = env.state.current.links.get(host);

  return !!link && !link.closed.signal.aborted;
}

/** Opens the channel of the host when it has none. The host must send a hello frame with the same versions. */
export async function ensureLink(
  env: RemoteEnv,
  host: string,
  connection: HostConnection,
  hooks: RunHooks,
): Promise<void> {
  const current = env.state.current.links.get(host);

  if (current && !current.closed.signal.aborted) {
    await current.opened;
    return;
  }

  const closed = new AbortController();
  const opened = openHostChannel(
    connection.transport,
    [connection.rowbly, "host", "attach", env.input.projectId],
    {
      onFrame: (frame) => dispatchFrame(env, host, hooks, frame),
      onClose: () => markClosed(env, host, closed),
    },
    env.input.helloTimeoutMs === undefined ? {} : { helloTimeoutMs: env.input.helloTimeoutMs },
  );
  const link: HostLink = { opened, closed, connection, fetching: new Store({ ids: new Set<string>() }) };

  env.state.update((state) => ({ links: withEntry(state.links, host, link) }));
  opened.catch(() => markClosed(env, host, closed));

  await opened;
}

/** Closes the channel of the host when the host has no active run. */
export function closeIdleLink(env: RemoteEnv, host: string): void {
  const link = env.state.current.links.get(host);

  if (!link || hostRuns(env, host).length > 0) {
    return;
  }

  env.state.update((state) => ({ links: withoutEntry(state.links, host) }));
  link.opened.then(
    (channel) => channel.close(),
    () => undefined,
  );
}
