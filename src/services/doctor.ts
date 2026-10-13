import type { ZodType } from 'zod';
import {
  formatStoryKey,
  formatTaskId,
  isSlug,
  PluginError,
  parseTaskId,
  ranksBetween,
  STORY_KEY_RE,
  toTimestamp,
} from '../core';
import {
  type BoardConfig,
  BoardConfigSchema,
  type LocalState,
  LocalStateSchema,
  type RowblyConfig,
  RowblyConfigSchema,
  type Story,
  StorySchema,
} from '../schemas';
import { CONFLICT_MARKER_RE, cascade, listDataRootFiles, type Repositories, readDataRootFile } from '../storage';
import { fieldValueError } from './_customFieldValues';
import type { CoreChangeSet } from './plugins/changeSet';
import { deepMerge, type OperationRunner } from './plugins/runtime';
import type { DoctorData, PluginChangeSet } from './plugins/types';
import type {
  CoreDoctorCode,
  DoctorFinding,
  DoctorFix,
  DoctorReport,
  DoctorService,
  DoctorSeverity,
  RowblyContext,
} from './types';

const SEVERITY: Record<CoreDoctorCode, DoctorSeverity> = {
  SCHEMA_INVALID: 'error',
  ID_PATH_MISMATCH: 'error',
  STORY_KEY_CONFLICT: 'error',
  DUPLICATE_KEY: 'error',
  CONFLICT_MARKERS: 'error',
  DUPLICATE_PREFIX: 'error',
  UNKNOWN_STAGE: 'error',
  UNKNOWN_ASSIGNEE: 'warning',
  UNKNOWN_FIELD: 'warning',
  INVALID_FIELD_VALUE: 'warning',
  MISSING_REQUIRED_FIELD: 'warning',
  TASK_COUNTER_BEHIND: 'warning',
  DUPLICATE_RANK: 'warning',
  STALE_LOCAL_STATE: 'warning',
  UNKNOWN_FILE: 'info',
  PLUGIN_FAILED: 'error',
  PLUGIN_DATA_INVALID: 'warning',
  PLUGIN_DATA_UNCHECKED: 'info',
};

/** Fixes can uncover new findings (e.g. two renumbered Stories sharing a Rank), so `fix()` repeats. */
const MAX_FIX_PASSES = 5;

/**
 * A finding plus, when fixable, the in-memory change that fixes it (`flush` puts those into the
 * Change Set), or a Plugin's fix, which works on the Change Set itself.
 */
interface Finding extends DoctorFinding {
  apply?: () => string;
  pluginFix?: (changes: CoreChangeSet) => Promise<string>;
}

/**
 * A Story read from `file`, as read (`original`, `null` for one side of a conflict) and as fixed.
 * `dirty` Stories are saved to their key's folder by `flush`.
 */
interface StoryEntry {
  story: Story;
  original: Story | null;
  file: string;
  dirty: boolean;
}

interface BoardEntry {
  boardId: string;
  dir: string;
  config: BoardConfig | null;
  /** Story Key files present, valid or not. */
  storyFiles: string[];
  stories: StoryEntry[];
  /** Story numbers in use (file names and keys), so renumbering never reuses one. */
  used: Set<number>;
}

interface Model {
  findings: Finding[];
  boards: BoardEntry[];
  local: { state: LocalState; dirty: boolean };
}

/** Where Plugin Data was found, by Plugin id: the first place, and how many records and files. */
type PluginDataSeen = Map<string, { first: string; records: number; files: number }>;

