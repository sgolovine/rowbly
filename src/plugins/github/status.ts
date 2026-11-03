import { NotFoundError, type PluginContext, type Story, UsageError, z } from '../../plugin-api';
import { GitHubBag } from './model';

const Check = z.object({
  status: z.string().nullish(),
  conclusion: z.string().nullish(),
  state: z.string().nullish(),
});
const Response = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
  mergeable: z.string(),
  mergeStateStatus: z.string(),
  reviewDecision: z.string().nullish(),
  statusCheckRollup: z.array(Check).nullable(),
});

/** Unknown and non-success terminal conclusions stay separate from success. */
export function summarizeChecks(checks: z.output<typeof Response>['statusCheckRollup']) {
  const counts = { total: checks?.length ?? 0, passed: 0, failed: 0, pending: 0, other: 0 };
  for (const check of checks ?? []) {
    if (check.status !== undefined && check.status !== null) {
      if (check.status !== 'COMPLETED') counts.pending++;
      else if (check.conclusion === 'SUCCESS') counts.passed++;
      else if (['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(check.conclusion ?? '')) counts.failed++;
      else counts.other++;
    } else if (check.state === 'SUCCESS') counts.passed++;
    else if (check.state === 'PENDING' || check.state === 'EXPECTED') counts.pending++;
    else if (check.state === 'FAILURE' || check.state === 'ERROR') counts.failed++;
    else counts.other++;
  }
  return counts;
}

export async function fetchStatus(plugin: PluginContext, story: Story, signal?: AbortSignal) {
  const pr = plugin.requireBag(story, GitHubBag)?.pr;
  if (!pr)
    throw new NotFoundError(`${story.key} has no GitHub PR`, { hint: 'set it with stories edit --github-pr <url>' });
  const result = await plugin.externalRead('gh-pr-view', { url: pr }, { signal });
  if (result.exitCode !== 0)
    throw new UsageError('GitHub PR inspection failed', {
      hint: result.stderr.trim() || 'check gh auth status and access to the linked PR',
    });
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw new UsageError('GitHub PR inspection returned invalid JSON');
  }
  const parsed = Response.safeParse(raw);
  if (!parsed.success)
    throw new UsageError('GitHub PR inspection returned an unreadable result', {
      hint: 'update GitHub CLI and try again',
    });
  const { statusCheckRollup, ...prData } = parsed.data;
  return { pr, ...prData, checks: summarizeChecks(statusCheckRollup), fetchedAt: plugin.now().toISOString() };
}

export type PrStatus = Awaited<ReturnType<typeof fetchStatus>>;

export function checksText(checks: PrStatus['checks']): string {
  if (!checks.total) return 'not reported';
  return [
    `${checks.passed}/${checks.total} passed`,
    ...(checks.failed ? [`${checks.failed} failed`] : []),
    ...(checks.pending ? [`${checks.pending} pending`] : []),
    ...(checks.other ? [`${checks.other} other`] : []),
  ].join(', ');
}

export function statusText(status: PrStatus): string {
  return `#${status.number} ${status.state.toLowerCase()}${status.isDraft ? ' · draft' : ''} · checks ${checksText(status.checks)} · review ${status.reviewDecision?.toLowerCase().replaceAll('_', ' ') || 'not reported'}`;
}
