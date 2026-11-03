#!/usr/bin/env node
// Readiness fingerprint method 2. Self-contained; Node >=22; no shell, jq or sha256sum.
// node readiness-fingerprint.mjs KEY DATA_ROOT [-- COMMAND ARG...]
// A complete result has exactly METHOD_INPUTS and full SHA-256 values. Any failure prints only
// gap=<input>: <reason>, exits 1, and never emits an overall. Exit 2 means invalid usage.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METHOD = '2';
const METHOD_INPUTS = [
  'helper',
  'repository',
  'plugins',
  'configuration',
  'story',
  'comments',
  'specs',
  'tasks',
  'links',
  'epic',
  'attachments',
  'assignees',
  'prompt',
  'guide',
];
const KNOWN = [
  'assignees',
  'tasks',
  'epics',
  'specs',
  'comments',
  'attachments',
  'story-linking',
  'git',
  'software-factory',
];
const [rawKey, rawRoot, ...tail] = process.argv.slice(2);
if (
  !/^[A-Za-z][A-Za-z0-9]*-[0-9]+$/.test(rawKey ?? '') ||
  !rawRoot ||
  (tail.length && (tail[0] !== '--' || tail.length < 2))
) {
  console.error('usage: node readiness-fingerprint.mjs KEY DATA_ROOT [-- COMMAND ARG...]');
  process.exit(2);
}
const key = rawKey.toUpperCase();
const root = resolve(rawRoot);
const command = tail.length ? tail.slice(1) : ['rowbly'];
let input = 'setup';
let previousComments = [];

