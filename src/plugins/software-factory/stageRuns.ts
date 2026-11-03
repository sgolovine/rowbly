import {
  type Bagged,
  type ChangeSetView,
  ConflictError,
  type DeepReadonly,
  type GuardResult,
  NotFoundError,
  type PluginChangeSet,
  type PluginCommandEnv,
  type PluginContext,
  type PluginHookContext,
  type PluginReadContext,
  SlugSchema,
  type Story,
  TimestampSchema,
  toTimestamp,
  UsageError,
  ValidationError,
  z,
} from '../../plugin-api';
import { type Eligibility, storyEligibility } from './eligibility';
import { boardOverview } from './stagePrompts';

/**
 * One agent's work on a Story during its current visit to a Stage (ADR-0040). A Stage change ends
 * the visit, so a Story has at most one, and only one for its current Stage counts.
 */
export const StageRun = z.object({
  stage: SlugSchema,
  status: z.enum(['running', 'finished', 'failed']),
  attempt: z.number().int().min(1),
  worker: z.string().trim().min(1),
  by: SlugSchema.nullable(),
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema.optional(),
  reason: z.string().trim().min(1).optional(),
});
export type StageRun = z.infer<typeof StageRun>;

/** The Software Factory bag on a Story. A Story without a Stage Run has no bag. */
export const StageRunBag = z.object({ stageRun: StageRun });

/** The Story's Stage Run for its current visit, or `null`; one left from another Stage does not count. */
export function currentRun(plugin: PluginReadContext, story: Bagged & { stage: string }): StageRun | null {
  const run = plugin.readBag(story, StageRunBag)?.stageRun;
  return run && run.stage === story.stage ? run : null;
}

/**
 * The `stories.move` and `stories.update` transform: a Story that changes Stage loses its Stage Run,
 * so its next Stage, or the same Stage on a later visit, starts unworked (ADR-0040 §2).
 */
export async function endVisit(changes: PluginChangeSet, key: string, plugin: PluginReadContext): Promise<void> {
  const change = changes.story(key);
  if (!change?.before || !change.after || change.before.stage === change.after.stage) return;
  // An invalid bag is left for doctor to report rather than dropped (ADR-0011).
  if (plugin.inspectBag(change.after, StageRunBag).kind !== 'valid') return;
  await changes.updateStory(key, (story) => plugin.writeBag(story, undefined));
}

/** Names one Stage Run: its Stage, attempt and start (ADR-0045 §2). */
export const RunRef = z.strictObject({
  stage: SlugSchema,
  attempt: z.number().int().min(1),
  startedAt: TimestampSchema,
});
export type RunRef = z.infer<typeof RunRef>;

/** This Plugin's input of `stories.move`: move only while `finishedRun` is the visit's finished Stage Run. */
export const MoveInput = z.strictObject({ finishedRun: RunRef });

/** A Stage Run reference as `--finished-run` takes it: `<stage>/<attempt>/<startedAt>`. */
export function formatRunRef(run: RunRef): string {
  return `${run.stage}/${run.attempt}/${run.startedAt}`;
}

export function parseRunRef(text: string): RunRef {
  const match = /^([^/]+)\/(\d+)\/([^/]+)$/.exec(text);
  const parsed = match && RunRef.safeParse({ stage: match[1], attempt: Number(match[2]), startedAt: match[3] });
  if (!parsed?.success)
    throw new ValidationError(`--finished-run "${text}" is not <stage>/<attempt>/<startedAt> of a Stage Run`);
  return parsed.data;
}

/**
 * The `stories.move` guard for `--finished-run` (ADR-0045 §2). It runs after every transform and
 * reads the Story as stored when the move took the Data Root lock, so a Stage Run cleared, replaced or
 * started again since `apply` planned the move refuses it, and nothing is saved.
 */
