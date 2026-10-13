import type { Command } from 'commander';
import { UsageError } from '../core';
import { colors, printResult } from '../output';
import { type CustomFieldDef, type CustomFieldInput, CustomFieldTypeSchema } from '../schemas';
import type { ConfigTarget } from '../services';
import { affectedBoards, readLevel } from '../services/_configTarget';
import { collect, parseRepeatable, promptIfMissing, withContext } from './_shared';
import { renderFieldTable } from './boards';
import {
  affectsLine,
  describeTarget,
  type LevelFlags,
  type MutationResult,
  mutationResult,
  resolveConfigTarget,
  withLevelOptions,
} from './stages';

interface FieldOptions extends LevelFlags {
  name?: string;
  type?: string;
  description?: string;
  options?: string[];
  required?: boolean;
  /** `--optional` sets `required` to false on `edit`. */
  optional?: boolean;
  min?: string;
  max?: string;
  integer?: boolean;
}

export function registerFields(program: Command): void {
  const fields = program.command('fields').description('Manage the Custom Fields of a Board');

  withLevelOptions(fields.command('list').description('List Custom Fields, with the level they come from')).action(
    async (opts: FieldOptions, cmd: Command) =>
      withContext(cmd, async ({ ctx, services, globals }) => {
        const target = await resolveConfigTarget(services, opts);
        const { items, source } = await readLevel(ctx, target, 'customFields');
        printResult(
          { level: target.level, fields: items, source },
          {
            json: globals.json,
            human: (d) =>
              [
                colors.dim(`${describeTarget(target)}; from ${d.source}`),
                d.fields.length === 0 ? colors.dim('No Custom Fields.') : renderFieldTable(d.fields),
              ].join('\n'),
          },
        );
      }),
  );

  withLevelOptions(
    fields
      .command('add <key>')
      .description('Add a Custom Field')
      .option('--name <name>', 'display name')
      .option('--type <type>', `field type: ${CustomFieldTypeSchema.options.join(', ')}`)
      .option('--options <a,b>', 'choices for select and multiselect (repeatable)', collect)
      .option('--required', 'every Story must have a value')
      .option('--min <n>', 'smallest allowed number')
      .option('--max <n>', 'largest allowed number')
      .option('--integer', 'only whole numbers')
      .option('--description <text>', 'description'),
  ).action(async (key: string, opts: FieldOptions, cmd: Command) =>
    withContext(cmd, async ({ ctx, services, globals }) => {
      const target = await resolveConfigTarget(services, opts);
      const name = await promptIfMissing(opts.name, globals, { flag: '--name', message: 'Field name' });
      const type = await promptIfMissing(opts.type, globals, {
        flag: '--type',
        message: 'Field type',
        options: CustomFieldTypeSchema.options.map((value) => ({ value })),
      });
      const def = {
        key,
        name,
        type,
        required: opts.required ?? false,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
        ...(opts.options !== undefined ? { options: parseRepeatable(opts.options) } : {}),
        ...(opts.min !== undefined ? { min: parseNumber('--min', opts.min) } : {}),
        ...(opts.max !== undefined ? { max: parseNumber('--max', opts.max) } : {}),
        ...(opts.integer ? { integer: true } : {}),
      } as CustomFieldInput;
      const list = await services.fields.add(target, def);
      printMutation(
        await mutationResult(ctx, target, 'customFields', list),
        globals.json,
        target,
        `Added Custom Field ${key}`,
      );
    }),
  );

  withLevelOptions(
    fields
      .command('edit <key>')
      .description('Edit a Custom Field (its key and type cannot change)')
      .option('--name <name>', 'new display name')
      .option('--description <text>', 'new description ("" removes it)')
      .option('--required', 'make the field required')
      .option('--optional', 'make the field optional')
      .option('--options <a,b>', 'replace the choices; values no longer valid are stripped', collect)
      .option('--min <n>', 'smallest allowed number')
      .option('--max <n>', 'largest allowed number')
      .option('--integer', 'only whole numbers'),
  ).action(async (key: string, opts: FieldOptions, cmd: Command) =>
    withContext(cmd, async ({ ctx, services, globals }) => {
      if (opts.required && opts.optional) throw new UsageError('pass only one of --required and --optional');
      const patch = {
        name: opts.name,
        description: opts.description,
        required: opts.required ? true : opts.optional ? false : undefined,
        options: opts.options === undefined ? undefined : parseRepeatable(opts.options),
        min: opts.min === undefined ? undefined : parseNumber('--min', opts.min),
        max: opts.max === undefined ? undefined : parseNumber('--max', opts.max),
        integer: opts.integer,
      };
      if (Object.values(patch).every((value) => value === undefined)) {
        throw new UsageError('nothing to change', { hint: 'see `rowbly fields edit --help`' });
      }
      const target = await resolveConfigTarget(services, opts);
      const list = await services.fields.update(target, key, patch);
      printMutation(
        await mutationResult(ctx, target, 'customFields', list),
        globals.json,
        target,
        `Updated Custom Field ${key}`,
      );
    }),
  );

  withLevelOptions(
    fields.command('remove <key>').description('Remove a Custom Field and strip its values from Stories'),
  ).action(async (key: string, opts: FieldOptions, cmd: Command) =>
    withContext(cmd, async ({ ctx, services, globals }) => {
      const target = await resolveConfigTarget(services, opts);
      const affected = await affectedBoards(ctx, target, 'customFields');
      const { valuesStripped } = await services.fields.remove(target, key);
      const { items } = await readLevel(ctx, target, 'customFields');
      printResult(
        { level: target.level, items, affectedBoards: affected, valuesStripped },
        {
          json: globals.json,
          human: (r) =>
            [
              `Removed Custom Field ${key}; stripped ${r.valuesStripped} values`,
              affectsLine(target, r.affectedBoards),
            ].join('\n'),
        },
      );
    }),
  );
}

function printMutation(
  result: MutationResult<CustomFieldDef>,
  json: boolean,
  target: ConfigTarget,
  done: string,
): void {
  printResult(result, {
    json,
    human: (r) => [done, renderFieldTable(r.items), affectsLine(target, r.affectedBoards)].join('\n'),
  });
}

function parseNumber(flag: string, value: string): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) throw new UsageError(`${flag} must be a number, got "${value}"`);
  return n;
}
