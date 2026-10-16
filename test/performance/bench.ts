// The Plugin scalability benchmark (PERF-07): `pnpm bench:plugins [--sizes 100,1000,5000]
// [--samples 3] [--no-cli]`. Opt-in and never part of `pnpm test`; read-budgets.test.ts pins the
// counts that CI checks. Prints every sample with the environment, fixture size and cache state.
// The numbers describe this machine at this moment: compare runs on one machine, and never turn
// them into CI thresholds.
//
// Each size gets a fresh generated fixture (fixture.ts) with the Built-in Plugins on, and a copy
// with them off. Doctor must find no error or warning in both before anything is timed. A sample whose command
// exits non-zero, or whose work throws or reports a finding, is invalid: it is printed as such, left
// out of the summary, and makes the run exit 1. Writes run on a fresh copy of the fixture per sample.
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { arch, cpus, loadavg, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reservedNames } from '../../src/main';
import { builtInPlugins } from '../../src/plugins';
import { listEpicSummaries } from '../../src/plugins/epics/service';
import { deleteSpec } from '../../src/plugins/specs/specs';
import { type DataRoot, StorySchema } from '../../src/schemas';
import { createServices, loadPlugins, newId, type Services } from '../../src/services';
import { FIXTURE_PLUGINS, generateFixture } from './fixture';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

interface Options {
  sizes: number[];
  samples: number;
  cli: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { sizes: [100, 1000, 5000], samples: 3, cli: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--sizes') options.sizes = value().split(',').map(Number);
    else if (arg === '--samples') options.samples = Number(value());
    else if (arg === '--no-cli') options.cli = false;
    else if (arg !== '--') throw new Error(`unknown argument ${arg}`);
  }
  if (!options.sizes.every((n) => Number.isInteger(n) && n > 0)) throw new Error('--sizes takes positive integers');
  if (!Number.isInteger(options.samples) || options.samples < 1) throw new Error('--samples takes a positive integer');
  return options;
}

/** One timed sample: its duration in ms, or why it is invalid. */
type Sample = { ms: number } | { invalid: string };

interface Result {
  label: string;
  samples: Sample[];
  note?: string;
}

let invalidSamples = 0;

/** Times `work` `samples` times; `prepare` runs untimed before each sample. */
async function measure<C>(
  label: string,
  samples: number,
  work: (prepared: C) => Promise<void> | void,
  prepare: () => Promise<C> | C,
  note?: string,
): Promise<Result> {
  const out: Sample[] = [];
  for (let i = 0; i < samples; i++) {
    try {
      const prepared = await prepare();
      const start = performance.now();
      await work(prepared);
      out.push({ ms: performance.now() - start });
    } catch (err) {
      invalidSamples++;
      out.push({ invalid: err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err) });
    }
  }
  const result: Result = { label, samples: out, ...(note ? { note } : {}) };
  print(result);
  return result;
}

function print({ label, samples, note }: Result): void {
  const valid = samples.flatMap((s) => ('ms' in s ? [s.ms] : [])).sort((a, b) => a - b);
  const shown = samples.map((s) => ('ms' in s ? s.ms.toFixed(1) : `INVALID (${s.invalid})`)).join(', ');
  const stats = valid.length
    ? `min ${valid[0]?.toFixed(1)}  median ${valid[Math.floor((valid.length - 1) / 2)]?.toFixed(1)}  max ${valid.at(-1)?.toFixed(1)}`
    : 'no valid sample';
  console.log(`  ${label.padEnd(50)} ${stats} ms   samples [${shown}]${note ? `   (${note})` : ''}`);
}

