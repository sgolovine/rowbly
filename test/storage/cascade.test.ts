import { describe, expect, it } from 'vitest';
import type { CustomFieldDef, Stage } from '../../src/schemas';
import { DEFAULT_STAGES } from '../../src/schemas';
import { createRepositories, resolveCascade } from '../../src/storage';
import { makeBoard, makeWorkspace, tempRoot } from '../helpers';

const stage = (key: string): Stage => ({ key, name: key, category: 'todo' });
const field = (key: string): CustomFieldDef => ({ key, name: key, type: 'text', required: false });
const ref = { workspaceId: 'acme', boardId: 'web' };

type Level = 'board' | 'workspace' | 'global' | 'default';
const LEVELS: Level[] = ['board', 'workspace', 'global', 'default'];

/** Defines `stages` from `stagesFrom` down to global, and `customFields` from `fieldsFrom` down. */
async function setup(stagesFrom: Level, fieldsFrom: Level) {
  const t = await tempRoot();
  const at = (from: Level, level: Level) => LEVELS.indexOf(from) <= LEVELS.indexOf(level) && from !== 'default';
  const lists = (level: Exclude<Level, 'default'>) => ({
    ...(at(stagesFrom, level) ? { stages: [stage(`${level}-stage`)] } : {}),
    ...(at(fieldsFrom, level) ? { customFields: [field(`${level}-field`)] } : {}),
  });
  await createRepositories(t.root).rootConfig.put({ version: 1, ...lists('global') });
  await makeWorkspace(t.path, { id: 'acme', ...lists('workspace') });
  await makeBoard(t.path, { ...ref, id: 'web', keyPrefix: 'WEB', ...lists('board') });
  return t;
}

describe('resolveCascade', () => {
  for (const stagesFrom of LEVELS) {
    for (const fieldsFrom of LEVELS) {
      it(`stages from ${stagesFrom}, custom fields from ${fieldsFrom}`, async () => {
        const t = await setup(stagesFrom, fieldsFrom);
        const effective = await resolveCascade(t.root, ref);
        expect(effective.board.id).toBe('web');
        expect(effective.stagesSource).toBe(stagesFrom);
        expect(effective.customFieldsSource).toBe(fieldsFrom);
        expect(effective.stages).toEqual(stagesFrom === 'default' ? DEFAULT_STAGES : [stage(`${stagesFrom}-stage`)]);
        expect(effective.customFields).toEqual(fieldsFrom === 'default' ? [] : [field(`${fieldsFrom}-field`)]);
      });
    }
  }

  it('returns a mutable copy of the default stages', async () => {
    const t = await setup('default', 'default');
    const effective = await resolveCascade(t.root, ref);
    effective.stages.push(stage('extra'));
    expect(DEFAULT_STAGES).toHaveLength(4);
  });
});
