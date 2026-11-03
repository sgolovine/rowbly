#!/usr/bin/env node
// Start a factory worker thread on a T3 server through its CLI, on this computer or over SSH, and
// verify the thread it started. See ../references/remote-launch.md.
//
//   node launch-worker.mjs launch --key <KEY> --title <title> --brief <file> --model-selection <json>
//       --project <dir> [--ssh <host>] [--t3 <path>] [--launcher-title <title>]
//       [--launcher-provider <id> --launcher-model <slug>] [--brief-dir <dir>] [--receipt-dir <dir>]
//       [--min-free-gb <n>] [--timeout <seconds>]
//   node launch-worker.mjs send --thread <threadId> --title <title> --message <file> --project <dir>
//       [--ssh <host>] [--t3 <path>] [--timeout <seconds>]
//
// Prints one JSON line. Exit 0: launched, existing or sent. Exit 1: nothing was started or sent; fix
// the reason and run it again. Exit 2: conflict, unknown or unverified; look before running it again.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAUNCHER_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'launcher.md');
const EXIT = { launched: 0, existing: 0, sent: 0, error: 1, failed: 1, conflict: 2, unknown: 2, unverified: 2 };
const IDLE = new Set(['completed', 'interrupted', 'cancelled', 'failed']);
const POLL_MS = 3000;

class Result {
  constructor(status, fields) {
    this.status = status;
    this.fields = fields;
  }
}

const stop = (status, fields) => {
  throw new Result(status, fields);
};

const { command, flags } = parseArgs(process.argv.slice(2));
const deadline = Date.now() + Number(flags.timeout ?? 600) * 1000;
const launcherTitle = flags['launcher-title'] ?? 'Launcher: workers';
let home;
let project;
let t3Bin;
let receiptPath;
// Set once a request that can start a thread has been sent: from then on, an error is `unknown`.
let requested = false;

main();

async function main() {
  let result;
  try {
    if (flags.project) project = await absolute(flags.project);
    t3Bin = await absolute(flags.t3 ?? 't3');
    if (command === 'launch') result = await launch();
    else if (command === 'send') result = await send();
    else stop('error', { reason: 'usage: launch-worker.mjs launch|send --flag value …' });
  } catch (error) {
    result =
      error instanceof Result
        ? error
        : new Result(requested ? 'unknown' : 'failed', { reason: error.message.trim().split('\n')[0] });
  }
  const { status, fields } = result;
  const receipt = receiptPath && { receipt: receiptPath };
  console.log(JSON.stringify({ ok: EXIT[status] === 0, status, host: flags.ssh ?? 'local', ...fields, ...receipt }));
  process.exitCode = EXIT[status];
}

