// Read and call budgets (PERF-07): what the scaling fixes of PERF-01/02/03/04/08/09 promise, pinned
// as counts on the generated fixture at two sizes, so a change that brings back a cross-product
// (reads per Epic × Story, per link, per candidate slug, per lookup) fails here. Counts, not timings:
// nothing here depends on the machine. `pnpm bench:plugins` measures the time.
import { describe, expect, it, vi } from 'vitest';
import { builtInPlugins } from '../../src/plugins';
import { listEpicSummaries } from '../../src/plugins/epics/service';
import { deleteSpec, listSpecSlugs, SpecsBag } from '../../src/plugins/specs/specs';
import { CoreChangeSet } from '../../src/services/plugins/changeSet';
import { createRepositories } from '../../src/storage';
import { tempRoot } from '../helpers';
import { withPlugins } from '../plugins/helpers';
import { fixtureStory, generateFixture } from './fixture';

/** Every `readFile` of `node:fs/promises` while `on`: what the review's `count-reads.mjs` counted. */
const reads = vi.hoisted(() => ({ on: false, paths: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readFile = ((path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
    if (reads.on) reads.paths.push(String(path));
    return (actual.readFile as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.readFile;
  return { ...actual, readFile, default: { ...actual, readFile } };
});

interface ReadCounts {
  story: number;
  board: number;
  spec: number;
  epic: number;
  other: number;
}

/** Runs `work` and counts its reads by kind of file. */
async function counted<T>(work: () => Promise<T>): Promise<{ result: T; counts: ReadCounts }> {
  reads.paths = [];
  reads.on = true;
  let result: T;
  try {
    result = await work();
  } finally {
    reads.on = false;
  }
  const counts: ReadCounts = { story: 0, board: 0, spec: 0, epic: 0, other: 0 };
  for (const path of reads.paths) {
    if (path.endsWith('story.json')) counts.story++;
    else if (path.endsWith('board.config.json')) counts.board++;
    else if (path.endsWith('.md')) counts.spec++;
    else if (/plugins[\\/]epics[\\/][^\\/]+\.json$/.test(path)) counts.epic++;
    else counts.other++;
  }
  return { result, counts };
}

const SMALL = 12;
const LARGE = 36;

/** The fixture with `stories` Stories, the Built-in Plugins on, and services over it. */
async function fixture(stories: number, shape: { epics?: number; specs?: number } = {}) {
  const t = await tempRoot();
  await generateFixture(t.path, { stories, epics: 6, specs: 4, ...shape });
  const loaded = await withPlugins(t, builtInPlugins);
  // The fixture is valid: nothing to report before anything is counted.
  expect((await loaded.services.doctor.check()).findings).toEqual([]);
  return { t, ...loaded };
}

describe('read budgets on the generated fixture', () => {
  it('Epic summaries read each Story once, however many Epics there are (PERF-01)', async () => {
    for (const [stories, epics] of [
      [SMALL, 3],
      [SMALL, 9],
      [LARGE, 9],
    ] as const) {
      const { services } = await fixture(stories, { epics });
      const list = vi.spyOn(services.stories, 'list');
      const { result, counts } = await counted(() => listEpicSummaries(services.plugins.context('epics'), 'all'));
      expect(result.summaries).toHaveLength(epics);
      expect(list).toHaveBeenCalledTimes(1);
      expect(counts.story).toBe(stories);
      expect(counts.epic).toBe(epics);
      list.mockRestore();
    }
  });

  it('doctor reads each linked Spec document once, not once per link (PERF-02)', async () => {
    const small = await fixture(SMALL);
    const large = await fixture(LARGE);
    const a = (await counted(() => small.services.doctor.check())).counts;
    const b = (await counted(() => large.services.doctor.check())).counts;
    // Four Specs and `common`, linked twice per Story: five documents at either size. Each Story is
    // read once; Board configurations and Epics do not grow with the Stories.
    expect(a).toMatchObject({ spec: 5, story: SMALL });
    expect(b).toMatchObject({ spec: 5, story: LARGE, board: a.board, epic: a.epic, other: a.other });
  });

  it('a multi-Spec filter parses each Story’s bag once (PERF-08)', async () => {
    const { services } = await fixture(LARGE);
    const parse = vi.spyOn(SpecsBag, 'safeParse');
    const listed = await services.stories.list('web', { plugins: { specs: ['spec-0', 'spec-1', 'spec-2'] } });
    expect(listed).toHaveLength(LARGE * (3 / 4));
    expect(parse).toHaveBeenCalledTimes(LARGE);
    parse.mockRestore();
  });

  it('slug-only Spec controls read no documents (PERF-09)', async () => {
    const { services } = await fixture(SMALL);
    const { result, counts } = await counted(() => listSpecSlugs(services.plugins.context('specs'), 'web'));
    expect(result).toEqual(['common', 'spec-0', 'spec-1', 'spec-2', 'spec-3']);
    expect(counts.spec).toBe(0);
  });

  it('a bulk unlink reads each Story a fixed number of times (PERF-04)', async () => {
    const run = async (stories: number) => {
      const { services } = await fixture(stories);
      const { result, counts } = await counted(() =>
        deleteSpec(services.plugins.context('specs'), { board: 'web', slug: 'common' }),
      );
      expect(result).toBe(stories);
      return counts;
    };
    const a = await run(SMALL);
    const b = await run(LARGE);
    // Each Story: once by the list, once as the first update's `before`; no reread when it is saved.
    expect(a.story).toBe(2 * SMALL);
    expect(b.story).toBe(2 * LARGE);
    // One Board configuration read per updated Story, plus a fixed number: linear, not a cross-product.
    expect(b.board - a.board).toBe(LARGE - SMALL);
    expect(b.spec).toBe(a.spec);
  });
});

describe('Change Set lookups (PERF-03)', () => {
  /** How many array elements `work` visits through the Array methods that scan. */
  async function visited(work: () => Promise<void>): Promise<number> {
    const names = ['find', 'filter', 'some', 'every', 'findIndex', 'indexOf', 'includes'] as const;
    const proto = Array.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const originals = names.map((name) => [name, proto[name]] as const);
    let count = 0;
    for (const [name, original] of originals) {
      proto[name] = function (this: unknown[], ...args: unknown[]) {
        count += this.length;
        return original?.apply(this, args);
      };
    }
    try {
      await work();
    } finally {
      for (const [name, original] of originals) proto[name] = original as (...args: unknown[]) => unknown;
    }
    return count;
  }

  /** Visits while a plan of `n` new Stories is looked up and updated, each Story once. */
  async function lookups(n: number): Promise<number> {
    const t = await tempRoot();
    await generateFixture(t.path, { stories: 0, epics: 0, specs: 0 });
    const changes = new CoreChangeSet(t.root, createRepositories(t.root));
    const stories = Array.from({ length: n }, (_, i) => fixtureStory(i + 1, { epics: 0, specs: 0 }));
    for (const story of stories) await changes.putStory(story);
    return visited(async () => {
      for (const story of stories) {
        expect(changes.story(story.key.toLowerCase())?.after?.key).toBe(story.key);
        await changes.updateStory(story.key, (s) => ({ ...s, name: `${s.name}!` }));
      }
    });
  }

  it('grows linearly with the plan, not with plan × lookups', async () => {
    const a = await lookups(100);
    const b = await lookups(400);
    // Four times the Stories: about four times the work when linear, sixteen when quadratic.
    expect(b / a).toBeLessThan(5);
  });
});