export async function guardFinishedRun(
  changes: ChangeSetView,
  key: string,
  input: DeepReadonly<{ finishedRun: RunRef }> | undefined,
  plugin: PluginHookContext,
): Promise<GuardResult> {
  if (!input) return undefined;
  const stored = changes.story(key)?.before ?? (await plugin.services.stories.get(key));
  const run = currentRun(plugin, stored);
  const want = input.finishedRun;
  if (run?.status === 'finished' && formatRunRef(run) === formatRunRef(want)) return undefined;
  return {
    reject: `${stored.key} was not moved: its Stage Run ${formatRunRef(want)} is not this visit's finished Stage Run (now ${
      run ? `${formatRunRef(run)}, ${run.status}` : 'none'
    })`,
  };
}

/** The latest Story `key`: as this operation left it, else as stored. */
async function latest(changes: PluginChangeSet, plugin: PluginContext, key: string): Promise<Story> {
  return (changes.story(key)?.after as Story | null | undefined) ?? (await plugin.services.stories.get(key));
}

async function saveRun(changes: PluginChangeSet, plugin: PluginContext, key: string, run: StageRun): Promise<void> {
  await changes.updateStory(key, (story) => ({
    ...plugin.writeBag(story, { stageRun: run }),
    updatedAt: toTimestamp(plugin.now()),
  }));
}

export interface StageRunResult {
  key: string;
  stageRun: StageRun;
}

/**
 * Starts a Stage Run on the Story's current Stage (`software-factory.start`). The Stage's Stage
 * Prompt must be on. A Stage Run for this visit refuses it, unless it failed and `retry` is set,
 * which runs it again with the next attempt.
 */
export async function startRun(
  plugin: PluginContext,
  key: string,
  input: { worker: string; retry?: boolean },
): Promise<StageRunResult> {
  const worker = input.worker.trim();
  if (!worker) throw new UsageError('A Stage Run needs a worker');
  const stored = await plugin.services.stories.get(key);
  return plugin.operation(
    'start',
    { key: stored.key, worker, ...(input.retry ? { retry: true } : {}) },
    async (changes) => {
      const story = await latest(changes, plugin, stored.key);
      const stage = (await boardOverview(plugin, story.boardId)).stages.find((s) => s.key === story.stage);
      if (!stage?.prompt.enabled)
        throw new ConflictError(`Stage "${story.stage}" of ${story.key} has no Stage Prompt that is on`);
      plugin.requireBag(story, StageRunBag);
      const current = currentRun(plugin, story);
      if (current && !(input.retry && current.status === 'failed'))
        throw new ConflictError(
          current.status === 'failed'
            ? `${story.key} has a failed Stage Run in "${story.stage}"; start it again with --retry`
            : `${story.key} already has a ${current.status} Stage Run in "${story.stage}"`,
          { details: { key: story.key, stageRun: current } },
        );
      if (input.retry && !current)
        throw new ConflictError(`${story.key} has no failed Stage Run in "${story.stage}" to retry`);
      const eligibility = await storyEligibility(plugin, story);
      if (!eligibility.eligible)
        throw new ConflictError(`${story.key}: ${eligibility.reasons.map((reason) => reason.message).join('; ')}`, {
          details: { key: story.key, eligibility },
        });
      const run: StageRun = {
        stage: story.stage,
        status: 'running',
        attempt: current ? current.attempt + 1 : 1,
        worker,
        by: plugin.me,
        startedAt: toTimestamp(plugin.now()),
      };
      await saveRun(changes, plugin, story.key, run);
      return { key: story.key, stageRun: run };
    },
  );
}

/** Ends the running Stage Run of this visit as finished or failed (`software-factory.finish` / `.fail`). */
export async function endRun(
  plugin: PluginContext,
  key: string,
  outcome: { status: 'finished' } | { status: 'failed'; reason?: string },
): Promise<StageRunResult> {
  const stored = await plugin.services.stories.get(key);
  const reason = outcome.status === 'failed' ? outcome.reason?.trim() || undefined : undefined;
  return plugin.operation(
    outcome.status === 'finished' ? 'finish' : 'fail',
    { key: stored.key, ...(reason ? { reason } : {}) },
    async (changes) => {
      const story = await latest(changes, plugin, stored.key);
      plugin.requireBag(story, StageRunBag);
      const current = currentRun(plugin, story);
      if (current?.status !== 'running')
        throw new ConflictError(`${story.key} has no running Stage Run in "${story.stage}"`);
      const { reason: _old, ...rest } = current;
      const run: StageRun = {
        ...rest,
        status: outcome.status,
        finishedAt: toTimestamp(plugin.now()),
        ...(reason ? { reason } : {}),
      };
      await saveRun(changes, plugin, story.key, run);
      return { key: story.key, stageRun: run };
    },
  );
}