async function launch() {
  const [key, title] = required('key', 'title', 'brief', 'model-selection', 'project');
  const brief = readFileSync(flags.brief, 'utf8');
  const modelSelection = parseSelection(flags['model-selection']);
  const expected = { key, title, modelSelection, brief, briefSha256: sha256(brief) };
  const receipt = loadReceipt(expected);
  // An earlier run may have asked a launcher already; from here on, an error is `unknown`.
  if (receipt.data) requested = true;
  if (receipt.data?.threadId) return settle(receipt, [receipt.data.threadId], expected, 'existing');

  const launcherId = await launcher();
  if (!(await waitIdle(launcherId))) {
    stop(requested ? 'unknown' : 'failed', { key, title, launcherId, reason: 'launcher busy until timeout' });
  }
  // The thread list hides archived threads, so also take the threads that earlier requests for this
  // title were answered with, and check them with `show`.
  const launcherIds = [...new Set([...(receipt.data?.launcherIds ?? []), launcherId])];
  const earlier = await earlierLaunches(title, launcherIds);
  const known = union(await titledIds(title), earlier.threadIds);
  if (known.length) return settle(receipt, known, expected, 'existing');
  if (earlier.unanswered) {
    stop('unknown', { key, title, launcherId, reason: 'an earlier request for this title has no answer' });
  }

  if (flags['min-free-gb']) await checkMemory(Number(flags['min-free-gb']));

  const dir = await absolute(flags['brief-dir'] ?? '~/.rowbly-factory/briefs');
  const briefPath = `${dir}/${key}-${expected.briefSha256.slice(0, 12)}.md`;
  const copied = await sh(`mkdir -p ${q(dir)} && cat > ${q(briefPath)} && cat ${q(briefPath)}`, brief);
  if (copied.code !== 0 || copied.stdout !== brief) stop('failed', { key, title, reason: 'brief copy did not match' });

  // Record the request before sending it, so a crash after this point cannot lead to a second launch.
  receipt.save({ launcherIds });
  requested = true;
  const reply = await ask(launcherId, 'LAUNCH', {
    title,
    brief: briefPath,
    sha256: expected.briefSha256,
    modelSelection: JSON.stringify(modelSelection),
  });

  // Check what the launcher did on our own; its answer may be missing, late or wrong.
  const found = union(await titledIds(title), answeredIds(reply));
  if (!found.length) {
    const fields = { key, title, launcherId, briefPath };
    if (reply?.marker === 'LAUNCH-FAILED') stop('failed', { ...fields, reason: `launcher: ${reply.value}` });
    if (reply?.marker === 'NOT-SENT') stop('failed', { ...fields, reason: 'request did not reach the launcher' });
    stop('unknown', {
      ...fields,
      reason: reply
        ? `launcher said ${reply.marker} but no thread has the title`
        : 'no answer from the launcher before the timeout',
    });
  }
  return settle(
    receipt,
    found,
    { ...expected, briefPath },
    reply?.marker === 'LAUNCH-EXISTS' ? 'existing' : 'launched',
    reply,
  );
}

// Verify the one thread for this request: identity from the CLI, options from the launcher.
async function settle(receipt, threadIds, expected, status, reply) {
  const { key, title, modelSelection, brief, briefSha256, briefPath } = expected;
  const base = { key, title, briefSha256, ...(briefPath && { briefPath }) };
  if (threadIds.length > 1) stop('conflict', { ...base, threadIds, reason: 'several threads for this request' });
  const [threadId] = threadIds;
  receipt.save({ threadId });
  const { thread, messages } = await show(threadId, 100000);
  if (thread.archived) {
    stop('conflict', {
      ...base,
      threadId,
      reason: 'the thread for this request is archived; a new launch needs a new title',
    });
  }
  const mismatches = [];
  if (thread.title !== title) mismatches.push(`title ${thread.title}`);
  if (thread.providerInstanceId !== modelSelection.instanceId) mismatches.push(`provider ${thread.providerInstanceId}`);
  if (thread.model !== modelSelection.model) mismatches.push(`model ${thread.model}`);
  if (thread.runtimeMode !== 'full-access') mismatches.push(`runtimeMode ${thread.runtimeMode}`);
  if (thread.worktreePath || thread.branch) mismatches.push(`workspace ${thread.worktreePath ?? thread.branch}`);
  const first = messages.find((m) => m.role === 'user');
  if (!first || !sameText(first.text, brief)) mismatches.push('first message is not the brief');
  if (mismatches.length) stop('conflict', { ...base, threadId, reason: `mismatch: ${mismatches.join(', ')}` });

  const identity = { ...base, threadId, provider: thread.providerInstanceId, model: thread.model };
  const launcherId = await launcher();
  const config = await ask(launcherId, 'CONFIG', { thread: threadId });
  if (config?.marker !== 'CONFIG') {
    stop('unverified', { ...identity, launcherId, reason: `options not verified: ${config?.value ?? 'no answer'}` });
  }
  let actual;
  try {
    actual = JSON.parse(config.value);
  } catch {
    stop('unverified', { ...identity, launcherId, reason: 'options not verified: launcher answer is not JSON' });
  }
  const options = actual?.modelSelection?.options === undefined ? [] : actual?.modelSelection?.options;
  if (
    typeof actual?.threadId !== 'string' ||
    typeof actual?.modelSelection?.instanceId !== 'string' ||
    typeof actual?.modelSelection?.model !== 'string' ||
    typeof actual?.runtimeMode !== 'string' ||
    !validOptions(options)
  ) {
    stop('unverified', { ...identity, launcherId, reason: 'options not verified: malformed configuration' });
  }
  const differences = [
    actual.threadId !== threadId && `threadId ${actual.threadId}`,
    actual.modelSelection?.instanceId !== modelSelection.instanceId && `provider ${actual.modelSelection?.instanceId}`,
    actual.modelSelection?.model !== modelSelection.model && `model ${actual.modelSelection?.model}`,
    actual.runtimeMode !== 'full-access' && `runtimeMode ${actual.runtimeMode}`,
    !uniqueOptions(options) && 'duplicate option ids',
    (options.length !== (modelSelection.options ?? []).length ||
      !(modelSelection.options ?? []).every((o) => options.some((a) => a.id === o.id && a.value === o.value))) &&
      `options differ: expected ${JSON.stringify(modelSelection.options ?? [])}, actual ${JSON.stringify(options)}`,
  ].filter(Boolean);
  if (differences.length) {
    stop('conflict', { ...identity, options, launcherId, reason: `configuration mismatch: ${differences.join(', ')}` });
  }
  return new Result(status, {
    ...identity,
    options,
    runtimeMode: actual.runtimeMode,
    workspace: 'root',
    threadStatus: thread.status,
    launcherId,
    ...(reply && reply.marker !== 'LAUNCHED' && { note: `launcher said ${reply.marker} ${reply.value}` }),
  });
}

