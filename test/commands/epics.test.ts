import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBoard, makeEpic, makeStory, makeWorkspace, runCli, tempRoot } from '../helpers';

/** Workspace `acme` with Boards `web` (custom stages) and `api` (default stages), and Epic `launch` on 3 Stories. */
async function setup() {
  const tmp = await tempRoot();
  await makeWorkspace(tmp.path, { id: 'acme' });
  await makeBoard(tmp.path, {
    id: 'web',
    workspaceId: 'acme',
    keyPrefix: 'WEB',
    stages: [
      { key: 'open', name: 'Open', category: 'todo' },
      { key: 'shipped', name: 'Shipped', category: 'done' },
    ],
  });
  await makeBoard(tmp.path, { id: 'api', workspaceId: 'acme', keyPrefix: 'API' });
  await makeEpic(tmp.path, { id: 'launch', workspaceId: 'acme', name: 'Launch' });
  const story = (key: string, boardId: string, stage: string) =>
    makeStory(tmp.path, { key, workspaceId: 'acme', boardId, stage, epicId: 'launch', name: `Do ${key}` });
  await story('WEB-1', 'web', 'shipped');
  await story('WEB-2', 'web', 'open');
  await story('API-1', 'api', 'done');
  const cli = (...args: string[]) => runCli(args, { root: tmp.path });
  const readStory = async (board: string, key: string) =>
    JSON.parse(await readFile(join(tmp.path, 'workspaces/acme/boards', board, 'stories', `${key}.json`), 'utf8'));
  return { tmp, cli, readStory };
}

describe('rowbly epics', () => {
  it('reports 2/3 for stories done on two boards with different done stages', async () => {
    const { cli } = await setup();
    const json = await cli('epics', 'show', 'launch', '--json');
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout).progress).toEqual({ done: 2, total: 3 });

    const { stdout } = await cli('epics', 'list');
    expect(stdout).toMatch(/launch\s+Launch\s+2\/3 [█░]{10}\s+api, web\s+no/);
  });

  it('shows stories grouped by board with stage badges', async () => {
    const { cli } = await setup();
    const { stdout, exitCode } = await cli('epics', 'show', 'launch');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Launch (launch)');
    expect(stdout).toMatch(/^api\n {2}API-1 {2}● Done {2}Do API-1$/m);
    expect(stdout).toMatch(/^web\n {2}WEB-1 {2}● Shipped {2}Do WEB-1\n {2}WEB-2 {2}● Open {5}Do WEB-2$/m);
  });

  it('hides closed epics unless --closed or --all is given', async () => {
    const { cli } = await setup();
    expect((await cli('epics', 'close', 'launch')).stdout).toBe('Closed Epic launch\n');
    expect((await cli('epics', 'list')).stdout).toBe('No open Epics.\n');
    expect((await cli('epics', 'create', 'beta', '--name', 'Beta')).exitCode).toBe(0);

    const ids = async (...flags: string[]) =>
      JSON.parse((await cli('epics', 'list', '--json', ...flags)).stdout).map((e: { id: string }) => e.id);
    expect(await ids()).toEqual(['beta']);
    expect(await ids('--closed')).toEqual(['launch']);
    expect(await ids('--all')).toEqual(['beta', 'launch']);
    expect((await cli('epics', 'list', '--all')).stdout).toMatch(/launch\s+Launch\s+2\/3.*yes/);

    expect((await cli('epics', 'reopen', 'launch')).exitCode).toBe(0);
    expect(await ids()).toEqual(['beta', 'launch']);
    expect((await cli('epics', 'list', '--closed', '--all')).exitCode).toBe(2);
  });

  it('deletes an epic, unlinks its 3 stories and warns with the count', async () => {
    const { cli, readStory } = await setup();
    const refused = await cli('epics', 'delete', 'launch');
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain('pass --yes');

    const result = await cli('epics', 'delete', 'launch', '--yes');
    expect(result).toEqual({
      stdout: 'Deleted Epic launch\n',
      stderr: 'warning: unlinked 3 Stories from Epic "launch"\n',
      exitCode: 0,
    });
    for (const [board, key] of [
      ['web', 'WEB-1'],
      ['web', 'WEB-2'],
      ['api', 'API-1'],
    ] as const) {
      expect((await readStory(board, key)).epicId).toBeNull();
    }
    expect((await cli('epics', 'show', 'launch')).exitCode).toBe(3);
  });

  it('warns as JSON and returns the count with --json', async () => {
    const { cli } = await setup();
    const { stdout, stderr } = await cli('epics', 'delete', 'launch', '--yes', '--json');
    expect(JSON.parse(stdout)).toEqual({ storiesUnlinked: 3 });
    expect(JSON.parse(stderr)).toEqual({ warning: 'unlinked 3 Stories from Epic "launch"' });
  });

  it('creates and edits an epic', async () => {
    const { tmp, cli } = await setup();
    const created = await cli('epics', 'create', 'beta', '--name', 'Beta', '--description', 'First', '--json');
    expect(JSON.parse(created.stdout)).toMatchObject({ id: 'beta', name: 'Beta', description: 'First', closed: false });

    const edited = await runCli(['epics', 'edit', 'beta', '--name', 'Beta 2', '--description-file', '-', '--json'], {
      root: tmp.path,
      stdin: 'From stdin\n',
    });
    expect(JSON.parse(edited.stdout)).toMatchObject({ name: 'Beta 2', description: 'From stdin' });
  });

  it('fails with usage, conflict and not-found exit codes', async () => {
    const { cli } = await setup();
    const missingName = await cli('epics', 'create', 'beta');
    expect(missingName).toMatchObject({ exitCode: 2, stderr: 'error: missing required --name\n' });
    expect((await cli('epics', 'create', 'launch', '--name', 'Again')).exitCode).toBe(4);
    expect((await cli('epics', 'edit', 'launch')).exitCode).toBe(2);
    expect((await cli('epics', 'close', 'nope')).exitCode).toBe(3);
    expect((await cli('epics', 'list', '--workspace', 'nope')).exitCode).toBe(3);
  });

  it('has --help for every verb', async () => {
    const { cli } = await setup();
    for (const verb of ['list', 'create', 'show', 'edit', 'close', 'reopen', 'delete']) {
      const { stdout, exitCode } = await cli('epics', verb, '--help');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('--workspace <id>');
    }
  });
});
