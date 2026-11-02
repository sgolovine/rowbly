import { ConflictError, type PluginContext, type Story, type StoryContext } from '../../plugin-api';
import { boardOverview } from './stagePrompts';
import { currentRun } from './stageRuns';

/**
 * The context part of a Worker's brief (ADR-0044): the sections the worker brief template of the
 * `rowbly-factory` skill leaves to fill in, which the supervisor sends after the template's rules.
 */
export interface WorkerBrief {
  key: string;
  board: string;
  stage: string;
  /** The attempt of the Story's Stage Run for this visit, or `null` before one starts. */
  attempt: number | null;
  /** `false` when a Plugin's part, or a retry's context, is missing or partial. */
  complete: boolean;
  incomplete: StoryContext['incomplete'];
  sections: StoryContext['sections'];
  markdown: string;
}

export interface BriefInput {
  /** The supervisor's retry context, as the skill captures it; required from attempt 2. */
  retry?: string;
  /** The user's instructions for workers. */
  instructions?: string;
  /** Give the brief even when it is incomplete, with every gap listed at its top. */
  allowIncomplete?: boolean;
}

/** What the brief says where `ROWBLY.md` goes: this command does not read it. */
const GUIDE_PLACEHOLDER =
  '<ROWBLY.md, or "None." when the Data Root has none: the supervisor adds it here; `software-factory brief` does not read it>';

/**
 * The context part of the brief of the Worker for Story `key` in its current Stage, whose Stage
 * Prompt must be on. It only reads, and the same Board data and input give the same brief. An
 * incomplete context is a `ConflictError` with `details.incomplete`, unless `allowIncomplete`.
 */
export async function workerBrief(plugin: PluginContext, key: string, input: BriefInput = {}): Promise<WorkerBrief> {
  const context = await plugin.storyContext(key);
  const { story } = context;
  const [overview, effective] = await Promise.all([
    boardOverview(plugin, story.boardId),
    plugin.services.config.effective(story.boardId),
  ]);
  const stage = overview.stages.find((s) => s.key === story.stage);
  if (!stage?.prompt.enabled || stage.prompt.text === null)
    throw new ConflictError(`Stage "${story.stage}" of ${story.key} has no Stage Prompt that is on`);
  const run = currentRun(plugin, story);
  const attempt = run?.attempt ?? null;
  const retry = input.retry?.trim() || undefined;
  const incomplete = [...context.incomplete];
  if (attempt !== null && attempt > 1 && !retry)
    incomplete.push({
      plugin: 'software-factory',
      reason: `attempt ${attempt} needs its retry context (--retry-file)`,
    });
  if (incomplete.length && !input.allowIncomplete)
    throw new ConflictError(`The brief of ${story.key} is incomplete`, {
      details: { key: story.key, incomplete },
      hint: 'repair what each entry names (`rowbly doctor` finds invalid Plugin Data), or pass --allow-incomplete',
    });

  const stages = effective.stages.map((s) => `${s.key} (${s.name})`).join(', ');
  const parts: string[] = [];
  if (incomplete.length)
    parts.push(
      '## Incomplete context',
      'This brief is missing parts of the Story. Ask the supervisor before relying on them:',
      incomplete.map((gap) => `- ${gap.plugin}: ${gap.reason}`).join('\n'),
    );
  parts.push('## Story', storyText(story, stage.name, effective.board.name));
  for (const section of context.sections)
    parts.push(
      `### ${section.title}${section.unavailable ? ` (incomplete: ${section.unavailable})` : ''}`,
      section.text.trim() || 'None.',
    );
  parts.push(`Plugins on: ${context.plugins.join(', ') || 'none'}. Stages of the Board, in order: ${stages}.`);
  parts.push(`## Stage Prompt: ${stage.name}`, stage.prompt.text.trim());
  parts.push('## How people work with this Board', GUIDE_PLACEHOLDER);
  parts.push('## Other instructions', input.instructions?.trim() || 'None.');
  if (retry) parts.push('## Retry', retry);

  return {
    key: story.key,
    board: story.boardId,
    stage: story.stage,
    attempt,
    complete: incomplete.length === 0,
    incomplete,
    sections: context.sections,
    markdown: `${parts.join('\n\n')}\n`,
  };
}

/** The Story's own fields: Key, name, Stage, Board, the fields that are set, and its description. */
function storyText(story: Story, stageName: string, boardName: string): string {
  const lines = [
    `${story.key}: ${story.name}`,
    `Stage: ${stageName} (\`${story.stage}\`). Board: ${boardName} (\`${story.boardId}\`).`,
  ];
  if (story.priority) lines.push(`Priority: ${story.priority}.`);
  if (story.labels.length) lines.push(`Labels: ${story.labels.join(', ')}.`);
  if (story.dueDate) lines.push(`Due: ${story.dueDate}.`);
  for (const [field, value] of Object.entries(story.customFields).sort(([a], [b]) => a.localeCompare(b)))
    lines.push(`${field}: ${typeof value === 'string' ? value : JSON.stringify(value)}.`);
  return `${lines.join('\n')}\n\n${story.description.trim() || 'No description.'}`;
}