/** Fail without producing any partial fingerprint. */
function requireValue(condition, reason) {
  if (!condition) throw new Error(reason);
}
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const textFields = (v, fields) => object(v) && fields.every((field) => typeof v[field] === 'string');
const commentOrder = (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Sort object keys recursively, keep array order, reject unsupported/nonfinite values. */
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    requireValue(Number.isFinite(value), 'nonfinite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  requireValue(object(value), 'unsupported canonical value');
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(',')}}`;
}
function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Execute a command without a shell; reject timeout, signal, nonzero exit or oversized output. */
function run(program, args) {
  return execFileSync(program, args, {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
/** Exactly one JSON value and a checked result shape; empty/multiple JSON values fail. */
function readCommand(args, shape) {
  const value = JSON.parse(
    run(command[0], [...command.slice(1), ...args, '--data-root', root, '--json', '--no-prompt']),
  );
  requireValue(shape(value), `unexpected JSON from ${args.join(' ')}`);
  canonical(value);
  return value;
}

/** Reject symlinks in all path components, including ancestors of the Data Root. */
function noLinks(path) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    requireValue(!lstatSync(current).isSymbolicLink(), 'symbolic link path is unsafe');
  }
}
/** Read an own regular file through a no-follow descriptor; distinguish absence from all failures. */
function ownFile(path, optional = false) {
  noLinks(dirname(path));
  let before;
  try {
    before = lstatSync(path, { bigint: true });
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  }
  requireValue(before.isFile() && !before.isSymbolicLink(), 'not an own regular non-symlink file');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd, { bigint: true });
    requireValue(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino, 'file changed before read');
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    const named = lstatSync(path, { bigint: true });
    requireValue(
      [after, named].every(
        (v) =>
          v.dev === opened.dev &&
          v.ino === opened.ino &&
          v.size === opened.size &&
          v.mtimeNs === opened.mtimeNs &&
          v.ctimeNs === opened.ctimeNs,
      ),
      'file changed during read',
    );
    return bytes;
  } finally {
    closeSync(fd);
  }
}

/** Read every directory component ourselves; only a genuinely absent optional scope is empty. */
function ownDirectory(path, optional = false) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    let info;
    try {
      info = lstatSync(current);
    } catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    }
    requireValue(info.isDirectory() && !info.isSymbolicLink(), 'not an own non-symlink directory');
  }
  return readdirSync(path).sort();
}
const slug = (value) => typeof value === 'string' && value.length <= 40 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const storyKey = (value) => /^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*$/.test(value);
const identity = (info) => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String);

/** Include file identity in the within-collection check, but never in a stable review hash. */
function fileSnapshot(path) {
  const before = identity(lstatSync(path, { bigint: true }));
  const bytes = ownFile(path);
  requireValue(
    canonical(before) === canonical(identity(lstatSync(path, { bigint: true }))),
    'file changed during collection',
  );
  return { identity: before, sha256: hash(bytes), text: bytes.toString('utf8') };
}

/** A CLI file listing can silently omit unsafe or unrecognized entries. Check the whole scope. */
function specInventory(path) {
  const names = ownDirectory(path, true);
  if (names === null) return null;
  return names.map((name) => {
    requireValue(name.endsWith('.md') && slug(name.slice(0, -3)), 'unrecognized Story Spec entry');
    return { slug: name.slice(0, -3), ...fileSnapshot(join(path, name)) };
  });
}

/** Incoming links can be hidden by Story folders omitted from the CLI's directory listing. */
function storyInventory(path, boardId) {
  const names = ownDirectory(path);
  return names.map((name) => {
    requireValue(storyKey(name), 'unrecognized Story entry');
    ownDirectory(join(path, name));
    const snapshot = fileSnapshot(join(path, name, 'story.json'));
    const record = JSON.parse(snapshot.text);
    requireValue(
      textFields(record, ['key', 'boardId', 'stage']) &&
        record.version === 1 &&
        record.key === name &&
        record.boardId === boardId &&
        (record.plugins === undefined || object(record.plugins)),
      'invalid Story inventory record',
    );
    const bag = record.plugins?.['story-linking'];
    requireValue(
      bag === undefined ||
        (object(bag) &&
          Object.keys(bag).every((k) => k === 'blocks') &&
          strings(bag.blocks) &&
          bag.blocks.every(storyKey)),
      'unknown or malformed incoming Story links',
    );
    return { key: name, ...snapshot };
  });
}

/** Normalize every reviewed Story field identically at the first and final read. */
function reviewedStory(story, on) {
  story = structuredClone(story);
  story.plugins ??= {};
  requireValue(/^[a-z0-9][a-z0-9-]*$/.test(story.boardId), 'unsafe Board id');
  for (const [id, bag] of Object.entries(story.plugins)) {
    requireValue(KNOWN.includes(id) && object(bag), `unknown or malformed Story bag: ${id}`);
    // An off Plugin preserves its bytes, but its private external inputs cannot be reviewed.
    requireValue(on(id), `Plugin ${id} is off with stored Story data; completeness is unknown`);
    const knownKeys = {
      comments: ['comments'],
      tasks: ['nextNumber', 'tasks'],
      epics: ['epic'],
      specs: ['specs'],
      attachments: ['attachments'],
      assignees: ['assignees'],
      'story-linking': ['blocks'],
      'software-factory': ['stageRun'],
      git: [],
    };
    requireValue(
      Object.keys(bag).every((k) => knownKeys[id].includes(k)),
      `unknown ${id} bag fields`,
    );
  }
  const fields = Object.fromEntries(Object.entries(story).filter(([k]) => !['rank', 'updatedAt'].includes(k)));
  fields.plugins = structuredClone(story.plugins);
  const thread = fields.plugins.comments;
  if (thread) {
    requireValue(
      Object.keys(thread).every((k) => k === 'comments') &&
        Array.isArray(thread.comments) &&
        thread.comments.every((c) => textFields(c, ['id', 'body', 'createdAt', 'updatedAt'])),
      'unknown or malformed Comments bag',
    );
    thread.comments = thread.comments.filter((c) => !c.body.startsWith('Readiness review ')).sort(commentOrder);
    if (!thread.comments.length) delete fields.plugins.comments;
  }
  const factory = fields.plugins['software-factory'];
  if (factory) {
    if (factory.stageRun !== undefined)
      requireValue(
        textFields(factory.stageRun, ['stage', 'status', 'worker', 'startedAt']) &&
          ['running', 'finished', 'failed'].includes(factory.stageRun.status) &&
          Number.isInteger(factory.stageRun.attempt) &&
          factory.stageRun.attempt > 0,
        'malformed Stage Run',
      );
    delete fields.plugins['software-factory'];
  }
  return fields;
}

/** One complete collection; all parts stay buffered until every input succeeds. */
function collect() {
  const result = { method: METHOD };
  const rechecks = [];
  const commandRechecks = [];
  let recheckStory;
  function watch(name, read) {
    const before = read();
    rechecks.push(() => {
      input = name;
      requireValue(canonical(read()) === canonical(before), 'input changed during collection');
    });
    return before;
  }
  function part(name, read, stable = false) {
    input = name;
    result[name] = hash(canonical(stable ? watch(name, read) : read()));
  }
  // Recheck command results at their original read boundary, not at a later inventory snapshot.
  function rb(args, shape, normalize = (value) => value) {
    const name = input;
    const value = readCommand(args, shape);
    const before = canonical(normalize(value));
    const recheck = () => {
      input = name;
      requireValue(canonical(normalize(readCommand(args, shape))) === before, 'input changed during collection');
    };
    if (args[0] === 'stories' && args[2] === key) recheckStory = recheck;
    else commandRechecks.push(recheck);
    return value;
  }
  noLinks(root);
  requireValue(lstatSync(root).isDirectory(), 'Data Root is not a directory');
  part('helper', () => hash(ownFile(fileURLToPath(import.meta.url))), true);
  // Cover the repository read by the worker without churn from supervisor-owned .rowbly commits.
  part(
    'repository',
    () => {
      requireValue(
        run('git', ['status', '--porcelain', '--untracked-files=normal', '--', '.', ':!.rowbly']).trim() === '',
        'repository has uncommitted review inputs',
      );
      requireValue(run('git', ['rev-parse', '--show-prefix']).trim() === '', 'run from repository root');
      const tree = run('git', ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']);
      requireValue(tree.endsWith('\0') && tree.length > 1, 'empty or truncated repository tree');
      return tree.split('\0').filter((row) => {
        if (!row) return false;
        requireValue(/^[0-7]{6} (blob|tree|commit) [a-f0-9]{40,64}\t[^\0]+$/.test(row), 'malformed repository tree');
        const path = row.slice(row.indexOf('\t') + 1);
        return row && path !== '.rowbly' && !path.startsWith('.rowbly/');
      });
    },
    true,
  );
  input = 'plugins';
  const plugins = rb(
    ['plugins', 'list'],
    (v) =>
      Array.isArray(v) &&
      v.length > 0 &&
      v.every((p) => textFields(p, ['id']) && typeof p.enabled === 'boolean' && typeof p.loaded === 'boolean'),
  );
  requireValue(new Set(plugins.map((p) => p.id)).size === plugins.length, 'duplicate Plugin entries');
  requireValue(
    KNOWN.every((id) => plugins.some((p) => p.id === id)),
    'missing known Plugin entry',
  );
  requireValue(
    plugins.every((p) => KNOWN.includes(p.id) && p.enabled === p.loaded),
    'unknown or enabled unloaded Plugin',
  );
  const on = (id) => plugins.find((p) => p.id === id).enabled;
  requireValue(on('comments') && on('software-factory'), 'Comments and Software Factory must be on');
  part('plugins', () =>
    plugins.map(({ id, enabled, loaded }) => ({ id, enabled, loaded })).sort((a, b) => a.id.localeCompare(b.id)),
  );
  input = 'story';
  const story = rb(
    ['stories', 'show', key],
    (v) =>
      textFields(v, ['key', 'boardId', 'stage', 'name', 'description']) &&
      v.version === 1 &&
      v.key === key &&
      (v.plugins === undefined || object(v.plugins)),
    (value) => reviewedStory(value, on),
  );
  const fields = reviewedStory(story, on);
  // Keep every other Story field and every known bag field in the Story hash.
  part('story', () => fields);
  part('comments', () => {
    const comments = rb(
      ['comments', 'list', key],
      (v) => Array.isArray(v) && v.every((c) => textFields(c, ['id', 'body', 'createdAt', 'updatedAt'])),
      (values) => values.filter((c) => !c.body.startsWith('Readiness review ')).sort(commentOrder),
    );
    requireValue(
      canonical([...comments].sort(commentOrder)) ===
        canonical([...(story.plugins?.comments?.comments ?? [])].sort(commentOrder)),
      'Comments changed between reads',
    );
    requireValue(new Set(comments.map((c) => c.id)).size === comments.length, 'duplicate Comment ids');
    previousComments = [...comments].sort(commentOrder);
    return comments.filter((c) => !c.body.startsWith('Readiness review ')).sort(commentOrder);
  });
  input = 'configuration';
  const config = rb(
    ['config', 'show', '--board', story.boardId],
    (v) =>
      object(v) &&
      object(v.board) &&
      v.board.id === story.boardId &&
      Array.isArray(v.stages) &&
      v.stages.every(
        (s) => textFields(s, ['key', 'name', 'category']) && ['backlog', 'board', 'done'].includes(s.category),
      ) &&
      Array.isArray(v.customFields),
  );
  requireValue(
    new Set(config.stages.map((s) => s.key)).size === config.stages.length &&
      config.stages.some((s) => s.key === story.stage),
    'unknown or duplicate Story Stage',
  );
  part('configuration', () => config);
  part('specs', () => {
    const storyPath = join(root, 'boards', story.boardId, 'stories', key, 'plugins', 'specs');
    const inventory = watch('specs', () => specInventory(storyPath));
    if (!on('specs')) {
      requireValue(!inventory?.length, 'Specs is off with stored Story Specs; completeness is unknown');
      return 'off';
    }
    const storySpecs = rb(
      ['specs', 'list', '--story', key],
      (v) => Array.isArray(v) && v.every((s) => textFields(s, ['slug', 'title', 'text'])),
    );
    requireValue(
      canonical(storySpecs.map(({ slug, text }) => ({ slug, text })).sort((a, b) => a.slug.localeCompare(b.slug))) ===
        canonical(
          (inventory ?? []).map(({ slug, text }) => ({ slug, text })).sort((a, b) => a.slug.localeCompare(b.slug)),
        ),
      'Story Spec listing omits or differs from stored inputs',
    );
    const slugs = story.plugins?.specs === undefined ? [] : story.plugins.specs.specs;
    requireValue(strings(slugs) && slugs.every(slug), 'invalid Board Spec links');
    const boardSpecs = [...new Set(slugs)].sort().map((slug) => {
      const stored = watch('specs', () =>
        fileSnapshot(join(root, 'boards', story.boardId, 'plugins', 'specs', `${slug}.md`)),
      );
      const spec = rb(
        ['specs', 'show', slug, '--board', story.boardId],
        (v) => textFields(v, ['slug', 'title', 'text']) && v.slug === slug,
      );
      requireValue(spec.text === stored.text, 'Board Spec differs from stored input');
      return { ...spec, sha256: stored.sha256 };
    });
    return { storySpecs, boardSpecs, files: (inventory ?? []).map(({ slug, sha256 }) => ({ slug, sha256 })) };
  });
  part('tasks', () =>
    !on('tasks')
      ? 'off'
      : rb(
          ['tasks', 'list', key],
          (v) => Array.isArray(v) && v.every((t) => textFields(t, ['id', 'name', 'description', 'stage'])),
        ),
  );
  part('links', () => {
    if (!on('story-linking')) return 'off';
    const candidates = watch('links', () =>
      storyInventory(join(root, 'boards', story.boardId, 'stories'), story.boardId),
    );
    const records = candidates.map(({ text }) => JSON.parse(text));
    const expected = records.flatMap((record) =>
      (record.plugins?.['story-linking']?.blocks ?? []).flatMap((blocked) =>
        record.key === key
          ? [{ relation: 'blocks', key: blocked }]
          : blocked === key
            ? [{ relation: 'blocked-by', key: record.key }]
            : [],
      ),
    );
    const links = rb(
      ['story-linking', 'list', key],
      (v) =>
        Array.isArray(v) &&
        v.every(
          (l) =>
            textFields(l, ['key']) && ['blocks', 'blocked-by'].includes(l.relation) && typeof l.available === 'boolean',
        ),
    );
    const relationships = (values) => [...new Set(values.map((v) => `${v.relation}:${v.key}`))].sort();
    requireValue(
      canonical(relationships(links)) === canonical(relationships(expected)),
      'Story link listing omits or differs from stored inputs',
    );
    return links.map((link) => {
      requireValue(link.available, `linked Story ${link.key} is unavailable`);
      if (link.relation !== 'blocked-by') return link;
      const blocker = rb(
        ['stories', 'show', link.key],
        (v) => textFields(v, ['key', 'boardId', 'stage']) && v.key === link.key && v.boardId === story.boardId,
      );
      const stored = records.find((r) => r.key === blocker.key);
      requireValue(stored && stored.stage === blocker.stage, 'blocker changed between reads');
      const stage = config.stages.find((s) => s.key === blocker.stage);
      requireValue(stage, `blocker ${link.key} has unknown Stage`);
      return { ...link, blockerStage: blocker.stage, blockerCategory: stage.category };
    });
  });
  part('epic', () => {
    if (!on('epics')) return 'off';
    const id = story.plugins?.epics?.epic;
    if (id === undefined && story.plugins?.epics === undefined) return 'none';
    requireValue(typeof id === 'string' && id.length > 0, 'invalid Epic id');
    const epic = rb(
      ['epics', 'show', id],
      (v) => textFields(v, ['id', 'name', 'description']) && v.id === id && typeof v.closed === 'boolean',
    );
    return { id: epic.id, name: epic.name, description: epic.description, closed: epic.closed };
  });
  part('attachments', () => {
    if (!on('attachments')) return 'off';
    const attachments = rb(
      ['attachments', 'list', key],
      (v) =>
        Array.isArray(v) &&
        v.every(
          (a) =>
            textFields(a, ['id', 'name', 'type']) &&
            /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(a.id) &&
            a.type === 'image/png' &&
            Number.isInteger(a.size),
        ),
    );
    return attachments.map((a) => {
      const content = watch('attachments', () => {
        const bytes = ownFile(
          join(root, 'boards', story.boardId, 'stories', key, 'plugins', 'attachments', `${a.id}.png`),
        );
        requireValue(bytes.length === a.size, `Attachment ${a.id} size mismatch`);
        return hash(bytes);
      });
      return { ...a, content };
    });
  });
  part('assignees', () =>
    !on('assignees')
      ? 'off'
      : rb(['assignees', 'list'], (v) => Array.isArray(v) && v.every((a) => textFields(a, ['handle', 'name']))),
  );
  part(
    'prompt',
    () =>
      rb(
        ['software-factory', 'prompt', 'show', story.stage, '--board', story.boardId],
        (v) => object(v) && object(v.prompt) && typeof v.prompt.text === 'string' && v.prompt.enabled === true,
      ).prompt,
  );
  part(
    'guide',
    () => {
      const bytes = ownFile(join(root, 'ROWBLY.md'), true);
      return bytes === null ? { absent: true } : { sha256: hash(bytes) };
    },
    true,
  );
  requireValue(
    METHOD_INPUTS.every((name) => /^[0-9a-f]{64}$/.test(result[name])) &&
      Object.keys(result).length === METHOD_INPUTS.length + 1,
    'incomplete fingerprint input set',
  );
  // Commands can observe or expose changes before their final result; verify safe files afterwards.
  for (const recheck of [...commandRechecks, ...rechecks]) recheck();
  // Always reconcile with the first normalized Story, even when Story Linking is off.
  recheckStory();
  input = 'overall';
  return { ...result, overall: hash(canonical(result)) };
}
/** Compare only a complete known method-2 record in the newest readiness Comment. */
function comparison(current) {
  const prior = previousComments.filter((c) => c.body.startsWith('Readiness review ')).at(-1);
  if (!prior) return 'unknown';
  const records = [...prior.body.matchAll(/Reviewed input \(method 2\): ([^|]+)(?= \| |$)/g)];
  if (records.length !== 1) return 'unknown';
  const pairs = records[0][1]
    .trim()
    .split(/\s+/)
    .map((word) => word.split('='));
  const expected = ['method', ...METHOD_INPUTS, 'overall'];
  if (
    pairs.length !== expected.length ||
    pairs.some(
      ([k, v, extra]) =>
        extra !== undefined ||
        !expected.includes(k) ||
        (k === 'method' ? v !== METHOD : !/^[0-9a-f]{64}$/.test(v ?? '')),
    ) ||
    new Set(pairs.map(([k]) => k)).size !== expected.length
  )
    return 'unknown';
  const saved = Object.fromEntries(pairs);
  const { overall, ...inputs } = saved;
  if (hash(canonical(inputs)) !== overall) return 'unknown';
  return current.overall === overall ? 'equal' : 'changed';
}
try {
  const fingerprint = collect();
  const compared = comparison(fingerprint);
  process.stdout.write(
    `${Object.entries(fingerprint)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n')}\ncomparison=${compared}\n`,
  );
} catch (error) {
  // Avoid leaking command stdout/stderr; a read failure is a gap, never evidence of empty input.
  const reason =
    error.code ??
    (error.status !== undefined ? `command failed (exit ${error.status})` : error.message) ??
    'read failed';
  process.stdout.write(`gap=${input}: ${String(reason).replace(/[\r\n]/g, ' ')}\n`);
  process.exitCode = 1;
}
