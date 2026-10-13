import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBoard, makeEpic, makeWorkspace, runCli, tempRoot } from '../helpers';

describe('rowbly workspaces', () => {
  it('create, then list --json shows it; creating it again exits 4', async () => {
    const t = await tempRoot();
    const created = await runCli(['workspaces', 'create', 'acme', '--name', 'Acme'], { root: t.path });
    expect(created).toMatchObject({ exitCode: 0, stderr: '' });
    expect(created.stdout).toContain('Created Workspace acme  Acme');

    const list = await runCli(['workspaces', 'list', '--json'], { root: t.path });
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout)).toMatchObject([{ id: 'acme', name: 'Acme', description: '', assignees: [] }]);

    const again = await runCli(['workspaces', 'create', 'acme', '--name', 'Acme'], { root: t.path });
    expect(again.exitCode).toBe(4);
    expect(again.stderr).toContain('Workspace "acme" already exists');
  });

  it('list prints a table and marks the current Workspace', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme', name: 'Acme', description: 'Main\nmore' });
    await makeWorkspace(t.path, { id: 'labs', name: 'Labs' });
    const { stdout } = await runCli(['workspaces', 'list'], { root: t.path });
    expect(stdout).toMatch(/ID\s+NAME\s+ASSIGNEES\s+DESCRIPTION/);
    expect(stdout).toMatch(/acme\s+Acme\s+0\s+Main/);
    expect(stdout).not.toContain('more');
  });

  it('create takes the description from a file or stdin; invalid ids exit 2', async () => {
    const t = await tempRoot();
    const created = await runCli(['workspaces', 'create', 'acme', '--name', 'Acme', '--description-file', '-'], {
      root: t.path,
      stdin: 'From stdin\n',
    });
    expect(created.exitCode).toBe(0);
    const show = await runCli(['workspaces', 'show', 'acme', '--json'], { root: t.path });
    expect(JSON.parse(show.stdout).workspace.description).toBe('From stdin');

    const invalid = await runCli(['workspaces', 'create', 'Bad_Id', '--name', 'x'], { root: t.path });
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain('invalid Workspace: id');
  });

  it('show prints counts and where Stages and Custom Fields are defined', async () => {
    const t = await tempRoot();
    const stages = [{ key: 'open', name: 'Open', category: 'todo' as const }];
    await makeWorkspace(t.path, {
      id: 'acme',
      name: 'Acme',
      description: 'Our team',
      assignees: [{ handle: 'sam', name: 'Sam' }],
    });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB', stages });
    await makeEpic(t.path, { id: 'launch', workspaceId: 'acme' });

    const { stdout, exitCode } = await runCli(['workspaces', 'show'], { root: t.path });
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        'acme  Acme',
        '',
        'Our team',
        '',
        'Boards         1',
        'Epics          1',
        'Assignees      1',
        'Stages         defined at board web',
        'Custom Fields  none',
        '',
      ].join('\n'),
    );
  });

  it('show with no id and several Workspaces exits 2; --workspace and ROWBLY_WORKSPACE pick one', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await makeWorkspace(t.path, { id: 'labs' });
    expect((await runCli(['workspaces', 'show'], { root: t.path })).exitCode).toBe(2);
    expect((await runCli(['workspaces', 'show', '--workspace', 'labs'], { root: t.path })).stdout).toMatch(/^labs/);
    const env = { ROWBLY_WORKSPACE: 'acme' };
    expect((await runCli(['workspaces', 'show'], { root: t.path, env })).stdout).toMatch(/^acme/);
    expect((await runCli(['workspaces', 'show', 'nope'], { root: t.path })).exitCode).toBe(3);
  });

  it('edit changes the name and description; with nothing to change it exits 2', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme', name: 'Acme' });
    const edited = await runCli(['workspaces', 'edit', 'acme', '--name', 'ACME', '--description', 'Hi', '--json'], {
      root: t.path,
    });
    expect(edited.exitCode).toBe(0);
    expect(JSON.parse(edited.stdout)).toMatchObject({ name: 'ACME', description: 'Hi' });
    expect((await runCli(['workspaces', 'edit', 'acme'], { root: t.path })).exitCode).toBe(2);
    expect((await runCli(['workspaces', 'edit', 'nope', '--name', 'x'], { root: t.path })).exitCode).toBe(3);
  });

  it('delete on a Workspace with a Board exits 4 without --force; --force --yes removes the folder', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    const refused = await runCli(['workspaces', 'delete', 'acme'], { root: t.path });
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain('not empty (1 Board, 0 Epics)');
    expect(refused.stderr).toContain('--force');

    const deleted = await runCli(['workspaces', 'delete', 'acme', '--force', '--yes'], { root: t.path });
    expect(deleted).toMatchObject({ exitCode: 0, stdout: 'Deleted Workspace acme\n' });
    await expect(access(join(t.path, 'workspaces', 'acme'))).rejects.toThrow();
  });

  it('delete without --yes in a non-interactive run exits 2 and keeps the Workspace', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    const result = await runCli(['workspaces', 'delete', 'acme'], { root: t.path });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('confirmation required');
    await access(join(t.path, 'workspaces', 'acme', 'workspace.config.json'));
  });

  it('delete clears the Local State context that pointed at the Workspace', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme' });
    await writeFile(join(t.path, 'local.json'), JSON.stringify({ version: 1, workspace: 'acme', me: 'sam' }));
    const result = await runCli(['workspaces', 'delete', 'acme', '--yes', '--json'], { root: t.path });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ deleted: 'acme' });
    expect(JSON.parse(await readFile(join(t.path, 'local.json'), 'utf8'))).toEqual({ version: 1, me: 'sam' });
  });

  it('create without --name in a non-interactive run exits 2', async () => {
    const t = await tempRoot();
    const result = await runCli(['workspaces', 'create', 'acme'], { root: t.path });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('missing required --name');
  });

  it('every verb has --help', async () => {
    for (const verb of ['list', 'create', 'show', 'edit', 'delete']) {
      const { stdout, exitCode } = await runCli(['workspaces', verb, '--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(`Usage: rowbly workspaces ${verb}`);
    }
  });
});
