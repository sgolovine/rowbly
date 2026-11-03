import {
  ConflictError,
  DataIntegrityError,
  type DeepReadonly,
  type PluginChangeSet,
  type PluginChangeSetView,
  type PluginReadContext,
  SlugSchema,
  type Story,
  TimestampSchema,
  z,
} from '../../plugin-api';
import { RunRef } from './runRef';
import { currentRun, type StageRun, StageRunBag } from './stageRuns';

export const RUN_METADATA_FILE = 'run-metadata.json';
const Text = z.string().trim().min(1);
export const WorkerIdentity = z.strictObject({
  worker: Text,
  machine: Text,
  harness: Text,
  threadId: Text,
  verification: z.strictObject({ source: Text, verifiedAt: TimestampSchema, by: SlugSchema.nullable() }),
});
export type WorkerIdentity = z.infer<typeof WorkerIdentity>;
export const RunMetadata = z
  .strictObject({
    version: z.literal(1),
    run: RunRef,
    identity: WorkerIdentity.optional(),
    selection: z
      .strictObject({
        provider: Text,
        model: Text,
        options: z.array(z.strictObject({ id: Text, value: z.union([z.string(), z.number(), z.boolean()]) })),
        rule: Text,
        fallback: Text.nullable(),
        usage: z.enum(['unknown', 'observed-limit', 'user-stated']),
        selectedBy: SlugSchema.nullable(),
        selectedAt: TimestampSchema,
      })
      .optional(),
    heartbeat: z
      .strictObject({ worker: Text, at: TimestampSchema, source: Text, by: SlugSchema.nullable() })
      .optional(),
  })
  .refine((m) => !m.heartbeat || m.heartbeat.worker === m.identity?.worker, {
    message: 'Heartbeat needs the same verified worker identity',
  });
export type RunMetadata = z.infer<typeof RunMetadata>;
export type MetadataState =
  | { status: 'absent'; current: false }
  | { status: 'valid'; current: boolean; metadata: RunMetadata }
  | { status: 'invalid' | 'unsupported'; current: false; message: string };

type RunStory = DeepReadonly<Story>;

export function runRef(run: RunRef): RunRef {
  return { stage: run.stage, attempt: run.attempt, startedAt: run.startedAt };
}
export function sameRunRef(a: RunRef, b: RunRef): boolean {
  return a.stage === b.stage && a.attempt === b.attempt && a.startedAt === b.startedAt;
}

async function readMetadata(read: () => Promise<string | null>): Promise<MetadataState> {
  try {
    const text = await read();
    if (text === null) return { status: 'absent', current: false };
    const raw: unknown = JSON.parse(text);
    if (raw && typeof raw === 'object' && 'version' in raw && raw.version !== 1)
      return {
        status: 'unsupported',
        current: false,
        message: 'Run details version is unsupported; this Rowbly reads version 1',
      };
    const parsed = RunMetadata.safeParse(raw);
    if (!parsed.success) return { status: 'invalid', current: false, message: parsed.error.message };
    return { status: 'valid', current: false, metadata: parsed.data };
  } catch (error) {
    return { status: 'invalid', current: false, message: `Run details cannot be read: ${(error as Error).message}` };
  }
}

/** A stale file is visible as stale, but never supplies the current Run's identity. */
export async function readRunMetadata(plugin: PluginReadContext, story: RunStory): Promise<MetadataState> {
  const state = await readMetadata(() => plugin.files.read({ story: story.key }, RUN_METADATA_FILE));
  if (state.status !== 'valid') return state;
  const run = currentRun(plugin, story);
  return {
    ...state,
    current:
      !!run &&
      sameRunRef(run, state.metadata.run) &&
      (!state.metadata.identity || state.metadata.identity.worker === run.worker),
  };
}

function requireReadable(state: MetadataState): void {
  if (state.status === 'invalid' || state.status === 'unsupported')
    throw new DataIntegrityError(`Run details are unavailable: ${state.message}`, {
      hint: 'run `rowbly doctor`; repair the file explicitly; its bytes are kept unchanged',
    });
}

/** Check the latest pending Story, never an unlocked snapshot supplied by a caller. */
export function requireRunRef(story: RunStory, expected: RunRef): StageRun {
  const parsed = StageRunBag.safeParse(story.plugins?.['software-factory']);
  if (!parsed.success || parsed.data.stageRun.stage !== story.stage || !sameRunRef(parsed.data.stageRun, expected))
    throw new ConflictError(`${story.key}: Stage Run changed; read its current Run before trying again`);
  return parsed.data.stageRun;
}

export async function requireRunMetadata(
  changes: PluginChangeSetView,
  story: RunStory,
  expected: RunRef,
): Promise<RunMetadata> {
  const change = changes.story(story.key);
  if (change && !change.after) throw new ConflictError(`${story.key}: Story was removed`);
  requireRunRef(change?.after ?? story, expected);
  const state = await readMetadata(() => changes.readFile({ story: story.key }, RUN_METADATA_FILE));
  requireReadable(state);
  return state.status === 'valid' && sameRunRef(state.metadata.run, expected)
    ? state.metadata
    : { version: 1, run: runRef(expected) };
}

/** Own mutations refuse opaque data. The caller keeps other sections by spreading requireRunMetadata's result. */
export async function writeRunMetadata(
  changes: PluginChangeSet,
  story: RunStory,
  metadata: RunMetadata,
): Promise<void> {
  const checked = RunMetadata.parse(metadata);
  await requireRunMetadata(changes, story, checked.run);
  const run = requireRunRef(changes.story(story.key)?.after ?? story, checked.run);
  if (checked.identity && checked.identity.worker !== run.worker)
    throw new ConflictError(`${story.key}: identity differs from the current Run's worker`);
  await changes.writeFile({ story: story.key }, RUN_METADATA_FILE, `${JSON.stringify(checked, null, 2)}\n`);
}

/** New starts always reset recognized data, even if a frozen clock recreates the exact same RunRef. */
export async function freshRunMetadata(changes: PluginChangeSet, story: RunStory, run: RunRef): Promise<RunMetadata> {
  const state = await readMetadata(() => changes.readFile({ story: story.key }, RUN_METADATA_FILE));
  requireReadable(state);
  const metadata: RunMetadata = { version: 1, run: runRef(run) };
  await writeRunMetadata(changes, story, metadata);
  return metadata;
}

/** Clear and Stage changes remove only positively recognized v1 data (ADR-0046). */
export async function endRunMetadata(changes: PluginChangeSet, key: string): Promise<void> {
  const state = await readMetadata(() => changes.readFile({ story: key }, RUN_METADATA_FILE));
  if (state.status === 'valid') await changes.deleteFile({ story: key }, RUN_METADATA_FILE);
}

/** Stable output exposes no stale worker or selection as current evidence. */
export function metadataOutput(state: MetadataState): {
  status: 'absent' | 'valid' | 'invalid' | 'unsupported';
  current: boolean;
  message?: string;
} & Partial<RunMetadata> {
  if (state.status !== 'valid') return state;
  return state.current ? { status: 'valid', current: true, ...state.metadata } : { status: 'valid', current: false };
}
