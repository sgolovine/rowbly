import type { Command } from 'commander';
import { UsageError } from '../../core';
import { printResult } from '../../output';
import { type CustomFieldInput, CustomFieldTypeSchema } from '../../schemas';
import { affectedBoards, readLevel } from '../../services/_configTarget';
import { collect, parseRepeatable, promptIfMissing, withContext } from '../shared';
import { mutationResult, resolveConfigTarget, withLevelOptions } from '../stages';
import { renderFieldRemoved, renderFields, renderMutation } from './render';
import type { FieldOptions } from './types';
import { parseNumber } from './util';

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
            human: (d) => renderFields(target, d.fields, d.source),
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
      printResult(await mutationResult(ctx, target, 'customFields', list), {
        json: globals.json,
        human: (result) => renderMutation(result, target, key, 'Added'),
      });
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
      printResult(await mutationResult(ctx, target, 'customFields', list), {
        json: globals.json,
        human: (result) => renderMutation(result, target, key, 'Updated'),
      });
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
          human: (r) => renderFieldRemoved(target, key, r),
        },
      );
    }),
  );
}