export function createDoctorService(ctx: RowblyContext, _repos: Repositories, ops: OperationRunner): DoctorService {
  const now = () => toTimestamp(ctx.now());

  async function analyze(): Promise<Model> {
    const findings: Finding[] = [];
    const add = (code: CoreDoctorCode, path: string, message: string, extra: Partial<Finding> = {}) => {
      const { apply, details } = extra;
      findings.push({
        code,
        severity: SEVERITY[code],
        path,
        message,
        fixable: apply !== undefined,
        ...(details ? { details } : {}),
        ...(apply ? { apply } : {}),
      });
    };
    const pluginData: PluginDataSeen = new Map();
    const seen = (id: string, where: string, kind: 'records' | 'files') => {
      const entry = pluginData.get(id) ?? { first: where, records: 0, files: 0 };
      entry[kind] += 1;
      pluginData.set(id, entry);
    };
    const bagsSeen = (record: { plugins?: Record<string, unknown> }, where: string) => {
      for (const id of Object.keys(record.plugins ?? {})) seen(id, where, 'records');
    };

    /** Parses `text` against `schema`, reporting conflict markers, bad JSON and schema issues. */
    function parse<T>(file: string, text: string, schema: ZodType<T>): T | null {
      if (CONFLICT_MARKER_RE.test(text)) {
        add('CONFLICT_MARKERS', file, 'file has git conflict markers; merge it by hand');
        return null;
      }
      const result = parseJson(text, schema);
      if (result.ok) return result.value;
      add('SCHEMA_INVALID', file, result.message, result.issues ? { details: { issues: result.issues } } : {});
      return null;
    }

    // A Data Root that is itself a git repository (e.g. `~/.rowbly`) keeps `.git/` out of the report.
    const files = (await listDataRootFiles(ctx.root)).filter((file) => file !== '.git' && !file.startsWith('.git/'));
    const fileSet = new Set(files);
    const boards = new Map<string, BoardEntry>();
    const boardOf = (boardId: string) => {
      const dir = `boards/${boardId}`;
      let entry = boards.get(dir);
      if (!entry) {
        entry = { boardId, dir, config: null, storyFiles: [], stories: [], used: new Set() };
        boards.set(dir, entry);
      }
      return entry;
    };

    // 1. Sort every file into the layout (contracts §1); anything else is unknown. Plugin files are
    // in `plugins/<id>/` folders of the Data Root, a Board or a Story (ADR-0013).
    for (const file of files) {
      const parts = file.split('/');
      const [top, id = '', sub, key = '', name, plugin = ''] = parts;
      if (parts.length === 1 && ['rowbly.config.json', 'local.json', '.gitignore'].includes(file)) continue;
      if (top === 'plugins' && parts.length >= 3 && isSlug(id)) {
        seen(id, file, 'files');
        continue;
      }
      if (top === 'boards' && isSlug(id)) {
        if (parts.length >= 5 && sub === 'plugins' && isSlug(key)) {
          seen(key, file, 'files');
          continue;
        }
        if (parts.length >= 7 && sub === 'stories' && STORY_KEY_RE.test(key) && name === 'plugins' && isSlug(plugin)) {
          seen(plugin, file, 'files');
          continue;
        }
        if (parts.length === 3 && sub === 'board.config.json') {
          boardOf(id);
          continue;
        }
        if (parts.length === 5 && sub === 'stories' && STORY_KEY_RE.test(key) && name === 'story.json') {
          boardOf(id).storyFiles.push(file);
          continue;
        }
      }
      add('UNKNOWN_FILE', file, 'file is not part of the Data Root layout; Rowbly ignores it');
    }

    // 2. Configuration files.
    let global: RowblyConfig | null = null;
    if (fileSet.has('rowbly.config.json')) {
      global = parse('rowbly.config.json', await readDataRootFile(ctx.root, 'rowbly.config.json'), RowblyConfigSchema);
    } else {
      add('SCHEMA_INVALID', 'rowbly.config.json', 'required file is missing');
    }

    for (const entry of boards.values()) {
      const file = `${entry.dir}/board.config.json`;
      if (!fileSet.has(file)) {
        add('SCHEMA_INVALID', file, 'required file is missing; Rowbly ignores this Board folder');
        continue;
      }
      const config = parse(file, await readDataRootFile(ctx.root, file), BoardConfigSchema);
      if (config && mismatch(file, [['id', config.id, entry.boardId]])) continue;
      entry.config = config;
    }

    /** Reports an id/path mismatch for the first differing field; returns whether there was one. */
    function mismatch(file: string, checks: [field: string, actual: string, expected: string][]): boolean {
      const bad = checks.find(([, actual, expected]) => actual !== expected);
      if (!bad) return false;
      const [field, actual, expected] = bad;
      add('ID_PATH_MISMATCH', file, `${field} "${actual}" does not match its path ("${expected}")`, {
        details: { field, actual, expected },
      });
      return true;
    }

    // 3. Duplicate key prefixes.
    const byPrefix = groupBy(
      [...boards.values()].filter((b) => b.config),
      (b) => b.config?.keyPrefix ?? '',
    );
    for (const [prefix, group] of byPrefix) {
      if (group.length < 2) continue;
      const names = group.map((b) => b.boardId);
      for (const board of group.slice(1)) {
        add(
          'DUPLICATE_PREFIX',
          `${board.dir}/board.config.json`,
          `key prefix ${prefix} is used by ${names.join(', ')}`,
        );
      }
    }

    // 4. Story files, Story Keys and conflicts, Board by Board.
    for (const board of boards.values()) {
      const config = board.config;
      for (const file of board.storyFiles) board.used.add(numberOf(fileKey(file)));
      for (const file of board.storyFiles) {
        const text = await readDataRootFile(ctx.root, file);
        if (CONFLICT_MARKER_RE.test(text)) {
          const sides = config ? storyConflictSides(text, file, board) : null;
          if (sides) {
            const [first, second] = sides;
            add(
              'STORY_KEY_CONFLICT',
              file,
              `two new Stories were merged into ${first.key} ("${first.name}" and "${second.name}")`,
              { apply: () => splitConflict(board, file, first, second) },
            );
          } else {
            add('CONFLICT_MARKERS', file, 'file has git conflict markers; merge it by hand');
          }
          continue;
        }
        const story = parse(file, text, StorySchema);
        if (!story) continue;
        if (mismatch(file, [['boardId', story.boardId, board.boardId]])) continue;
        if (config && !story.key.startsWith(`${config.keyPrefix}-`)) {
          add('ID_PATH_MISMATCH', file, `key "${story.key}" does not use its Board's key prefix ${config.keyPrefix}`, {
            details: { field: 'key', actual: story.key, expected: config.keyPrefix },
          });
          continue;
        }
        board.used.add(numberOf(story.key));
        board.stories.push({ story, original: story, file, dirty: false });
      }
      if (!config) {
        board.stories = [];
        continue;
      }

      for (const [key, group] of groupBy(board.stories, (e) => e.story.key)) {
        if (group.length === 1) {
          const [entry] = group;
          if (entry && entry.file !== storyPath(entry.story)) {
            mismatch(entry.file, [['key', key, fileKey(entry.file)]]);
            board.stories = board.stories.filter((e) => e !== entry);
          }
          continue;
        }
        const [keeper, ...later] = [...group].sort(
          (a, b) =>
            compare(a.story.createdAt, b.story.createdAt) ||
            Number(b.file === storyPath(b.story)) - Number(a.file === storyPath(a.story)) ||
            compare(a.file, b.file),
        );
        if (!keeper) continue;
        const canonical = storyPath(keeper.story);
        // The keeper moves to its key's path when that path is free after renumbering.
        const canMove =
          keeper.file !== canonical && (!fileSet.has(canonical) || later.some((e) => e.file === canonical));
        for (const entry of later) {
          add('DUPLICATE_KEY', entry.file, `${key} is also the key of ${keeper.file}, a Story created earlier`, {
            apply: () => {
              const from = entry.story.key;
              entry.story = renumber(board, entry.story);
              entry.dirty = true;
              if (canMove) keeper.dirty = true;
              return `renumbered ${from} ("${entry.story.name}") to ${entry.story.key}`;
            },
          });
        }
      }
    }

    // 5. References, Custom Fields and task counters, Story by Story.
    for (const board of boards.values()) {
      if (!global || !board.config) continue;
      const effective = cascade(global, board.config);
      const stageKeys = new Set(effective.stages.map((s) => s.key));
      const roster = new Set(global.assignees.map((a) => a.handle));
      for (const entry of board.stories) {
        const { story } = entry;
        const file = entry.file;
        if (!stageKeys.has(story.stage)) {
          add('UNKNOWN_STAGE', file, `${story.key} is in unknown Stage "${story.stage}"`, {
            details: { hint: `run \`rowbly stories move ${story.key} <stage>\`` },
          });
        }
        for (const task of story.tasks) {
          if (!stageKeys.has(task.stage)) {
            add('UNKNOWN_STAGE', file, `${task.id} is in unknown Stage "${task.stage}"`, {
              details: { hint: `run \`rowbly tasks move ${task.id} <stage>\`` },
            });
          }
        }

        const unknown = story.assignees.filter((handle) => !roster.has(handle));
        if (unknown.length > 0) {
          add('UNKNOWN_ASSIGNEE', file, `${story.key} has Assignees not in the roster: ${unknown.join(', ')}`, {
            apply: () => {
              touch(entry, { assignees: entry.story.assignees.filter((handle) => roster.has(handle)) });
              return `removed ${unknown.join(', ')} from ${entry.story.key}`;
            },
          });
        }

        for (const [key, value] of Object.entries(story.customFields)) {
          const def = effective.customFields.find((d) => d.key === key);
          if (!def) {
            add('UNKNOWN_FIELD', file, `${story.key} has a value for unknown Custom Field "${key}"`, {
              apply: () => {
                const { [key]: _removed, ...rest } = entry.story.customFields;
                touch(entry, { customFields: rest });
                return `stripped unknown Custom Field "${key}" from ${entry.story.key}`;
              },
            });
            continue;
          }
          const error = fieldValueError(def, value);
          if (error)
            add('INVALID_FIELD_VALUE', file, `${story.key}: ${def.name} ${error}`, { details: { field: key } });
        }
        for (const def of effective.customFields) {
          if (def.required && story.customFields[def.key] === undefined) {
            add('MISSING_REQUIRED_FIELD', file, `${story.key} has no value for required Custom Field "${def.key}"`);
          }
        }

        const maxTask = Math.max(0, ...story.tasks.map((t) => parseTaskId(t.id).taskNumber));
        if (story.nextTaskNumber <= maxTask) {
          add(
            'TASK_COUNTER_BEHIND',
            file,
            `${story.key} nextTaskNumber ${story.nextTaskNumber} ≤ highest Task ${maxTask}`,
            {
              apply: () => {
                touch(entry, { nextTaskNumber: maxTask + 1 });
                return `set ${entry.story.key} nextTaskNumber to ${maxTask + 1}`;
              },
            },
          );
        }
      }

      // Ranks are compared per Stage.
      for (const [stage, column] of groupBy(board.stories, (e) => e.story.stage)) {
        const shared = [...groupBy(column, (e) => e.story.rank).values()].filter((g) => g.length > 1);
        if (shared.length === 0) continue;
        const keys = shared.flat().map((e) => e.story.key);
        add('DUPLICATE_RANK', board.dir, `Stories in Stage "${stage}" share a Rank: ${keys.join(', ')}`, {
          apply: () => {
            const ordered = [...column].sort(
              (a, b) => compare(a.story.rank, b.story.rank) || numberOf(a.story.key) - numberOf(b.story.key),
            );
            // The first Story of each tied run keeps its Rank; the rest move between it and the next Rank.
            const moved: string[] = [];
            for (let i = 0; i < ordered.length; ) {
              const rank = ordered[i]?.story.rank ?? '';
              let end = i + 1;
              while (ordered[end]?.story.rank === rank) end++;
              const ranks = ranksBetween(rank, ordered[end]?.story.rank ?? null, end - i - 1);
              ordered.slice(i + 1, end).forEach((entry, k) => {
                touch(entry, { rank: ranks[k] ?? entry.story.rank });
                moved.push(entry.story.key);
              });
              i = end;
            }
            return `re-ranked ${moved.join(', ')} in Stage "${stage}", keeping the current order`;
          },
        });
      }
    }

    // 6. Local State.
    const local = { state: { version: 1 } as LocalState, dirty: false };
    if (fileSet.has('local.json')) {
      const state = parse('local.json', await readDataRootFile(ctx.root, 'local.json'), LocalStateSchema);
      if (state) {
        local.state = state;
        const clear = (field: 'board' | 'me', message: string) =>
          add('STALE_LOCAL_STATE', 'local.json', message, {
            apply: () => {
              const { [field]: removed, ...rest } = local.state;
              local.state = rest;
              local.dirty = true;
              return `cleared ${field} "${removed}" from Local State`;
            },
          });
        if (state.board !== undefined && !fileSet.has(`boards/${state.board}/board.config.json`)) {
          clear('board', `current Board "${state.board}" does not exist`);
        }
        if (state.me !== undefined && global && !global.assignees.some((a) => a.handle === state.me)) {
          clear('me', `Me "${state.me}" is not in the roster`);
        }
      }
    }

    // 7. Plugins: failed loads, the checks of Plugins that are on, and the data of the others.
    const valid = {
      config: global,
      boards: [...boards.values()].flatMap((b) => (b.config ? [b.config] : [])),
      stories: [...boards.values()].flatMap((b) => b.stories.map((e) => e.story)),
    };
    if (global) {
      for (const [id, entry] of Object.entries(global.plugins ?? {})) {
        if (Object.keys(entry).some((k) => k !== 'enabled')) seen(id, 'rowbly.config.json', 'records');
      }
      for (const assignee of global.assignees) bagsSeen(assignee, 'rowbly.config.json');
    }
    for (const board of valid.boards) bagsSeen(board, `boards/${board.id}/board.config.json`);
    for (const story of valid.stories) {
      const file = storyPath(story);
      bagsSeen(story, file);
      for (const task of story.tasks) bagsSeen(task, file);
    }
    bagsSeen(local.state, 'local.json');
    findings.push(...(await pluginFindings(valid, local.state, pluginData)));

    return { findings, boards: [...boards.values()], local };

    /** Both sides of an add/add conflict, when each is a new Story with this file's key; otherwise `null`. */
    function storyConflictSides(text: string, file: string, board: BoardEntry): [Story, Story] | null {
      const sides = conflictSides(text);
      if (!sides) return null;
      const stories = sides.map((side) => parseJson(side, StorySchema));
      const [ours, theirs] = stories;
      if (!ours?.ok || !theirs?.ok) return null;
      const key = fileKey(file);
      const fits = (s: Story) => s.key === key && s.boardId === board.boardId;
      // Equal `createdAt` means one Story edited on both branches, which needs a manual merge.
      if (!fits(ours.value) || !fits(theirs.value) || ours.value.createdAt === theirs.value.createdAt) return null;
      return compare(ours.value.createdAt, theirs.value.createdAt) <= 0
        ? [ours.value, theirs.value]
        : [theirs.value, ours.value];
    }

    function splitConflict(board: BoardEntry, file: string, first: Story, second: Story): string {
      const renumbered = renumber(board, second);
      board.stories.push(
        { story: first, original: null, file, dirty: true },
        { story: renumbered, original: null, file, dirty: true },
      );
      return `kept ${first.key} ("${first.name}") and renumbered "${second.name}" to ${renumbered.key}`;
    }
  }

  /** Gives `story` the next free key on its Board, renaming its Task ids to match. */
  function renumber(board: BoardEntry, story: Story): Story {
    const n = Math.max(0, ...board.used) + 1;
    board.used.add(n);
    const key = formatStoryKey(board.config?.keyPrefix ?? '', n);
    const tasks = story.tasks.map((task) => ({ ...task, id: formatTaskId(key, parseTaskId(task.id).taskNumber) }));
    return { ...story, key, tasks, updatedAt: now() };
  }

  function touch(entry: StoryEntry, patch: Partial<Story>): void {
    entry.story = { ...entry.story, ...patch, updatedAt: now() };
    entry.dirty = true;
  }

  /**
   * `PLUGIN_FAILED` for each Plugin that failed to load; for each Plugin that is on, its bags checked
   * against its schemas and its own checks; and one info finding for each other Plugin with data.
   */
  async function pluginFindings(data: DoctorData, local: LocalState, seen: PluginDataSeen): Promise<Finding[]> {
    const findings: Finding[] = [];
    const host = ctx.plugins;
    for (const status of host?.failures() ?? []) {
      findings.push(
        coreFinding('PLUGIN_FAILED', 'rowbly.config.json', `Plugin "${status.id}" failed to load: ${status.reason}`, {
          plugin: status.id,
        }),
      );
    }
    for (const plugin of host?.active() ?? []) {
      const { id, doctor, settings, bags = {} } = plugin.definition;
      const invalid = (path: string, what: string, issues: string) =>
        findings.push(
          coreFinding('PLUGIN_DATA_INVALID', path, `${what} has invalid Plugin Data for "${id}": ${issues}`, {
            plugin: id,
          }),
        );
      const check = (schema: ZodType | undefined, value: unknown, path: string, what: string) => {
        if (!schema || value === undefined) return;
        const result = schema.safeParse(value);
        if (!result.success) invalid(path, what, summarize(result.error.issues));
      };
      for (const board of data.boards) {
        const { enabled: _enabled, ...bag } = board.plugins?.[id] ?? {};
        if (Object.keys(bag).length > 0) {
          check(settings, deepMerge(plugin.entry, bag), `boards/${board.id}/board.config.json`, `Board ${board.id}`);
        }
      }
      for (const assignee of data.config?.assignees ?? []) {
        check(bags.assignee, assignee.plugins?.[id], 'rowbly.config.json', `Assignee ${assignee.handle}`);
      }
      check(bags.local, local.plugins?.[id], 'local.json', 'Local State');
      for (const story of data.stories) {
        const file = storyPath(story);
        check(bags.story, story.plugins?.[id], file, story.key);
        for (const task of story.tasks) check(bags.task, task.plugins?.[id], file, task.id);
      }
      if (!doctor) continue;
      const context = ops.context(id);
      const prefix = `${id.toUpperCase().replaceAll('-', '_')}_`;
      try {
        for (const finding of await doctor.check({ data, plugin: context })) {
          const { fix } = finding;
          findings.push({
            code: `${prefix}${finding.code}`,
            severity: finding.severity,
            path: finding.path,
            message: finding.message,
            fixable: fix !== undefined,
            ...(fix
              ? { pluginFix: async (changes: CoreChangeSet) => fix(changes.forPlugin(id) as PluginChangeSet) }
              : {}),
          });
        }
      } catch (err) {
        findings.push(
          coreFinding(
            'PLUGIN_FAILED',
            'rowbly.config.json',
            `Plugin "${id}" failed in its doctor checks: ${messageOf(err)}`,
            {
              plugin: id,
            },
          ),
        );
      }
    }
    const handled = new Set([
      ...(host?.active() ?? []).map((p) => p.definition.id),
      ...(host?.failures() ?? []).map((s) => s.id),
    ]);
    for (const [id, where] of [...seen].sort(([a], [b]) => compare(a, b))) {
      if (handled.has(id)) continue;
      const known = host?.registry.some((d) => d.id === id) ?? false;
      const counts = [
        where.records && plural(where.records, 'record'),
        where.files && plural(where.files, 'file'),
      ].filter(Boolean);
      findings.push(
        coreFinding(
          'PLUGIN_DATA_UNCHECKED',
          where.first,
          `Plugin "${id}" is ${known ? 'off' : 'not in this version of Rowbly'}; its data (${counts.join(', ')}) is kept but not checked`,
          { plugin: id },
        ),
      );
    }
    return findings;
  }

  /** Puts the fixed Stories (each moving its whole folder to its key's folder) and Local State into the Change Set. */
  async function flush(model: Model, changes: CoreChangeSet): Promise<void> {
    for (const entry of model.boards.flatMap((b) => b.stories).filter((e) => e.dirty)) {
      changes.recordStory(entry.original, entry.story, entry.file.slice(0, entry.file.lastIndexOf('/')));
    }
    if (model.local.dirty) await changes.updateLocalState(() => model.local.state);
  }

  return {
    async check() {
      return report((await analyze()).findings, []);
    },
    async fix() {
      const fixed: DoctorFix[] = [];
      for (let pass = 0; pass < MAX_FIX_PASSES; pass++) {
        const model = await analyze();
        const fixable = model.findings.filter((f) => f.apply || f.pluginFix);
        if (fixable.length === 0) return report(model.findings, fixed);
        // Each pass is one operation, so Plugins can guard, transform and react to fixes too.
        const done = await ops.run('doctor.fix', { findings: report(fixable, []).findings }, async (changes) => {
          const pass: DoctorFix[] = [];
          for (const finding of fixable) {
            if (finding.apply) pass.push({ code: finding.code, path: finding.path, message: finding.apply() });
          }
          await flush(model, changes);
          for (const finding of fixable) {
            if (!finding.pluginFix) continue;
            pass.push({ code: finding.code, path: finding.path, message: await pluginFix(finding, changes) });
          }
          return pass;
        });
        fixed.push(...done);
      }
      return report((await analyze()).findings, fixed);
    },
  };
}