/** Fresh services over `root`, with its Plugins loaded as the CLI loads them; repository caches start empty. */
async function open(root: DataRoot): Promise<{ services: Services; warnings: string[] }> {
  const host = await loadPlugins({ root, registry: builtInPlugins, reserved: reservedNames() });
  const warnings = host.failures().map((f) => `${f.id} failed to load: ${f.reason}`);
  const services = createServices({
    root,
    local: { version: 1 },
    me: null,
    now: () => new Date(),
    newId,
    warn: (message) => warnings.push(message),
    plugins: host,
  });
  return { services, warnings };
}

/**
 * Runs doctor and throws on an error or a warning. Info findings stay: with the Plugins off, doctor
 * notes that their data is kept but not checked.
 */
async function doctorClean(services: Services): Promise<void> {
  const problems = (await services.doctor.check()).findings.filter((f) => f.severity !== 'info');
  if (problems.length) throw new Error(`doctor found ${problems.length} problems, first: ${problems[0]?.message}`);
}

/** Builds the CLI into a folder of its own, as the test run does, and returns its path. */
async function buildCli(): Promise<{ cli: string; remove(): Promise<void> }> {
  const outDir = await mkdtemp(join(REPO, '.test-dist', 'bench-'));
  execFileSync(process.execPath, ['node_modules/tsup/dist/cli-default.js', '--out-dir', outDir, '--silent'], {
    cwd: REPO,
    stdio: 'inherit',
  });
  return { cli: join(outDir, 'cli.js'), remove: () => rm(outDir, { recursive: true, force: true }) };
}

/** Runs the built CLI once; a non-zero exit throws, so the sample is invalid. */
function runCli(cli: string, args: string[]): void {
  const result = spawnSync(process.execPath, [cli, ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) throw new Error(`exit ${result.status}: ${result.stderr.toString().trim()}`);
}

function gitCommit(): string {
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO }).toString().trim() ? ' (modified)' : '';
    return head + dirty;
  } catch {
    return 'unknown';
  }
}

function environment(options: Options, work: string): void {
  const cpu = cpus();
  console.log('Rowbly Plugin benchmark (PERF-07)');
  console.log(`  date           ${new Date().toISOString()}`);
  console.log(`  commit         ${gitCommit()}`);
  console.log(`  node           ${process.version} (V8 ${process.versions.v8})`);
  console.log(`  os             ${platform()} ${release()} ${arch()}`);
  console.log(`  cpu            ${cpu[0]?.model ?? 'unknown'} × ${cpu.length}`);
  console.log(`  memory         ${(totalmem() / 2 ** 30).toFixed(1)} GiB`);
  console.log(
    `  load average   ${loadavg()
      .map((n) => n.toFixed(2))
      .join(' ')} (1, 5, 15 min)`,
  );
  console.log(`  fixtures       ${work}`);
  console.log(`  sizes          ${options.sizes.join(', ')} Stories; ${options.samples} samples each`);
  console.log(
    '  cache state    OS page cache warm: each fixture was just written and is not flushed. In-process ' +
      'samples use fresh services (empty repository caches) in one warm Node process; CLI samples are ' +
      'fresh Node processes.',
  );
}

