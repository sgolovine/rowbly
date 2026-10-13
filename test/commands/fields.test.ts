import { describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/storage';
import { makeBoard, makeStory, makeWorkspace, runCli, tempRoot } from '../helpers';

const web = { workspaceId: 'acme', boardId: 'web' };

async function setup() {
  const t = await tempRoot();
  await makeWorkspace(t.path, { id: 'acme' });
  await makeBoard(t.path, { ...web, id: 'web', keyPrefix: 'WEB' });
  const cli = (...args: string[]) => runCli(args, { root: t.path, cwd: t.dir });
  return { t, cli };
}

describe('rowbly fields', () => {
  it('adds a number field with --integer and --min', async () => {
    const { cli } = await setup();
    const result = await cli(
      'fields',
      'add',
      'estimate',
      '--name',
      'Estimate',
      '--type',
      'number',
      '--integer',
      '--min',
      '0',
      '--json',
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      level: 'board',
      items: [{ key: 'estimate', type: 'number', integer: true, min: 0, required: false }],
      affectedBoards: [web],
    });
    expect((await cli('fields', 'add', 'x', '--name', 'X', '--type', 'number', '--min', 'abc')).exitCode).toBe(2);
    expect((await cli('fields', 'add', 'x', '--name', 'X', '--type', 'weird')).exitCode).toBe(2);
    expect((await cli('fields', 'add', 'x', '--type', 'text', '--no-prompt')).stderr).toContain(
      'missing required --name',
    );
  });

  it('removing a select option strips matching Story values and warns with the count', async () => {
    const { t, cli } = await setup();
    await cli('fields', 'add', 'size', '--name', 'Size', '--type', 'select', '--options', 's,m', '--options', 'l');
    await makeStory(t.path, { ...web, key: 'WEB-1', customFields: { size: 'l' } });
    await makeStory(t.path, { ...web, key: 'WEB-2', customFields: { size: 's' } });

    const edited = await cli('fields', 'edit', 'size', '--options', 's,m');
    expect(edited.exitCode).toBe(0);
    expect(edited.stderr).toContain('warning: stripped 1 value of "size" that no longer fit the Custom Field');
    const stories = await createRepositories(t.root).stories.allInBoard(web);
    expect(stories.map((s) => s.customFields)).toEqual([{}, { size: 's' }]);
  });

  it('edits and removes a field, reporting the stripped count', async () => {
    const { t, cli } = await setup();
    await cli('fields', 'add', 'link', '--name', 'Link', '--type', 'url');
    await makeStory(t.path, { ...web, key: 'WEB-1', customFields: { link: 'https://x.dev' } });
    expect((await cli('fields', 'edit', 'link', '--required', '--description', 'PR link')).exitCode).toBe(0);
    expect(JSON.parse((await cli('fields', 'list', '--json')).stdout)).toMatchObject({
      source: 'board',
      fields: [{ key: 'link', required: true, description: 'PR link' }],
    });
    expect((await cli('fields', 'edit', 'link', '--integer')).exitCode).toBe(2);
    expect((await cli('fields', 'edit', 'link')).exitCode).toBe(2);

    const removed = await cli('fields', 'remove', 'link');
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toContain('Removed Custom Field link; stripped 1 values');
    expect(removed.stderr).toContain('warning: stripped 1 value of removed Custom Field "link"');
    expect((await cli('fields', 'remove', 'link')).exitCode).toBe(3);
  });

  it('has --help for every verb', async () => {
    const { cli } = await setup();
    for (const verb of ['list', 'add', 'edit', 'remove']) {
      const help = await cli('fields', verb, '--help');
      expect(help.exitCode, verb).toBe(0);
      expect(help.stdout).toContain(`rowbly fields ${verb}`);
    }
  });
});
