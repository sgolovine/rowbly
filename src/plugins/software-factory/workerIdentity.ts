import {
  ConflictError,
  type PluginChangeSetView,
  type PluginContext,
  type PluginHookContext,
  StoryKeySchema,
  toTimestamp,
  UsageError,
  z,
} from '../../plugin-api';
import { RunRef, requireRunMetadata, requireRunRef, runRef, WorkerIdentity, writeRunMetadata } from './runMetadata';
import { type StageRun, StageRunBag } from './stageRuns';

export const AttachWorker = z.strictObject({
  ...RunRef.shape,
  ...WorkerIdentity.omit({ verification: true }).shape,
  source: z.string().trim().min(1),
});
export type AttachWorker = z.infer<typeof AttachWorker>;

export async function attachWorker(plugin: PluginContext, key: string, input: AttachWorker) {
  const parsed = AttachWorker.safeParse(input);
  if (!parsed.success) throw new UsageError(`Invalid worker attachment: ${parsed.error.message}`);
  const value = parsed.data;
  const stored = await plugin.services.stories.get(key);
  return plugin.operation('attach', { key: stored.key, ...value }, async (changes) => {
    const story = changes.story(stored.key)?.after ?? (await plugin.services.stories.get(stored.key));
    const run = requireRunRef(story, value);
    if (run.status !== 'running') throw new ConflictError(`${story.key}: worker attachment needs a running Stage Run`);
    const metadata = await requireRunMetadata(changes, story, value);
    if (metadata.identity) {
      const { verification, ...identity } = metadata.identity;
      const { stage: _stage, attempt: _attempt, startedAt: _started, source, ...given } = value;
      if (
        JSON.stringify(identity) !== JSON.stringify(given) ||
        verification.source !== source ||
        verification.by !== plugin.me
      )
        throw new ConflictError(`${story.key}: verified worker identity is already attached; replacement is refused`);
      if (run.worker !== value.worker)
        throw new ConflictError(`${story.key}: attached identity differs from its worker`);
      return { key: story.key, stageRun: run, identity: metadata.identity };
    }
    const identity: WorkerIdentity = {
      worker: value.worker,
      machine: value.machine,
      harness: value.harness,
      threadId: value.threadId,
      verification: { source: value.source, verifiedAt: toTimestamp(plugin.now()), by: plugin.me },
    };
    const attached: StageRun = { ...run, worker: identity.worker };
    await changes.updateStory(story.key, (s) => ({
      ...plugin.writeBag(s, { stageRun: attached }),
      updatedAt: toTimestamp(plugin.now()),
    }));
    await writeRunMetadata(changes, story, { ...metadata, identity });
    return { key: story.key, stageRun: attached, identity };
  });
}

/** Final pending-state check after every transform, while the Data Root is still locked. */
export async function guardAttachedWorker(
  plugin: PluginHookContext,
  changes: PluginChangeSetView,
  result: unknown,
): Promise<undefined> {
  const expected = z
    .object({ key: StoryKeySchema, stageRun: StageRunBag.shape.stageRun, identity: WorkerIdentity })
    .parse(result);
  const change = changes.story(expected.key);
  if (change && !change.after) throw new ConflictError(`${expected.key}: Story was removed during attachment`);
  const story = change?.after ?? (await plugin.services.stories.get(expected.key));
  const run = requireRunRef(story, expected.stageRun);
  const metadata = await requireRunMetadata(changes, story, runRef(expected.stageRun));
  if (
    run.status !== 'running' ||
    run.worker !== expected.identity.worker ||
    JSON.stringify(metadata.identity) !== JSON.stringify(expected.identity)
  )
    throw new ConflictError(`${story.key}: Stage Run or verified identity changed during attachment`);
}

/** New starts must not acquire an old identity through a transform or a colliding timestamp. */
export async function guardStartedRun(
  _plugin: PluginHookContext,
  changes: PluginChangeSetView,
  result: unknown,
): Promise<undefined> {
  const expected = z.object({ key: StoryKeySchema, stageRun: StageRunBag.shape.stageRun }).parse(result);
  const change = changes.story(expected.key);
  if (!change?.after) throw new ConflictError(`${expected.key}: new Stage Run was removed`);
  const run = requireRunRef(change.after, expected.stageRun);
  const metadata = await requireRunMetadata(changes, change.after, expected.stageRun);
  if (run.status !== 'running' || run.worker !== expected.stageRun.worker || metadata.identity || metadata.heartbeat)
    throw new ConflictError(`${expected.key}: new Stage Run changed during start`);
}
