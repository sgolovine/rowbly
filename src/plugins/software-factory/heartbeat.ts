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
import { Heartbeat, requireRunMetadata, requireRunRef, runRef, writeRunMetadata } from './runMetadata';
import { RunRef } from './runRef';
import { StageRunBag } from './stageRuns';

export const TouchRun = z.strictObject({
  ...RunRef.shape,
  worker: z.string().trim().min(1),
  source: z.string().trim().min(1),
});
export type TouchRun = z.infer<typeof TouchRun>;

/** The Run must be running, with an attached identity for this worker; a touch never attaches one. */
function requireWorker(
  key: string,
  run: { status: string; worker: string },
  identity: { worker: string } | undefined,
  worker: string,
): void {
  if (run.status !== 'running') throw new ConflictError(`${key}: a heartbeat needs a running Stage Run`);
  if (!identity) throw new ConflictError(`${key}: the Stage Run has no verified worker; attach it first`);
  if (identity.worker !== worker || run.worker !== worker)
    throw new ConflictError(`${key}: the Stage Run's verified worker is ${identity.worker}, not ${worker}`);
}

/**
 * Records the supervisor's verified evidence that the running Stage Run's worker was active
 * (`software-factory.touch`, ADR-0048 §2). It names the Run and worker it expects, keeps the other
 * sections of the Run details, and never creates an identity.
 */
export async function touchRun(plugin: PluginContext, key: string, input: TouchRun) {
  const parsed = TouchRun.safeParse(input);
  if (!parsed.success) throw new UsageError(`Invalid heartbeat: ${parsed.error.message}`);
  const value = parsed.data;
  const stored = await plugin.services.stories.get(key);
  return plugin.operation('touch', { key: stored.key, ...value }, async (changes) => {
    const story = changes.story(stored.key)?.after ?? (await plugin.services.stories.get(stored.key));
    const run = requireRunRef(story, value);
    const metadata = await requireRunMetadata(changes, story, value);
    requireWorker(story.key, run, metadata.identity, value.worker);
    const heartbeat: Heartbeat = {
      worker: value.worker,
      at: toTimestamp(plugin.now()),
      source: value.source,
      by: plugin.me,
    };
    await writeRunMetadata(changes, story, { ...metadata, heartbeat });
    return { key: story.key, stageRun: run, heartbeat };
  });
}

/** Final pending-state check after every transform, while the Data Root is still locked. */
export async function guardTouchedRun(
  plugin: PluginHookContext,
  changes: PluginChangeSetView,
  result: unknown,
): Promise<undefined> {
  const expected = z
    .object({ key: StoryKeySchema, stageRun: StageRunBag.shape.stageRun, heartbeat: Heartbeat })
    .parse(result);
  const change = changes.story(expected.key);
  if (change && !change.after) throw new ConflictError(`${expected.key}: Story was removed during the heartbeat`);
  const story = change?.after ?? (await plugin.services.stories.get(expected.key));
  const run = requireRunRef(story, expected.stageRun);
  const metadata = await requireRunMetadata(changes, story, runRef(expected.stageRun));
  requireWorker(story.key, run, metadata.identity, expected.heartbeat.worker);
  if (JSON.stringify(metadata.heartbeat) !== JSON.stringify(expected.heartbeat))
    throw new ConflictError(`${story.key}: the heartbeat changed while it was saved`);
}