/** Removes the Story's Stage Run, so its Stage is worked again (`software-factory.clear`). */
export async function clearRun(plugin: PluginContext, key: string): Promise<{ cleared: string }> {
  const stored = await plugin.services.stories.get(key);
  return plugin.operation('clear', { key: stored.key }, async (changes) => {
    const story = await latest(changes, plugin, stored.key);
    if (!plugin.requireBag(story, StageRunBag)) throw new NotFoundError(`${story.key} has no Stage Run`);
    await changes.updateStory(story.key, (s) => ({
      ...plugin.writeBag(s, undefined),
      updatedAt: toTimestamp(plugin.now()),
    }));
    return { cleared: story.key };
  });
}

export interface RunsOverview {
  board: string;
  /** The Stages whose Stage Prompt is on, in Board order. */
  stages: string[];
  stories: { key: string; name: string; stage: string; stageRun: StageRun | null; eligibility: Eligibility }[];
  /** A hash of `stages` and `stories`: any change to them changes it (`wait --since`). */
  digest: string;
}

/** Every Story of the Board in a Stage whose Stage Prompt is on, with its Stage Run for this visit. */
export async function runsOverview(plugin: PluginContext, board: string): Promise<RunsOverview> {
  const overview = await boardOverview(plugin, board);
  const stages = overview.stages.filter((s) => s.prompt.enabled).map((s) => s.key);
  // An empty Stage filter would match every Stage.
  const stories = stages.length ? await plugin.services.stories.list(board, { stages }) : [];
  const rows = await Promise.all(
    stories.map(async (s) => ({
      key: s.key,
      name: s.name,
      stage: s.stage,
      stageRun: currentRun(plugin, s),
      eligibility: await storyEligibility(plugin, s),
    })),
  );
  return { board, stages, stories: rows, digest: digestOf({ stages, stories: rows }) };
}

/**
 * A short hash of what `runs` lists, so a supervisor can wait until it changes. It tells states
 * apart and nothing more (a Plugin imports no Node built-in): two 32-bit lanes of a multiply-xor
 * hash over the JSON text.
 */
function digestOf(state: Pick<RunsOverview, 'stages' | 'stories'>): string {
  const text = JSON.stringify(state);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export interface WaitResult extends RunsOverview {
  /** Whether `digest` differs from the one waited on; `false` when the wait timed out. */
  changed: boolean;
}

/**
 * Waits until the Board's `runs` differ from the digest `since`, or from the first read without it:
 * a Story entering or leaving a Stage whose Stage Prompt is on, a Stage Prompt turned on or off, or a
 * Stage Run started, ended or cleared. Rechecks on every change to the Data Root, so a change to
 * another Board that alters what `runs` lists counts too. `signal` ends the wait unchanged.
 */
export async function waitForRuns(
  plugin: PluginContext,
  board: string,
  waitFor: PluginCommandEnv<unknown>['waitFor'],
  opts: { since?: string; signal?: AbortSignal },
): Promise<WaitResult> {
  let since = opts.since;
  const read = () => runsOverview(plugin, board);
  const next = await waitFor(
    async () => {
      const overview = await read();
      since ??= overview.digest;
      return overview.digest === since ? undefined : overview;
    },
    { signal: opts.signal },
  );
  const overview = next ?? (await read());
  return { changed: overview.digest !== (since ?? overview.digest), ...overview };
}

/** A Stage Run in one line, for `stories show`, the TUI Story screen and the `runs` table. */
export function runText(run: StageRun | null): string {
  if (!run) return '—';
  const attempt = run.attempt > 1 ? `, attempt ${run.attempt}` : '';
  const reason = run.reason ? `: ${run.reason}` : '';
  return `${run.status} (${run.worker}${attempt})${reason}`;
}
