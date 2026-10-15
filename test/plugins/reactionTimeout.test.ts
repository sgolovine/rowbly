// RES-15, W7: each reaction has a deadline; a reaction that never settles only warns (ADR-0020 §4).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/main';
import { definePlugin } from '../../src/plugin-api';
import { makeStory } from '../helpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

/** A promise and its resolver, to order concurrent work without sleeping. */
function barrier<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const timers = () => process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;

const hang = definePlugin({
  id: 'hang',
  name: 'Hang',
  description: '',
  hooks: { 'stories.update': { react: () => new Promise<void>(() => {}) } },
});

function later(seen: string[]) {
  return definePlugin({
    id: 'later',
    name: 'Later',
    description: '',
    hooks: { 'stories.update': { react: ({ result }) => void seen.push(result.name) } },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('reaction deadline (RES-15)', () => {
  it('a reaction that never settles times out with a warning; the operation returns and later reactions run', async () => {
    const seen: string[] = [];
    const t = await pluginRoot({ hang: true, later: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services, warnings } = await withPlugins(t, [hang, later(seen)], { reactionTimeoutMs: 20 });

    const story = await services.stories.update('WEB-1', { name: 'Renamed' });
    expect(story.name).toBe('Renamed');
    expect((await readJsonFile(t, storyFile('WEB-1'))).name).toBe('Renamed');
    expect(warnings).toEqual(['Plugin "hang" did not finish reacting to stories.update within 20 ms']);
    expect(seen).toEqual(['Renamed']);
  });

  it('leaves no timer behind after reactions that finish', async () => {
    const seen: string[] = [];
    const t = await pluginRoot({ later: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [later(seen)], { reactionTimeoutMs: 60_000 });
    const before = timers();
    await services.stories.update('WEB-1', { name: 'A' });
    await services.stories.update('WEB-1', { name: 'B' });
    expect(seen).toEqual(['A', 'B']);
    // A 60 s deadline timer per reaction would still be pending here had it not been cleared.
    expect(timers()).toBeLessThanOrEqual(before);
  });

  it('a rejection after the deadline is only a warning', async () => {
    const fail = barrier();
    const slow = definePlugin({
      id: 'slow',
      name: 'Slow',
      description: '',
      hooks: {
        'stories.update': {
          async react() {
            await fail.promise;
            throw new Error('too late');
          },
        },
      },
    });
    const t = await pluginRoot({ slow: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services, warnings } = await withPlugins(t, [slow], { reactionTimeoutMs: 10 });
    await services.stories.update('WEB-1', { name: 'Renamed' });
    expect(warnings).toEqual(['Plugin "slow" did not finish reacting to stories.update within 10 ms']);

    fail.resolve();
    await vi.waitFor(() => expect(warnings).toHaveLength(2));
    expect(warnings[1]).toBe('Plugin "slow" failed to react to stories.update: too late');
  });

  it('the CLI prints its normal result and exits 0 after the default deadline', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const t = await pluginRoot({ hang: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });

    const code = await main(['--root', t.path, '--json', 'stories', 'edit', 'WEB-1', '--name', 'Renamed'], [hang]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('')).name).toBe('Renamed');
    expect(stderr.join('')).toContain('Plugin \\"hang\\" did not finish reacting to stories.update within 5 s');
  });
});

describe('background reactions (TUI)', () => {
  it('run one operation after another, in the order of the operations', async () => {
    const order: string[] = [];
    const first = barrier();
    const gate = barrier();
    const queue = definePlugin({
      id: 'queue',
      name: 'Queue',
      description: '',
      hooks: {
        'stories.update': {
          async react({ result }) {
            order.push(`start ${result.name}`);
            if (result.name === 'A') {
              first.resolve();
              await gate.promise;
            }
            order.push(`end ${result.name}`);
          },
        },
      },
    });
    const t = await pluginRoot({ queue: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [queue], { backgroundReactions: true });

    await services.stories.update('WEB-1', { name: 'A' });
    await first.promise;
    await services.stories.update('WEB-1', { name: 'B' });
    expect(order).toEqual(['start A']);
    gate.resolve();
    await vi.waitFor(() => expect(order).toEqual(['start A', 'end A', 'start B', 'end B']));
  });
});
