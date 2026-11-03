import {
  ConflictError,
  DataIntegrityError,
  NotFoundError,
  type PluginContext,
  type PluginReadContext,
  SlugSchema,
  TimestampSchema,
  toTimestamp,
  UsageError,
  z,
} from '../../plugin-api';

/**
 * A person's request that no Stage Run start for a Story until it is released (ADR-0043). It is a
 * Story-scope Plugin file, not part of the Stage Run bag, so a Rowbly release that does not know holds
 * keeps it unchanged instead of dropping it.
 */
export const Hold = z
  .object({
    version: z.literal(1),
    reason: z.string().trim().min(1),
    by: SlugSchema.nullable(),
    heldAt: TimestampSchema,
  })
  .strict();
export type Hold = z.infer<typeof Hold>;

export const HOLD_FILE = 'hold.json';

/** A Story's hold: none, a valid one, or a file this Rowbly cannot read, which counts as held. */
export type HoldState = { kind: 'none' } | { kind: 'held'; hold: Hold } | { kind: 'unreadable'; message: string };

/**
 * Reads the hold file text. A file that does not parse, has another `version` or has fields this
 * Rowbly does not know is unreadable, so they are kept rather than dropped (compatibility.md §3.4).
 */
export function parseHold(text: string | null): HoldState {
  if (text === null) return { kind: 'none' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'unreadable', message: 'its hold file is not valid JSON' };
  }
  const version = (raw as { version?: unknown } | null)?.version;
  if (version !== 1)
    return {
      kind: 'unreadable',
      message: `its hold file has version ${JSON.stringify(version ?? null)}, which this Rowbly does not support`,
    };
  const parsed = Hold.safeParse(raw);
  if (parsed.success) return { kind: 'held', hold: parsed.data };
  const unknown = parsed.error.issues.flatMap((issue) => (issue.code === 'unrecognized_keys' ? issue.keys : []));
  return {
    kind: 'unreadable',
    message: unknown.length
      ? `its hold file has fields this Rowbly does not know: ${unknown.join(', ')}`
      : 'its hold file is invalid',
  };
}

/**
 * The hold as stored, through `read`. A file that exists but cannot be read (a symbolic link, which is
 * never followed, or one without permission) is unreadable; a missing file is no hold.
 */
async function storedHold(read: () => Promise<string | null>): Promise<HoldState> {
  let text: string | null;
  try {
    text = await read();
  } catch {
    return { kind: 'unreadable', message: 'its hold file cannot be read' };
  }
  return parseHold(text);
}

/** The Story's hold as stored. */
export function readHold(plugin: PluginReadContext, key: string): Promise<HoldState> {
  return storedHold(() => plugin.files.read({ story: key }, HOLD_FILE));
}

/** A hold in one line, for `stories show`, the TUI Story screen and the `runs` table. */
export function holdText(state: HoldState): string {
  if (state.kind === 'none') return '—';
  if (state.kind === 'unreadable') return `held: ${state.message}`;
  return `held${state.hold.by ? ` by ${state.hold.by}` : ''}: ${state.hold.reason}`;
}

/** The `HELD` eligibility reason, or `null` when the Story is not held. An unreadable hold counts. */
export function heldReason(state: HoldState): { code: 'HELD'; message: string } | null {
  if (state.kind === 'none') return null;
  return { code: 'HELD', message: holdText(state).replace(/^held/, 'Held') };
}

/** Hold and release leave a hold file they cannot read unchanged (docs/plugins/compatibility.md §3.4). */
function refuseUnreadable(story: { key: string; boardId: string }, state: HoldState): void {
  if (state.kind === 'unreadable')
    throw new DataIntegrityError(`The hold of ${story.key} cannot be changed: ${state.message}`, {
      hint: `run \`rowbly doctor\`; repair or delete boards/${story.boardId}/stories/${story.key}/plugins/software-factory/${HOLD_FILE}`,
      details: { key: story.key },
    });
}

/** Holds a Story out of Stage Runs (`software-factory.hold`). Its Stage Run, if any, is unchanged. */
export async function holdStory(
  plugin: PluginContext,
  key: string,
  input: { reason: string },
): Promise<{ key: string; hold: Hold }> {
  const reason = input.reason.trim();
  if (!reason) throw new UsageError('A hold needs a reason');
  const stored = await plugin.services.stories.get(key);
  return plugin.operation('hold', { key: stored.key, reason }, async (changes) => {
    const state = await storedHold(() => changes.readFile({ story: stored.key }, HOLD_FILE));
    refuseUnreadable(stored, state);
    if (state.kind === 'held')
      throw new ConflictError(`${stored.key} is already ${holdText(state)}`, {
        details: { key: stored.key, hold: state.hold },
      });
    const hold: Hold = { version: 1, reason, by: plugin.me, heldAt: toTimestamp(plugin.now()) };
    await changes.writeFile({ story: stored.key }, HOLD_FILE, `${JSON.stringify(hold, null, 2)}\n`);
    return { key: stored.key, hold };
  });
}

/** Releases a held Story, so its Stage Runs start again as before (`software-factory.release`). */
export async function releaseStory(plugin: PluginContext, key: string): Promise<{ key: string; released: Hold }> {
  const stored = await plugin.services.stories.get(key);
  return plugin.operation('release', { key: stored.key }, async (changes) => {
    const state = await storedHold(() => changes.readFile({ story: stored.key }, HOLD_FILE));
    refuseUnreadable(stored, state);
    if (state.kind !== 'held') throw new NotFoundError(`${stored.key} is not held`);
    await changes.deleteFile({ story: stored.key }, HOLD_FILE);
    return { key: stored.key, released: state.hold };
  });
}
