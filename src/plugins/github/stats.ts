import { type BoardStatValue, type PluginBoardStats, UsageError, z } from '../../plugin-api';
import { GitHubBag, parsePrUrl } from './model';

const Sha = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i)
  .transform((value) => value.toLowerCase());
const Response = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        id: z.string().min(1).max(256),
        url: z.string(),
        headRefOid: Sha,
        commits: z.object({
          totalCount: z.number().int().nonnegative(),
          nodes: z.array(z.object({ commit: z.object({ oid: Sha }) })).max(100),
          pageInfo: z.object({ endCursor: z.string().max(512).nullable(), hasNextPage: z.boolean() }),
        }),
      }),
    }),
  }),
});

interface Candidate {
  url: string;
  id?: string;
  head?: string;
  total?: number;
  after?: string;
  cursors: Set<string>;
  shas: Set<string>;
  pages: number;
  complete: boolean;
}

export const boardStats: PluginBoardStats = {
  metrics: [
    { key: 'linked-prs', label: 'Linked PRs' },
    { key: 'commits', label: 'Commits in linked PRs' },
  ],
  async collect({ stories, plugin }) {
    const links = new Set<string>();
    const reasons = new Set<string>();
    let invalid = false;
    for (const story of stories) {
      const bag = plugin.inspectBag(story, GitHubBag);
      if (bag.kind === 'invalid') {
        invalid = true;
        reasons.add('Some stored GitHub PR links are unreadable');
      }
      if (bag.kind === 'valid') links.add(parsePrUrl(bag.value.pr).toLowerCase());
    }
    if (links.size > 100) reasons.add('Reached the 100-PR refresh limit');
    const candidates: Candidate[] = [...links]
      .sort()
      .slice(0, 100)
      .map((url) => ({
        url,
        cursors: new Set(),
        shas: new Set(),
        pages: 0,
        complete: false,
      }));
    // Initial pages precede continuation pages, so a large PR cannot starve identity resolution.
    const jobs = [...candidates];
    let next = 0;
    let requests = 0;
    async function worker() {
      while (next < jobs.length && requests < 200 && !plugin.externalReadSignal.aborted) {
        const candidate = jobs[next++];
        if (!candidate) break;
        requests++;
        candidate.pages++;
        try {
          const response = await plugin.externalRead('gh-pr-commits', {
            url: candidate.url,
            ...(candidate.after ? { after: candidate.after } : {}),
          });
          if (response.exitCode !== 0) throw new UsageError('GitHub PR commit read failed');
          const parsed = Response.safeParse(JSON.parse(response.stdout));
          if (!parsed.success || parsed.data.errors?.length)
            throw new UsageError('GitHub PR commit response is incomplete or unreadable');
          const pr = parsed.data.data.repository.pullRequest;
          const canonical = new URL(parsePrUrl(pr.url));
          const requested = new URL(candidate.url);
          if (
            canonical.hostname !== requested.hostname ||
            canonical.pathname.split('/').at(-1) !== requested.pathname.split('/').at(-1)
          )
            throw new UsageError('GitHub PR identity did not match its link');
          const id = `${canonical.hostname}:${pr.id}`;
          if (
            candidate.id &&
            (candidate.id !== id || candidate.head !== pr.headRefOid || candidate.total !== pr.commits.totalCount)
          )
            throw new UsageError('GitHub PR changed during pagination');
          candidate.id = id;
          candidate.head = pr.headRefOid;
          candidate.total = pr.commits.totalCount;
          for (const node of pr.commits.nodes) candidate.shas.add(node.commit.oid);
          const page = pr.commits.pageInfo;
          if (!page.hasNextPage) {
            if (candidate.shas.size !== candidate.total) throw new UsageError('GitHub PR commit list was truncated');
            candidate.complete = true;
          } else {
            if (
              !page.endCursor ||
              !/^[A-Za-z0-9+/_=-]+$/.test(page.endCursor) ||
              candidate.cursors.has(page.endCursor) ||
              !pr.commits.nodes.length
            )
              throw new UsageError('GitHub PR pagination did not advance');
            candidate.cursors.add(page.endCursor);
            candidate.after = page.endCursor;
            if (candidate.pages < 10) jobs.push(candidate);
            else reasons.add('Reached the 10-page per-PR refresh limit');
          }
        } catch (error) {
          candidate.complete = false;
          candidate.shas.clear();
          reasons.add(error instanceof UsageError ? error.message : 'GitHub PR commits unavailable');
        }
      }
    }
    await Promise.all([worker(), worker()]);
    if (next < jobs.length && requests >= 200) reasons.add('Reached the 200-page refresh limit');
    if (plugin.externalReadSignal.aborted) reasons.add('Stats refresh was cancelled or reached its time limit');

    const groups = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      if (candidate.id) groups.set(candidate.id, [...(groups.get(candidate.id) ?? []), candidate]);
    }
    const shas = new Set<string>();
    let completed = 0;
    for (const group of groups.values()) {
      const first = group[0];
      const complete = group.find((candidate) => candidate.complete);
      if (group.some((candidate) => candidate.head !== first?.head || candidate.total !== first?.total)) {
        reasons.add('GitHub PR changed between linked aliases');
      } else if (complete) {
        completed++;
        for (const sha of complete.shas) shas.add(sha);
      }
    }
    const identitiesComplete = !invalid && links.size <= 100 && candidates.every((candidate) => candidate.id);
    const commitsComplete = identitiesComplete && completed === groups.size;
    const reason = [...reasons].join('; ') || 'Some linked PR information is unavailable';
    const value = (count: number, complete: boolean, known: boolean): BoardStatValue =>
      complete
        ? { status: 'complete', value: count }
        : known
          ? { status: 'partial', value: count, reason }
          : { status: 'unavailable', value: null, reason };
    return {
      'linked-prs': value(groups.size, identitiesComplete, groups.size > 0),
      commits: value(shas.size, commitsComplete, completed > 0),
    };
  },
};
