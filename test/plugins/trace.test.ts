// The opt-in operation trace (OBS-01): `ROWBLY_DEBUG=trace` names every Plugin callback with its
// operation, stage, time and outcome on stderr, keeps `--json` stdout parseable, and logs no payload.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/main';
import { definePlugin, z } from '../../src/plugin-api';
import { formatTrace, setTraceSink, type TraceEvent, traceBuffer, traceRequested } from '../../src/services';
import { makeStory } from '../helpers';
import { pluginRoot, withPlugins } from './helpers';

const SECRET = 'hunter2-secret';

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

const Mark = z.object({ mark: z.string() });

/** Writes its input as a bag; refuses `--mark refuse`; fails on `--mark bug`. */
const first = definePlugin({
  id: 'first',
  name: 'First',
  description: 'Marks Stories',
  settings: z.object({ token: z.string().optional() }),
  inputs: { 'stories.create': Mark },
  hooks: {
    'stories.create': {
      async transform({ changes, result, pluginInput, plugin }) {
        if (pluginInput?.mark === 'bug') throw new TypeError(`transform bug ${SECRET}`);
        if (pluginInput) await changes.updateStory(result.key, (s) => plugin.writeBag(s, { ...pluginInput }));
      },
      guard: ({ pluginInput }) =>
        pluginInput?.mark === 'refuse' ? { reject: `refused ${SECRET}`, hint: 'not this one' } : undefined,
      react() {},
    },
  },
  options: {
    'stories create': {
      options: [{ flags: '--mark <text>', description: 'a mark' }],
      input: ({ mark }) => (typeof mark === 'string' ? { mark } : undefined),
    },
  },
});

const second = definePlugin({
  id: 'second',
  name: 'Second',
  description: 'Watches Stories',
  hooks: { 'stories.create': { transform() {}, guard() {} } },
});

const slow = definePlugin({
  id: 'slow',
  name: 'Slow',
  description: 'Never finishes reacting',
  hooks: { 'stories.update': { react: () => new Promise<void>(() => {}) } },
});

async function create(args: string[], registry = [first, second]) {
  const t = await pluginRoot({ first: { token: SECRET }, second: true });
  const code = await main(
    ['--root', t.path, '--json', 'stories', 'create', '--board', 'web', '--name', SECRET, ...args],
    registry,
  );
  return { code, lines: traceLines() };
}

/** The trace lines on stderr, without their timings. */
function traceLines(): string[] {
  return stderr
    .join('')
    .split('\n')
    .filter((line) => line.startsWith('rowbly trace'))
    .map((line) => line.replace(/ \d+\.\d ms$/, ''));
}

