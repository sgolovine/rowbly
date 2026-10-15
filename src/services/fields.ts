import { ConflictError, NotFoundError, toTimestamp, ValidationError } from '../core';
import { type CustomFieldDef, CustomFieldDefSchema, type Slug, type Story } from '../schemas';
import { type Repositories, resolveCascade } from '../storage';
import { openLevel } from './_configTarget';
import { fieldValueError } from './_customFieldValues';
import type { CoreChangeSet } from './plugins/changeSet';
import type { OperationRunner } from './plugins/runtime';
import type { ConfigTarget, CustomFieldPatch, FieldsService, RowblyContext } from './types';

const NUMBER_ONLY = ['min', 'max', 'integer'] as const;

export function createFieldsService(ctx: RowblyContext, repos: Repositories, ops: OperationRunner): FieldsService {
  const open = (target: ConfigTarget) => openLevel(ctx, repos, target, 'customFields');

  return {
    async list(boardId) {
      const { customFields, customFieldsSource } = await resolveCascade(ctx.root, boardId);
      return { fields: customFields, source: customFieldsSource };
    },

    add: (target, input, opts = {}) =>
      ops.run('fields.add', { target, field: input, ...opts }, async (changes) => {
        const def = parseField(input);
        const level = await open(target);
        if (level.items.some((f) => f.key === def.key))
          throw new ConflictError(`Custom Field "${def.key}" already exists`);
        const next = [...level.items, def];
        await level.save(changes, next);
        return next;
      }),

    async update(target, key, patch) {
      const { plugins: _plugins, ...fields } = patch;
      // The count of stripped values is for the warning only; the operation's result is the fields (ARCH-14).
      let stripped = 0;
      const next = await ops.run('fields.update', { target, key, ...patch }, async (changes) => {
        const level = await open(target);
        const updated = parseField(applyPatch(findField(level.items, key), fields));
        const next = level.items.map((f) => (f.key === key ? updated : f));
        await level.save(changes, next);
        stripped = await stripValues(changes, level.affected, key, (value) => fitValue(updated, value));
        return next;
      });
      if (stripped > 0) {
        ctx.warn(`stripped ${plural(stripped)} of "${key}" that no longer fit the Custom Field`);
      }
      return next;
    },

    async remove(target, key, opts = {}) {
      const result = await ops.run('fields.remove', { target, key, ...opts }, async (changes) => {
        const level = await open(target);
        findField(level.items, key);
        const valuesStripped = await stripValues(changes, level.affected, key, () => undefined);
        await level.save(
          changes,
          level.items.filter((f) => f.key !== key),
        );
        return { valuesStripped };
      });
      const n = result.valuesStripped;
      if (n > 0) ctx.warn(`stripped ${plural(n)} of removed Custom Field "${key}"`);
      return result;
    },
  };

  /**
   * Rewrites `key` on every Story of `boards` through `keep` (`undefined` removes the value).
   * Returns how many Stories changed.
   */
  async function stripValues(
    changes: CoreChangeSet,
    boards: readonly Slug[],
    key: string,
    keep: (value: Story['customFields'][string]) => Story['customFields'][string] | undefined,
  ): Promise<number> {
    const now = toTimestamp(ctx.now());
    let changed = 0;
    for (const boardId of boards) {
      for (const story of await repos.stories.allInBoard(boardId)) {
        const value = story.customFields[key];
        if (value === undefined) continue;
        const next = keep(value);
        if (JSON.stringify(next) === JSON.stringify(value)) continue;
        const { [key]: _removed, ...rest } = story.customFields;
        await changes.putStory({
          ...story,
          customFields: next === undefined ? rest : { ...rest, [key]: next },
          updatedAt: now,
        });
        changed += 1;
      }
    }
    return changed;
  }
}

/** The value kept after an edit: valid values stay, multiselect drops only the removed options. */
function fitValue(
  def: CustomFieldDef,
  value: Story['customFields'][string],
): Story['customFields'][string] | undefined {
  if (def.type === 'multiselect' && Array.isArray(value)) {
    const kept = value.filter((option) => def.options.includes(option));
    return kept.length > 0 ? kept : undefined;
  }
  return fieldValueError(def, value) === null ? value : undefined;
}

/** `type` and `key` are not patchable; `parseField` rejects properties that do not fit the type. */
function applyPatch(def: CustomFieldDef, patch: CustomFieldPatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...def };
  for (const [prop, value] of Object.entries(patch)) {
    if (value === undefined || prop === 'key' || prop === 'type') continue;
    // `null` (and an empty description) clears an optional property.
    if (value === null || (prop === 'description' && value === '')) delete next[prop];
    else next[prop] = value;
  }
  return next;
}

function parseField(input: unknown): CustomFieldDef {
  const raw = input as Record<string, unknown>;
  const type = raw.type;
  if (raw.options !== undefined && type !== 'select' && type !== 'multiselect') {
    throw new ValidationError(`options apply only to select and multiselect fields, not ${String(type)}`);
  }
  for (const prop of NUMBER_ONLY) {
    if (raw[prop] !== undefined && type !== 'number') {
      throw new ValidationError(`${prop} applies only to number fields, not ${String(type)}`);
    }
  }
  const result = CustomFieldDefSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('invalid Custom Field', { details: { issues: result.error.issues } });
  }
  const def = result.data;
  if (def.type === 'number' && def.min !== undefined && def.max !== undefined && def.min > def.max) {
    throw new ValidationError('min must not be greater than max', {
      details: { issues: [{ path: ['min'], message: 'must not be greater than max' }] },
    });
  }
  return def;
}

function findField(fields: readonly CustomFieldDef[], key: string): CustomFieldDef {
  const field = fields.find((f) => f.key === key);
  if (!field) throw new NotFoundError(`Custom Field "${key}" not found`);
  return field;
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'value' : 'values'}`;
}
