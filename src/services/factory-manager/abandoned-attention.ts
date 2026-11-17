// The attention entry `abandoned:<threadId>` of each abandoned remote Thread with held entries.

import type { OutboxEntry } from "../outbox/outbox.js";
import { heldView } from "../outbox-apply/held-actions.js";
import { readHeldEntries } from "../outbox-apply/held-entries.js";
import type { HeldRef } from "../outbox-apply/outbox-apply.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import type { Attention } from "./manager-state.js";

const TEXT_LIMIT = 500;

/** Gives the attention key of an abandoned Thread. */
export function abandonedKey(threadId: string): string {
  return `abandoned:${threadId}`;
}

/** Gives the paths or the attachment id that one entry changes. */
function changedText(entry: OutboxEntry): string {
  const view = heldView(entry);

  return view.paths ? view.paths.join(", ") : `attachment ${view.attachmentId}`;
}

/** Gives the summary of the held entries: the host, the number of entries, and what they change for each Story. */
export function heldText(host: string, threadId: string, entries: readonly OutboxEntry[]): string {
  const stories = [...new Set(entries.map((entry) => entry.storyId))];
  const changes = stories.map((storyId) => {
    const own = entries.filter((entry) => entry.storyId === storyId);

    return `${storyId}: ${[...new Set(own.map(changedText))].join(", ")}`;
  });
  const text = `Abandoned Thread ${threadId} on host ${host} has ${entries.length} held entries. ${changes.join("; ")}. Run \`rowbly thread held ${threadId}\`.`;

  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT - 1)}…` : text;
}

/**
 * Gives one attention entry for each Thread that got new held entries, with all held entries of that Thread. The
 * entry has the Story of the Thread, else the Story of its first held entry.
 */
export async function heldAttention(
  paths: ProjectPaths,
  host: string,
  held: readonly HeldRef[],
  storyOf: (threadId: string) => string | undefined = () => undefined,
): Promise<Map<string, Attention>> {
  const threadIds = [...new Set(held.map((ref) => ref.threadId))];
  const entries = await Promise.all(
    threadIds.map(async (threadId): Promise<[string, Attention] | undefined> => {
      const own = await readHeldEntries(paths, host, threadId);
      const storyId = storyOf(threadId) ?? own[0]?.storyId;

      return own.length === 0
        ? undefined
        : [abandonedKey(threadId), { text: heldText(host, threadId, own), ...(storyId ? { storyId } : {}) }];
    }),
  );

  return new Map(entries.filter((entry): entry is [string, Attention] => entry !== undefined));
}