describe('the operation trace (OBS-01)', () => {
  it('is off unless ROWBLY_DEBUG asks for it', async () => {
    const { code, lines } = await create(['--mark', 'a']);
    expect(code).toBe(0);
    expect(lines).toEqual([]);
  });

  it('names each callback in stage and registry order, and stdout stays parseable JSON', async () => {
    vi.stubEnv('ROWBLY_DEBUG', 'trace');
    const { code, lines } = await create(['--mark', 'a']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('')).plugins).toEqual({ first: { mark: 'a' } });
    // Option input is converted before the operation starts, so it has an ID of its own.
    const [input, ...rest] = lines;
    expect(input).toMatch(/^rowbly trace op-\d+ option-input option-input plugin=first ok$/);
    const op = /^rowbly trace (op-\d+) /.exec(rest[0] ?? '')?.[1];
    expect(rest).toEqual([
      `rowbly trace ${op} stories.create transform plugin=first ok`,
      `rowbly trace ${op} stories.create transform plugin=second ok`,
      `rowbly trace ${op} stories.create guard plugin=first ok`,
      `rowbly trace ${op} stories.create guard plugin=second ok`,
      `rowbly trace ${op} stories.create commit ok changes=story:1`,
      `rowbly trace ${op} stories.create operation ok`,
      `rowbly trace ${op} stories.create reaction plugin=first ok`,
    ]);
  });

  it('locates a failing hook by Plugin and stage', async () => {
    vi.stubEnv('ROWBLY_DEBUG', 'trace');
    const { code, lines } = await create(['--mark', 'bug']);
    expect(code).toBe(1);
    expect(lines).toContainEqual(
      expect.stringMatching(/ stories\.create transform plugin=first failed code=INTERNAL$/),
    );
    expect(lines.at(-1)).toMatch(/ stories\.create operation failed code=INTERNAL at=transform:first$/);
    expect(lines.some((line) => line.includes('second'))).toBe(false);
    expect(lines.some((line) => line.includes(' commit '))).toBe(false);
  });

  it('tells a guard rejection from a failure', async () => {
    vi.stubEnv('ROWBLY_DEBUG', 'trace');
    const { code, lines } = await create(['--mark', 'refuse']);
    expect(code).toBe(4);
    expect(lines).toContainEqual(expect.stringMatching(/ guard plugin=first ok$/));
    expect(lines.at(-1)).toMatch(/ stories\.create operation rejected code=CONFLICT at=guard:first$/);
  });

  it('marks a reaction that runs past its deadline', async () => {
    const t = await pluginRoot({ slow: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [slow], { reactionTimeoutMs: 20 });
    const events: TraceEvent[] = [];
    setTraceSink((event) => events.push(event));
    try {
      await services.stories.update('WEB-1', { name: 'Renamed' });
    } finally {
      setTraceSink(undefined);
    }
    expect(events.at(-1)).toMatchObject({
      operation: 'stories.update',
      plugin: 'slow',
      stage: 'reaction',
      outcome: 'timeout',
    });
  });

  it('never records inputs, settings, messages or record text', async () => {
    vi.stubEnv('ROWBLY_DEBUG', 'trace');
    await create(['--mark', SECRET]);
    await create(['--mark', 'bug']);
    await create(['--mark', 'refuse']);
    const trace = traceLines().join('\n');
    expect(trace).not.toBe('');
    expect(trace).not.toContain(SECRET);
    expect(trace).not.toContain('hunter2');
  });
});

describe('trace helpers', () => {
  it('ROWBLY_DEBUG asks for the trace alone or in a list', () => {
    expect(traceRequested({ ROWBLY_DEBUG: 'trace' })).toBe(true);
    expect(traceRequested({ ROWBLY_DEBUG: 'other, trace' })).toBe(true);
    expect(traceRequested({ ROWBLY_DEBUG: 'tracer' })).toBe(false);
    expect(traceRequested({})).toBe(false);
  });

  it('the TUI buffer keeps the latest events and says how many it dropped', () => {
    const buffer = traceBuffer(2);
    for (const stage of ['field', 'filter', 'screen']) {
      buffer.sink({ operationId: 'op-1', operation: stage, plugin: 'a', stage, ms: 1, outcome: 'ok' });
    }
    expect(buffer.lines()).toEqual([
      'rowbly trace: 1 earlier events dropped',
      'rowbly trace op-1 filter filter plugin=a ok 1.0 ms',
      'rowbly trace op-1 screen screen plugin=a ok 1.0 ms',
    ]);
  });

  it('a timeout is its own outcome', () => {
    expect(
      formatTrace({
        operationId: 'op-2',
        operation: 'stories.create',
        plugin: 'slow',
        stage: 'reaction',
        ms: 5000,
        outcome: 'timeout',
      }),
    ).toBe('rowbly trace op-2 stories.create reaction plugin=slow timeout 5000.0 ms');
  });

  it('nothing is recorded with no sink', () => {
    const seen: TraceEvent[] = [];
    setTraceSink((event) => seen.push(event));
    setTraceSink(undefined);
    expect(seen).toEqual([]);
  });
});