// The receipt for one request, on the computer that runs this script: the request's identity, the
// launchers it was sent to and, once known, its thread. A title stays bound to its first request.
function loadReceipt({ key, title, modelSelection, briefSha256 }) {
  const identity = { host: flags.ssh ?? 'local', project, title };
  const request = { key, briefSha256, modelSelection };
  const dir = flags['receipt-dir'] ?? join(homedir(), '.rowbly-factory', 'receipts');
  receiptPath = join(dir, `${sha256(JSON.stringify(identity)).slice(0, 32)}.json`);
  let data = null;
  try {
    data = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') stop('unknown', { key, title, reason: `receipt unreadable: ${error.message}` });
  }
  if (data && JSON.stringify(data.request) !== JSON.stringify(request)) {
    stop('conflict', { key, title, reason: 'this title was used for another brief or model; use a new title' });
  }
  return {
    data,
    save(fields) {
      this.data = { ...identity, request, ...this.data, ...fields, updatedAt: new Date().toISOString() };
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${receiptPath}.tmp`, `${JSON.stringify(this.data, null, 2)}\n`);
      renameSync(`${receiptPath}.tmp`, receiptPath);
    },
  };
}

// Every LAUNCH request for the title in these launchers' messages, with the threads they answered.
async function earlierLaunches(title, launcherIds) {
  const threadIds = [];
  let unanswered = false;
  for (const launcherId of launcherIds) {
    const { messages } = await show(launcherId, 100000);
    messages.forEach((m, i) => {
      if (m.role !== 'user' || !m.text.startsWith('LAUNCH\n')) return;
      if (!m.text.split('\n').includes(`title: ${title}`)) return;
      const reply = findAnswer(messages.slice(i + 1), m.text.match(/^id: (\S+)$/m)?.[1]);
      if (answeredIds(reply).length) threadIds.push(...answeredIds(reply));
      else if (reply?.marker !== 'LAUNCH-FAILED') unanswered = true;
    });
  }
  return { threadIds, unanswered };
}

function answeredIds(reply) {
  return reply?.marker === 'LAUNCHED' || reply?.marker === 'LAUNCH-EXISTS' ? reply.value.split(/\s+/) : [];
}

function union(...lists) {
  return [...new Set(lists.flat())];
}

// Send a follow-up message, such as the full brief and GO to a parked worker, at most once.
async function send() {
  const [threadId, title] = required('thread', 'title', 'message', 'project');
  const message = readFileSync(flags.message, 'utf8');
  const messageSha256 = sha256(message);
  const base = { threadId, title, messageSha256 };
  const delivered = async () =>
    (await show(threadId, 100000)).messages.some((m) => m.role === 'user' && sameText(m.text, message));

  const { thread } = await show(threadId, 1);
  if (thread.title !== title || thread.archived) {
    stop('conflict', { ...base, reason: `thread is ${thread.archived ? 'archived' : `titled ${thread.title}`}` });
  }
  if (await delivered()) return new Result('existing', base);
  requested = true;
  await t3(['thread', 'send', threadId, '-'], message);
  while (Date.now() < deadline) {
    if (await delivered()) return new Result('sent', base);
    await sleep(POLL_MS);
  }
  stop('unknown', { ...base, reason: 'message not seen in the thread before the timeout' });
}

// The launcher thread: the newest with the launcher title, else a new one from assets/launcher.md.
async function launcher() {
  const newest = async () =>
    (await threadsTitled(launcherTitle)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const current = await newest();
  if (current) return current.threadId;
  const provider = flags['launcher-provider'];
  const model = flags['launcher-model'];
  if (!provider || !model)
    stop('failed', { reason: 'no launcher thread; pass --launcher-provider and --launcher-model' });
  const args = [
    'thread',
    'start',
    '--wait',
    '--title',
    launcherTitle,
    '--provider',
    provider,
    '--model',
    model,
    '.',
    '-',
  ];
  await t3(args, readFileSync(LAUNCHER_FILE, 'utf8'));
  const started = await newest();
  if (!started) stop('failed', { reason: 'launcher thread did not start' });
  return started.threadId;
}

// Send one request to the launcher and wait for the line that answers it, found by its id. Allow a
// minute even after the timeout, so a launch that timed out can still be verified.
async function ask(launcherId, kind, fields) {
  const id = randomBytes(6).toString('hex');
  const body = [kind, `id: ${id}`, ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`)].join('\n');
  const sent = await sh(t3Command(['thread', 'send', launcherId, '-']), body);
  const until = Math.max(deadline, Date.now() + 60000);
  while (Date.now() < until) {
    const { thread, messages } = await show(launcherId, 20);
    const asked = messages.findIndex((m) => m.role === 'user' && m.text.includes(`id: ${id}`));
    const answer = findAnswer(messages.slice(asked + 1), id);
    if (answer) return answer;
    if (asked < 0 && sent.code !== 0) return { marker: 'NOT-SENT', value: sent.stderr.trim() };
    const repliedAfter = asked >= 0 && messages.slice(asked + 1).some((m) => m.role === 'assistant');
    if (repliedAfter && IDLE.has(thread.status))
      return { marker: 'NO-ANSWER', value: 'launcher ended its turn without one' };
    await sleep(POLL_MS);
  }
  return null;
}