function coreFinding(code: CoreDoctorCode, path: string, message: string, details: Record<string, unknown>): Finding {
  return { code, severity: SEVERITY[code], path, message, fixable: false, details };
}

/** Runs a Plugin's fix; a throw fails `doctor --fix` like any Plugin handler (ADR-0012). */
async function pluginFix(finding: Finding, changes: CoreChangeSet): Promise<string> {
  try {
    return (await finding.pluginFix?.(changes)) ?? '';
  } catch (err) {
    const id = finding.code.split('_')[0]?.toLowerCase() ?? '';
    throw new PluginError(`Plugin fix for ${finding.code} failed: ${messageOf(err)}`, {
      details: { plugin: id, code: finding.code },
      hint: `turn the Plugin off with \`rowbly plugins disable ${id}\``,
      cause: err,
    });
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summarize(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.map(String).join('.') || '(bag)'}: ${i.message}`).join('; ');
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function report(findings: readonly Finding[], fixed: DoctorFix[]): DoctorReport {
  const order: DoctorSeverity[] = ['error', 'warning', 'info'];
  const sorted = findings
    .map(({ apply: _apply, pluginFix: _pluginFix, ...finding }) => finding)
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || compare(a.path, b.path));
  const count = (severity: DoctorSeverity) => sorted.filter((f) => f.severity === severity).length;
  return {
    findings: sorted,
    fixed,
    summary: { errors: count('error'), warnings: count('warning'), info: count('info') },
  };
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string; issues?: unknown };

function parseJson<T>(text: string, schema: ZodType<T>): ParseResult<T> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: 'file is not valid JSON' };
  }
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  const summary = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return { ok: false, message: `file does not match its schema: ${summary}`, issues: result.error.issues };
}

/**
 * Splits text with git conflict markers into the "ours" and "theirs" versions, keeping the lines
 * outside conflicts in both (a diff3 base section is dropped). Malformed markers give `null`.
 */
export function conflictSides(text: string): [string, string] | null {
  const ours: string[] = [];
  const theirs: string[] = [];
  let state: 'both' | 'ours' | 'base' | 'theirs' = 'both';
  for (const line of text.split('\n')) {
    if (/^<{7}(?: |$)/.test(line) && state === 'both') state = 'ours';
    else if (/^\|{7}(?: |$)/.test(line) && state === 'ours') state = 'base';
    else if (/^={7}$/.test(line) && (state === 'ours' || state === 'base')) state = 'theirs';
    else if (/^>{7}(?: |$)/.test(line) && state === 'theirs') state = 'both';
    else {
      if (state === 'both' || state === 'ours') ours.push(line);
      if (state === 'both' || state === 'theirs') theirs.push(line);
    }
  }
  return state === 'both' ? [ours.join('\n'), theirs.join('\n')] : null;
}

function storyPath(story: Story): string {
  return `boards/${story.boardId}/stories/${story.key}/story.json`;
}

/** `…/stories/WEB-4/story.json` → `WEB-4`. */
function fileKey(file: string): string {
  return file.split('/').at(-2) ?? '';
}

function numberOf(key: string): number {
  return Number(key.slice(key.lastIndexOf('-') + 1));
}

/** Code-unit order for Ranks, timestamps and paths. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return groups;
}
