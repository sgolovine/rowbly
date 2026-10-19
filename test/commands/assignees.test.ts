import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/storage';
import { assigned, makeBoard, makeRootConfig, makeRoster, makeStory, runCli, tempRoot } from '../helpers';

const web = { boardId: 'web' };
const ROSTER = [
  { handle: 'alice', name: 'Alice' },
  { handle: 'bob', name: 'Bob' },
];

/** A Data Root with the Assignees Plugin on, Board `web` and, unless `roster` is empty, Alice and Bob. */
async function setup(roster = ROSTER) {
  const t = await tempRoot();
  await makeRootConfig(t.path, { plugins: { assignees: { enabled: true } } });
  await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
  if (roster.length > 0) await makeRoster(t.path, roster);
  const cli = (...args: string[]) => runCli(args, { root: t.path, cwd: t.dir });
  const assignees = async (key: string) =>
    (await createRepositories(t.root).stories.findByKey(key)).plugins?.assignees?.assignees ?? [];
  return { t, cli, assignees };
}

describe('rowbly assignees', () => {
  it('add, assign to a Story, remove: warns "removed from 1 story" and the Story no longer lists the handle', async () => {
    const { t, cli, assignees } = await setup([]);
    expect(await cli('assignees', 'add', 'sam', '--name', 'Sam')).toMatchObject({
      exitCode: 0,
      stdout: 'Added Assignee sam  Sam\n',
    });
    expect(JSON.parse(await readFile(join(t.path, 'plugins/assignees/roster.json'), 'utf8'))).toEqual({
      version: 1,
      assignees: [{ handle: 'sam', name: 'Sam' }],
    });
    await makeStory(t.path, { ...web, key: 'WEB-1', ...assigned('sam') });

    const removed = await cli('assignees', 'remove', 'sam');
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toBe('Removed Assignee sam\n');
    expect(removed.stderr).toBe('warning: Assignee "sam" removed from 1 story\n');
    expect(await assignees('WEB-1')).toEqual([]);
    expect((await createRepositories(t.root).stories.findByKey('WEB-1')).plugins).toBeUndefined();
  });

  it('remove --json reports storiesUpdated and writes the warning as JSON', async () => {
    const { t, cli } = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', ...assigned('bob') });
    await makeStory(t.path, { ...web, key: 'WEB-2', ...assigned('alice', 'bob') });
    const result = await cli('assignees', 'remove', 'bob', '--json');
    expect(JSON.parse(result.stdout)).toEqual({ removed: 'bob', storiesUpdated: 2 });
    expect(JSON.parse(result.stderr)).toEqual({ warning: 'Assignee "bob" removed from 2 stories' });
  });

  it('list, edit and errors', async () => {
    const { cli } = await setup([]);
    expect((await cli('assignees', 'list')).stdout).toContain('No Assignees');
    await cli('assignees', 'add', 'sam', '--name', 'Sam', '--email', 'sam@example.com');
    await cli('whoami', 'sam');

    const list = await cli('assignees', 'list');
    expect(list.stdout).toMatch(/HANDLE\s+NAME\s+EMAIL/);
    expect(list.stdout).toMatch(/\*\s+sam\s+Sam\s+sam@example\.com/);

    const edited = await cli('assignees', 'edit', 'sam', '--name', 'Samantha', '--email', '', '--json');
    expect(JSON.parse(edited.stdout)).toEqual({ handle: 'sam', name: 'Samantha' });

    expect((await cli('assignees', 'add', 'sam', '--name', 'Sam')).exitCode).toBe(4);
    const badEmail = await cli('assignees', 'add', 'ana', '--name', 'Ana', '--email', 'nope');
    expect(badEmail.exitCode).toBe(2);
    expect(badEmail.stderr).toContain('Invalid Assignee: email');
    expect((await cli('assignees', 'edit', 'sam')).exitCode).toBe(2);
    expect((await cli('assignees', 'remove', 'ghost')).exitCode).toBe(3);
    expect((await cli('assignees', 'add', 'ana', '--no-prompt')).exitCode).toBe(2);
  });

  it('every verb has --help', async () => {
    const { cli } = await setup();
    for (const verb of ['list', 'add', 'edit', 'remove']) {
      const { stdout, exitCode } = await cli('assignees', verb, '--help');
      expect(exitCode).toBe(0);
      expect(stdout).toContain(`Usage: rowbly assignees ${verb}`);
    }
  });

  it('has no commands or Story options while the Plugin is off', async () => {
    const t = await tempRoot();
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    const cli = (...args: string[]) => runCli(args, { root: t.path, cwd: t.dir });
    const create = await cli('stories', 'create', '--name', 'X', '--assignee', 'alice');
    expect(create.exitCode).toBe(2);
    expect(create.stderr).toContain("unknown option '--assignee'");
    expect((await cli('assignees', 'list')).exitCode).toBe(2);
  });
});