async function benchSize(stories: number, options: Options, work: string, cli: string | null): Promise<void> {
  const dir = join(work, String(stories));
  const on: DataRoot = { path: join(dir, 'on'), kind: 'local' };
  const off: DataRoot = { path: join(dir, 'off'), kind: 'local' };
  await generateFixture(on.path, { stories });
  await generateFixture(off.path, { stories, plugins: false });
  // Doctor first: an invalid fixture would time error paths, not the workloads.
  for (const root of [on, off]) await doctorClean((await open(root)).services);

  console.log(`\n${stories} Stories, 1 Board, 50 Epics, 21 Board Specs, ${FIXTURE_PLUGINS.join('/')} data`);
  const n = options.samples;
  const fresh = (root: DataRoot) => () => open(root);

  if (cli) {
    await measure(
      'CLI startup: --version',
      n,
      () => runCli(cli, ['--version']),
      () => undefined,
      'fresh process',
    );
    for (const [mode, root] of [
      ['off', off],
      ['on', on],
    ] as const) {
      await measure(
        `CLI stories list --json (Plugins ${mode})`,
        n,
        () => runCli(cli, ['--root', root.path, 'stories', 'list', '--json']),
        () => undefined,
      );
    }
    await measure(
      'CLI doctor --json (Plugins on)',
      n,
      () => runCli(cli, ['--root', on.path, 'doctor', '--json']),
      () => undefined,
    );
  }

  await measure(
    'activation: loadPlugins (Plugins off)',
    n,
    () => loadPlugins({ root: off, registry: builtInPlugins, reserved: reservedNames() }).then(() => undefined),
    () => undefined,
  );
  await measure(
    'activation: loadPlugins (Plugins on)',
    n,
    async () => {
      const host = await loadPlugins({ root: on, registry: builtInPlugins, reserved: reservedNames() });
      if (host.failures().length) throw new Error(`${host.failures()[0]?.id} failed to load`);
    },
    () => undefined,
  );

  const texts = await Promise.all(
    Array.from({ length: stories }, (_, i) =>
      readFile(join(on.path, `boards/web/stories/WEB-${i + 1}/story.json`), 'utf8'),
    ),
  );
  const { services: parser } = await open(on);
  // Each Built-in Plugin's Story bag, read through its own context as its code reads it.
  const bags = builtInPlugins.flatMap((p) =>
    p.bags?.story ? [[parser.plugins.context(p.id), p.bags.story] as const] : [],
  );
  await measure(
    'parsing: Story schema + Plugin bags',
    n,
    () => {
      for (const text of texts) {
        const story = StorySchema.parse(JSON.parse(text));
        for (const [context, schema] of bags) context.readBag(story, schema);
      }
    },
    () => undefined,
    'JSON.parse included; no file reads',
  );

  let edit = 0;
  for (const [mode, root] of [
    ['no hooks: Plugins off', off],
    ['with hooks: Plugins on', on],
  ] as const) {
    await measure(
      `pipeline: stories.update, ${mode}`,
      n,
      async ({ services }) => {
        await services.stories.update('WEB-1', { name: `Edited ${++edit}` });
      },
      fresh(root),
      'successive edits of WEB-1 on the same root',
    );
  }

  await measure(
    'Epic summaries: listEpicSummaries(open)',
    n,
    async ({ services }) => {
      await listEpicSummaries(services.plugins.context('epics'), 'open');
    },
    fresh(on),
  );

  for (const [mode, root] of [
    ['off', off],
    ['on', on],
  ] as const) {
    await measure(`doctor (Plugins ${mode})`, n, ({ services }) => doctorClean(services), fresh(root));
  }

  let copy = 0;
  await measure(
    `bulk write: delete Spec common, unlink ${stories}`,
    n,
    async ({ services }) => {
      const unlinked = await deleteSpec(services.plugins.context('specs'), { board: 'web', slug: 'common' });
      if (unlinked !== stories) throw new Error(`unlinked ${unlinked} Stories, expected ${stories}`);
    },
    async () => {
      const path = join(dir, `write-${++copy}`);
      await cp(on.path, path, { recursive: true });
      return open({ path, kind: 'local' });
    },
    'fresh fixture copy per sample',
  );
  await rm(dir, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const work = await mkdtemp(join(tmpdir(), 'rowbly-bench-'));
  const built = options.cli ? await buildCli() : null;
  try {
    environment(options, work);
    for (const size of options.sizes) await benchSize(size, options, work, built?.cli ?? null);
  } finally {
    await rm(work, { recursive: true, force: true });
    await built?.remove();
  }
  console.log(
    `\n  load average   ${loadavg()
      .map((n) => n.toFixed(2))
      .join(' ')} (at the end)`,
  );
  if (invalidSamples) {
    console.log(`${invalidSamples} invalid samples: these timings are not comparable.`);
    process.exitCode = 1;
  }
}

await main();