function findAnswer(messages, id) {
  const answer = new RegExp(`^(LAUNCHED|LAUNCH-EXISTS|LAUNCH-FAILED|CONFIG|CONFIG-FAILED) ${id}(?: (.*))?$`, 'm');
  for (const m of messages) {
    const match = id && m.role === 'assistant' && m.text.match(answer);
    if (match) return { marker: match[1], value: (match[2] ?? '').trim() };
  }
  return null;
}

async function waitIdle(threadId) {
  while (Date.now() < deadline) {
    if (IDLE.has((await show(threadId, 1)).thread.status)) return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function checkMemory(minGb) {
  const { stdout } = await must(`awk '/^MemAvailable:/ {print $2}' /proc/meminfo`);
  const gb = Number(stdout) / 1024 / 1024;
  if (!(gb >= minGb)) stop('failed', { reason: `only ${gb.toFixed(1)} GB of memory available, need ${minGb}` });
}

async function titledIds(title) {
  return (await threadsTitled(title)).map((t) => t.threadId);
}

async function threadsTitled(title) {
  const threads = JSON.parse((await t3(['thread', 'list', '--json'])).stdout);
  return threads.filter((t) => t.title === title && t.archived !== true);
}

async function show(threadId, messages) {
  return JSON.parse((await t3(['thread', 'show', '--json', '--messages', String(messages), threadId])).stdout);
}

async function t3(args, input) {
  return must(t3Command(args), input);
}

function t3Command(args) {
  return `cd ${q(project)} && ${q(t3Bin)} ${args.map(q).join(' ')}`;
}

async function must(command, input) {
  const result = await sh(command, input);
  if (result.code !== 0) throw new Error(result.stderr || `exit ${result.code}: ${command}`);
  return result;
}

// Run a shell command on the T3 computer: over SSH with --ssh, else here.
function sh(command, input = '') {
  const [bin, args] = flags.ssh ? ['ssh', ['-o', 'BatchMode=yes', flags.ssh, command]] : ['sh', ['-c', command]];
  return new Promise((resolve) => {
    const child = spawn(bin, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), Math.max(deadline - Date.now(), 60000));
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: error.message }));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// `~` in a flag means the T3 computer's home folder, which may not be ours.
async function absolute(path) {
  if (path !== '~' && !path.startsWith('~/')) return path;
  home ??= (await must(`printf '%s' "$HOME"`)).stdout;
  return home + path.slice(1);
}

function required(...names) {
  const missing = names.filter((n) => !flags[n]);
  if (missing.length) stop('error', { reason: `missing ${missing.map((n) => `--${n}`).join(', ')}` });
  return names.map((n) => flags[n]);
}

function parseSelection(text) {
  let selection;
  try {
    selection = JSON.parse(text);
  } catch {
    stop('error', { reason: '--model-selection is not JSON' });
  }
  if (
    typeof selection?.instanceId !== 'string' ||
    !selection.instanceId.trim() ||
    typeof selection.model !== 'string' ||
    !selection.model.trim()
  ) {
    stop('error', { reason: '--model-selection needs instanceId and model' });
  }
  if (
    !validOptions(selection.options === undefined ? [] : selection.options) ||
    !uniqueOptions(selection.options ?? [])
  ) {
    stop('error', { reason: '--model-selection options need unique ids and string, finite number or boolean values' });
  }
  return selection;
}

function validOptions(options) {
  return (
    Array.isArray(options) &&
    options.every(
      (option) =>
        typeof option?.id === 'string' &&
        option.id.trim() &&
        (typeof option.value === 'string' ||
          typeof option.value === 'boolean' ||
          (typeof option.value === 'number' && Number.isFinite(option.value))),
    )
  );
}

function uniqueOptions(options) {
  return new Set(options.map((option) => option.id)).size === options.length;
}

function parseArgs(argv) {
  const [name, ...rest] = argv;
  const parsed = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) {
      console.log(JSON.stringify({ ok: false, status: 'error', reason: `bad argument ${rest[i]}` }));
      process.exit(1);
    }
    parsed[rest[i].slice(2)] = rest[i + 1];
  }
  return { command: name, flags: parsed };
}

// The hash `sha256sum` gives for the file, so the launcher can check its copy.
function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// Message text as T3 stores it may differ in line endings and trailing space only.
function sameText(a, b) {
  const normal = (text) => text.replace(/\r\n/g, '\n').trimEnd();
  return normal(a) === normal(b);
}

function q(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