describe('Assignees on Stories', () => {
  it('stories create --assignee takes comma-separated handles and "me"', async () => {
    const { t, cli } = await setup();
    await createRepositories(t.root).localState.put({ version: 1, me: 'bob' });
    const result = await cli(
      'stories',
      'create',
      '--name',
      'X',
      '--assignee',
      'alice,me',
      '--assignee',
      'alice',
      '--json',
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      key: 'WEB-1',
      createdBy: 'bob',
      plugins: { assignees: { assignees: ['alice', 'bob'] } },
    });
  });

  it('exits 2 for an unknown Assignee and lists the valid handles in details', async () => {
    const { t, cli } = await setup();
    const result = await cli('stories', 'create', '--name', 'X', '--assignee', 'nobody', '--json');
    expect(result.exitCode).toBe(2);
    const { error } = JSON.parse(result.stderr);
    expect(error.code).toBe('VALIDATION');
    expect(error.details.validHandles).toEqual(['alice', 'bob']);
    const human = await cli('stories', 'create', '--name', 'X', '--assignee', 'nobody');
    expect(human.stderr).toContain('valid handles: alice, bob');
    expect(await createRepositories(t.root).stories.allInBoard('web')).toEqual([]);
  });

  it('stories edit replaces, adds and removes Assignees, but not replace with add/remove', async () => {
    const { t, cli, assignees } = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', ...assigned('alice') });
    const edit = (...args: string[]) => cli('stories', 'edit', 'WEB-1', ...args);

    expect((await edit('--add-assignee', 'bob')).exitCode).toBe(0);
    expect(await assignees('WEB-1')).toEqual(['alice', 'bob']);
    expect((await edit('--remove-assignee', 'alice')).exitCode).toBe(0);
    expect(await assignees('WEB-1')).toEqual(['bob']);
    expect((await edit('--assignee', 'alice')).exitCode).toBe(0);
    expect(await assignees('WEB-1')).toEqual(['alice']);

    const both = await edit('--assignee', 'bob', '--add-assignee', 'alice');
    expect(both.exitCode).toBe(2);
    expect(both.stderr).toContain('replace the Assignees or add/remove them, not both');
    expect(await assignees('WEB-1')).toEqual(['alice']);
  });

  it('stories list --assignee me filters by Me and exits 2 without it', async () => {
    const { t, cli } = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', rank: 'a0', ...assigned('alice') });
    await makeStory(t.path, { ...web, key: 'WEB-2', rank: 'a1', ...assigned('alice'), stage: 'done' });
    await makeStory(t.path, { ...web, key: 'WEB-3', rank: 'a2', ...assigned('bob') });
    await makeStory(t.path, { ...web, key: 'WEB-4', rank: 'a3' });
    const without = await cli('stories', 'list', '--open', '--assignee', 'me');
    expect(without.exitCode).toBe(2);
    expect(without.stderr).toContain('Me is not set');
    await createRepositories(t.root).localState.put({ version: 1, me: 'alice' });
    const keys = async (...args: string[]) =>
      JSON.parse((await cli('stories', 'list', ...args, '--json')).stdout).map((s: { key: string }) => s.key);
    expect(await keys('--open', '--assignee', 'me')).toEqual(['WEB-1']);
    expect(await keys('--assignee', 'bob,me')).toEqual(['WEB-1', 'WEB-3', 'WEB-2']);
  });

  it('shows the Assignees on stories show', async () => {
    const { t, cli } = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', ...assigned('alice', 'bob') });
    await makeStory(t.path, { ...web, key: 'WEB-2' });
    expect((await cli('stories', 'show', 'WEB-1')).stdout).toMatch(/Assignees: +alice, bob/);
    expect((await cli('stories', 'show', 'WEB-2')).stdout).toMatch(/Assignees: +none/);
  });

  it('doctor reports and fixes unknown Assignees and a Me outside the roster', async () => {
    const { t, cli, assignees } = await setup();
    await makeStory(t.path, { ...web, key: 'WEB-1', ...assigned('alice', 'ghost') });
    await createRepositories(t.root).localState.put({ version: 1, me: 'zed' });

    const check = await cli('doctor', '--json');
    const codes = JSON.parse(check.stdout).findings.map((f: { code: string }) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['ASSIGNEES_UNKNOWN_ASSIGNEE', 'ASSIGNEES_UNKNOWN_ME']));
    expect((await cli('doctor')).stdout).toContain('WEB-1 has Assignees not in the roster: ghost');

    const fix = await cli('doctor', '--fix');
    expect(fix.stdout).toContain('removed ghost from WEB-1');
    expect(fix.stdout).toContain('cleared me "zed" from Local State');
    expect(await assignees('WEB-1')).toEqual(['alice']);
    expect(JSON.parse(await readFile(join(t.path, 'local.json'), 'utf8'))).toEqual({ version: 1 });
    expect(await cli('doctor')).toMatchObject({ exitCode: 0, stdout: 'No problems found\n' });
  });
});
