import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBoard, makeStory, makeWorkspace, runCli, tempRoot } from '../helpers';

async function setup() {
  const t = await tempRoot();
  await makeWorkspace(t.path, { id: 'acme' });
  await makeWorkspace(t.path, { id: 'labs' });
  const cli = (...args: string[]) => runCli(args, { root: t.path, cwd: t.dir });
  return { t, cli };
}

describe('rowbly boards', () => {
  it('creating two Boards with the same prefix in different Workspaces exits 4', async () => {
    const { cli } = await setup();
    const first = await cli('boards', 'create', 'web', '--name', 'Web', '--prefix', 'WEB', '--workspace', 'acme');
    expect(first).toMatchObject({ exitCode: 0, stdout: 'Created Board acme/web (WEB)\n' });
    const second = await cli('boards', 'create', 'site', '--name', 'Site', '--prefix', 'WEB', '--workspace', 'labs');
    expect(second.exitCode).toBe(4);
    expect(second.stderr).toContain('key prefix "WEB" is already used by Board "acme/web"');
  });

  it('lists, edits and shows Boards; --json prints schema objects', async () => {
    const { cli } = await setup();
    await cli('boards', 'create', 'web', '--name', 'Web', '--prefix', 'WEB', '--workspace', 'acme');
    const list = await cli('boards', 'list', '--workspace', 'acme', '--json');
    expect(JSON.parse(list.stdout)).toMatchObject([{ id: 'web', keyPrefix: 'WEB' }]);
    expect((await cli('boards', 'edit', 'web', '--name', 'Website', '--workspace', 'acme')).exitCode).toBe(0);
    expect((await cli('boards', 'list', '--workspace', 'acme')).stdout).toContain('Website');
    expect((await cli('boards', 'edit', 'web', '--workspace', 'acme')).exitCode).toBe(2);
  });

  it('show prints effective Stages and Fields with their source levels and Stories per Stage', async () => {
    const { t, cli } = await setup();
    await makeBoard(t.path, {
      id: 'web',
      workspaceId: 'acme',
      keyPrefix: 'WEB',
      customFields: [{ key: 'size', name: 'Size', type: 'select', options: ['s', 'm'], required: false }],
    });
    await makeStory(t.path, { workspaceId: 'acme', boardId: 'web', key: 'WEB-1', stage: 'todo' });
    await makeStory(t.path, { workspaceId: 'acme', boardId: 'web', key: 'WEB-2', stage: 'todo' });
    const human = await cli('boards', 'show', 'acme/web');
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('Stages (from default)');
    expect(human.stdout).toMatch(/todo\s+Todo\s+todo\s+2/);
    expect(human.stdout).toContain('Custom Fields (from board)');
    expect(human.stdout).toMatch(/size\s+Size\s+select\s+no\s+s, m/);
    const json = JSON.parse((await cli('boards', 'show', 'web', '--workspace', 'acme', '--json')).stdout);
    expect(json).toMatchObject({ stagesSource: 'default', customFieldsSource: 'board', storyCounts: { todo: 2 } });
  });

  it('delete needs --yes, refuses a Board with Stories, and --force deletes it', async () => {
    const { t, cli } = await setup();
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    await makeStory(t.path, { workspaceId: 'acme', boardId: 'web', key: 'WEB-1' });
    expect((await cli('boards', 'delete', 'acme/web')).exitCode).toBe(2);
    const refused = await cli('boards', 'delete', 'acme/web', '--yes');
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain('--force');
    expect(await cli('boards', 'delete', 'acme/web', '--yes', '--force')).toMatchObject({
      exitCode: 0,
      stdout: 'Deleted Board acme/web\n',
    });
    expect((await cli('boards', 'show', 'acme/web')).exitCode).toBe(3);
  });

  it('delete clears the current Board from local.json', async () => {
    const { t, cli } = await setup();
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    await cli('boards', 'create', 'api', '--name', 'Api', '--prefix', 'API', '--workspace', 'acme');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(t.path, 'local.json'), JSON.stringify({ version: 1, workspace: 'acme', board: 'web' }));
    expect((await cli('boards', 'delete', 'web', '--yes')).exitCode).toBe(0);
    expect(JSON.parse(await readFile(join(t.path, 'local.json'), 'utf8'))).toEqual({ version: 1, workspace: 'acme' });
  });

  it('has --help for every verb', async () => {
    const { cli } = await setup();
    for (const verb of ['list', 'create', 'show', 'edit', 'delete']) {
      const help = await cli('boards', verb, '--help');
      expect(help.exitCode, verb).toBe(0);
      expect(help.stdout).toContain(`rowbly boards ${verb}`);
    }
  });
});
