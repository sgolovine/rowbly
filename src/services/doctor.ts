import type { ZodType } from 'zod';
import { formatStoryKey, isRowblyError, isSlug, ranksBetween, STORY_KEY_RE, toTimestamp } from '../core';
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
import {
  CONFLICT_MARKER_RE,
  cascade,
  listDataRootFiles,
  type Repositories,
  readDataRootFile,
  recoverTransactions,
  removeDataRootFile,
  writeTextFile,
} from '../storage';
import { fieldValueError } from './_customFieldValues';
import { type RecoveryOutcome, withMutation, withRecovery } from './coordination';
import type { CoreChangeSet } from './plugins/changeSet';
import { invokePlugin } from './plugins/invoke';
import { deepMerge, type OperationRunner } from './plugins/runtime';
import type { DoctorData } from './plugins/types';
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
  UNKNOWN_FIELD: 'warning',
  INVALID_FIELD_VALUE: 'warning',
  MISSING_REQUIRED_FIELD: 'warning',
  DUPLICATE_RANK: 'warning',
  STALE_LOCAL_STATE: 'warning',
  UNKNOWN_FILE: 'info',
  PLUGIN_FAILED: 'error',
  PLUGIN_DATA_INVALID: 'warning',
  PLUGIN_DATA_UNCHECKED: 'info',
  TRANSACTION_PENDING: 'error',
  TRANSACTION_LEFTOVER: 'warning',
  TEMP_FILE_LEFTOVER: 'warning',
  GITIGNORE_INCOMPLETE: 'info',
  ORPHAN_FOLDER: 'warning',
  LEGACY_DATA: 'warning',
};

/** Repairs that change which file or key a Story has; they run as a pass of their own (RES-09). */
const STRUCTURAL: ReadonlySet<CoreDoctorCode> = new Set(['DUPLICATE_KEY', 'STORY_KEY_CONFLICT']);

/** What the Data Root's .gitignore lists (ADR-0019 §2). */
const GITIGNORE_LINES = ['local.json', '.lock', '.lock.break', '.txn/'];

/** A Plugin's local finding code: uppercase words joined by `_`. */
const LOCAL_CODE_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/** A temporary file of an atomic write (`.<name>.<8 hex>.tmp`), and a folder of the old move code. */
const TEMP_FILE_RE = /^\.[^/]+\.[0-9a-f]{8}\.tmp$/;
const MOVING_RE = /^\.[0-9a-f]{8}\.moving$/;

/** Fixes can uncover new findings (e.g. two renumbered Stories sharing a Rank), so `fix()` repeats. */
const MAX_FIX_PASSES = 5;

/**
 * A finding plus, when fixable, the in-memory change that fixes it (`flush` puts those into the
 * Change Set), or a Plugin's fix, which works on the Change Set itself.
 */
interface Finding extends DoctorFinding {
  apply?: () => string;
  pluginFix?: (changes: CoreChangeSet) => Promise<string>;
  /** A fix outside the records, such as removing a leftover file; it runs after its pass saved. */
  cleanup?: () => Promise<string>;
  /** The Plugin that reported the finding: its exact id, never parsed back from the code (CQ-70). */
  pluginId?: string;
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
  /** The file holds data of an older Rowbly, which saving would drop: doctor never saves it. */
  legacy: boolean;
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

  async function analyze(recovery: RecoveryOutcome): Promise<Model> {
    const findings: Finding[] = [];
    const add = (code: CoreDoctorCode, path: string, message: string, extra: Partial<Finding> = {}) => {
      const { apply, cleanup, details } = extra;
      findings.push({
        code,
        severity: SEVERITY[code],
        path,
        message,
        fixable: apply !== undefined || cleanup !== undefined,
        ...(details ? { details } : {}),
        ...(apply ? { apply } : {}),
        ...(cleanup ? { cleanup } : {}),
      });
    };
    const local = { state: { version: 1 } as LocalState, dirty: false };
    // A transaction that recovery cannot finish is the one thing doctor reports (ADR-0019 §2).
    if (recovery.failure !== undefined) {
      add('TRANSACTION_PENDING', ...pendingTransaction(recovery.failure));
      return { findings, boards: [], local };
    }
    const pluginData: PluginDataSeen = new Map();
    /** Story files that hold data of an older Rowbly: doctor never saves them (VER-03). */
    const legacyFiles = new Set<string>();
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

    // 0. Rowbly's own leftovers: transaction folders recovery could not remove, temporary files of
    // atomic writes, and folders of the old move code (ADR-0019 §9). None of them is a layout file.
    const leftovers = new Set<string>();
    const moving = new Map<string, string[]>();
    for (const file of files) {
      const parts = file.split('/');
      if (parts[0] === '.txn' && parts.length >= 2) {
        leftovers.add(`.txn/${parts[1]}`);
        continue;
      }
      const at = parts.findIndex((part) => MOVING_RE.test(part));
      if (at >= 0) {
        const folder = parts.slice(0, at + 1).join('/');
        moving.set(folder, [...(moving.get(folder) ?? []), parts.slice(at + 1).join('/')]);
        continue;
      }
      if (TEMP_FILE_RE.test(parts.at(-1) ?? '')) {
        add('TEMP_FILE_LEFTOVER', file, 'temporary file of an interrupted write; the file beside it is intact', {
          cleanup: async () => {
            await removeDataRootFile(ctx.root, file);
            return `removed ${file}`;
          },
        });
      }
    }
    for (const folder of leftovers) {
      add('TRANSACTION_LEFTOVER', folder, 'folder of a finished or abandoned commit that could not be removed', {
        cleanup: async () => {
          await recoverTransactions(ctx.root.path);
          return `removed ${folder}`;
        },
      });
    }
    for (const [folder, inside] of moving) {
      const key = inside.includes('story.json') ? await movingStoryKey(`${folder}/story.json`) : null;
      const home = folder.slice(0, folder.lastIndexOf('/'));
      add(
        'TEMP_FILE_LEFTOVER',
        folder,
        key
          ? `holds Story ${key} from an interrupted move; Rowbly does not list it. Move it back to ${home}/${key} if that folder is free, then run \`rowbly doctor\``
          : 'holds files from an interrupted move and no Story; check them, then delete the folder',
        { details: { files: inside.length, ...(key ? { key } : {}) } },
      );
    }
    const layoutFiles = files.filter(
      (file) =>
        !file.startsWith('.txn/') &&
        !file.split('/').some((part) => MOVING_RE.test(part)) &&
        !TEMP_FILE_RE.test(file.split('/').at(-1) ?? ''),
    );

    // 1. Sort every file into the layout (contracts §1); anything else is unknown. Plugin files are
    // in `plugins/<id>/` folders of the Data Root, a Board or a Story (ADR-0013).
    /** Story folders with any file, and Board folders with any file, to find folders without a record. */
    const storyFolders = new Map<string, Set<string>>();
    const boardFolders = new Map<string, Set<string>>();
    const holding = (folders: Map<string, Set<string>>, folder: string, plugin: string | null) => {
      const ids = folders.get(folder) ?? new Set<string>();
      if (plugin) ids.add(plugin);
      folders.set(folder, ids);
    };
    for (const file of layoutFiles) {
      const parts = file.split('/');
      const [top, id = '', sub, key = '', name, plugin = ''] = parts;
      if (parts.length === 1 && ['rowbly.config.json', 'local.json', '.gitignore'].includes(file)) continue;
      if (top === 'plugins' && parts.length >= 3 && isSlug(id)) {
        seen(id, file, 'files');
        continue;
      }
      if (top === 'epics' && parts.length === 2 && file.endsWith('.json')) {
        add('LEGACY_DATA', file, 'Epic file from a Rowbly before ADR-0008; Rowbly no longer reads it', {
          details: { hint: 'the Epics Plugin keeps Epics in plugins/epics/; nothing is imported (ADR-0014)' },
        });
        continue;
      }
      if (top === 'boards' && isSlug(id)) {
        holding(boardFolders, `boards/${id}`, sub === 'plugins' && isSlug(key) ? key : null);
        if (sub === 'stories' && STORY_KEY_RE.test(key) && parts.length >= 5) {
          holding(storyFolders, `boards/${id}/stories/${key}`, name === 'plugins' && isSlug(plugin) ? plugin : null);
        }
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
      const text = await readDataRootFile(ctx.root, 'rowbly.config.json');
      global = parse('rowbly.config.json', text, RowblyConfigSchema);
      if (global && hasLegacyRoster(text)) {
        add(
          'LEGACY_DATA',
          'rowbly.config.json',
          'holds an Assignee roster from an older Rowbly; Rowbly drops it the next time it saves this file',
          {
            details: {
              fields: ['assignees'],
              hint: 'back up the file first; Assignees are a Plugin now and nothing is imported',
            },
          },
        );
      }
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

    // Folders that hold files but no record: never adopted, never removed (RES-07).
    const plugins = (ids: Set<string>) =>
      ids.size > 0 ? `files of Plugin${ids.size === 1 ? '' : 's'} ${[...ids].sort().join(', ')}` : 'files';
    for (const [folder, ids] of boardFolders) {
      const hasStories = [...fileSet].some((f) => f.startsWith(`${folder}/stories/`) && f.endsWith('/story.json'));
      if (fileSet.has(`${folder}/board.config.json`) || hasStories) continue;
      add('ORPHAN_FOLDER', folder, `holds ${plugins(ids)} but no board.config.json; Rowbly ignores it`, {
        details: {
          plugins: [...ids].sort(),
          hint: 'restore board.config.json from Git or a backup, or delete the folder',
        },
      });
    }
    for (const [folder, ids] of storyFolders) {
      if (
        fileSet.has(`${folder}/story.json`) ||
        !fileSet.has(`${folder.split('/').slice(0, 2).join('/')}/board.config.json`)
      )
        continue;
      add(
        'ORPHAN_FOLDER',
        folder,
        `holds ${plugins(ids)} but no story.json; its Story Key stays reserved and no new Story gets these files`,
        {
          details: { plugins: [...ids].sort(), hint: 'restore story.json from Git or a backup, or delete the folder' },
        },
      );
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
      // An orphan Story folder keeps its key too: renumbering never moves a Story into it (RES-07).
      for (const folder of storyFolders.keys()) {
        if (folder.startsWith(`${board.dir}/stories/`))
          board.used.add(numberOf(folder.slice(folder.lastIndexOf('/') + 1)));
      }
      for (const file of board.storyFiles) {
        const text = await readDataRootFile(ctx.root, file);
        const legacy = legacyFields(text);
        if (legacy.length > 0) {
          legacyFiles.add(file);
          add(
            'LEGACY_DATA',
            file,
            `holds ${legacy.join(', ')} from an older Rowbly; Rowbly drops them the next time it saves this Story`,
            {
              details: {
                fields: legacy,
                hint: 'back up the file before changing the Story; Assignees, Comments and Epics are Plugins now and nothing is imported',
              },
            },
          );
        }
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
        board.stories.push({ story, original: story, file, dirty: false, legacy: legacyFiles.has(file) });
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

    // 5. References and Custom Fields, Story by Story.
    for (const board of boards.values()) {
      if (!global || !board.config) continue;
      const effective = cascade(global, board.config);
      const stageKeys = new Set(effective.stages.map((s) => s.key));
      for (const entry of board.stories) {
        const { story } = entry;
        const file = entry.file;
        if (!stageKeys.has(story.stage)) {
          add('UNKNOWN_STAGE', file, `${story.key} is in unknown Stage "${story.stage}"`, {
            details: { hint: `run \`rowbly stories move ${story.key} <stage>\`` },
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
                if (touch(entry, { rank: ranks[k] ?? entry.story.rank })) moved.push(entry.story.key);
              });
              i = end;
            }
            return `re-ranked ${moved.join(', ')} in Stage "${stage}", keeping the current order`;
          },
        });
      }
    }

    // 6. Local State.
    if (fileSet.has('local.json')) {
      const state = parse('local.json', await readDataRootFile(ctx.root, 'local.json'), LocalStateSchema);
      if (state) {
        local.state = state;
        if (state.board !== undefined && !fileSet.has(`boards/${state.board}/board.config.json`)) {
          add('STALE_LOCAL_STATE', 'local.json', `current Board "${state.board}" does not exist`, {
            apply: () => {
              const { board: removed, ...rest } = local.state;
              local.state = rest;
              local.dirty = true;
              return `cleared board "${removed}" from Local State`;
            },
          });
        }
      }
    }

    // 7. Plugins: failed loads, the checks of Plugins that are on, and the data of the others.
    const entries = [...boards.values()].flatMap((b) => b.stories);
    const valid = {
      config: global,
      boards: [...boards.values()].flatMap((b) => (b.config ? [b.config] : [])),
      // Plugin checks see only Stories stored at their key's path. A duplicate is checked after the
      // structural pass renumbers it, so a key-addressed fix never reaches another Story (RES-09).
      stories: entries.filter((e) => e.file === storyPath(e.story)).map((e) => e.story),
      local: local.state,
    };
    if (global) {
      for (const [id, entry] of Object.entries(global.plugins ?? {})) {
        if (Object.keys(entry).some((k) => k !== 'enabled')) seen(id, 'rowbly.config.json', 'records');
      }
    }
    for (const board of valid.boards) bagsSeen(board, `boards/${board.id}/board.config.json`);
    for (const { story, file } of entries) bagsSeen(story, file);
    bagsSeen(local.state, 'local.json');
    findings.push(...(await pluginFindings(valid, entries, local.state, pluginData)));

    // 8. The .gitignore of a Data Root under Git lists the lock and the journal (ADR-0019 §2).
    if (fileSet.has('.gitignore')) {
      const text = await readDataRootFile(ctx.root, '.gitignore');
      const lines = new Set(text.split(/\r?\n/).map((line) => line.trim()));
      const missing = GITIGNORE_LINES.filter((line) => !lines.has(line));
      if (missing.length > 0) {
        add('GITIGNORE_INCOMPLETE', '.gitignore', `does not list ${missing.join(', ')}, which are never Git data`, {
          details: { missing },
          cleanup: async () => {
            const current = await readDataRootFile(ctx.root, '.gitignore');
            const base = current === '' || current.endsWith('\n') ? current : `${current}\n`;
            await writeTextFile(`${ctx.root.path}/.gitignore`, `${base}${missing.join('\n')}\n`);
            return `added ${missing.join(', ')} to .gitignore`;
          },
        });
      }
    }

    // Saving a file with legacy data would drop that data, so its record fixes are left to a person.
    for (const finding of findings) {
      if (!finding.apply || !legacyFiles.has(finding.path)) continue;
      delete finding.apply;
      finding.fixable = false;
    }

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
        { story: first, original: null, file, dirty: true, legacy: false },
        { story: renumbered, original: null, file, dirty: true, legacy: false },
      );
      return `kept ${first.key} ("${first.name}") and renumbered "${second.name}" to ${renumbered.key}`;
    }
  }

  /** The Story Key in a `.moving` folder's story.json, or `null` when it cannot be read. */
  async function movingStoryKey(file: string): Promise<string | null> {
    try {
      const key = (JSON.parse(await readDataRootFile(ctx.root, file)) as { key?: unknown }).key;
      return typeof key === 'string' && STORY_KEY_RE.test(key) ? key : null;
    } catch {
      return null;
    }
  }

  /** Gives `story` the next free key on its Board. */
  function renumber(board: BoardEntry, story: Story): Story {
    const n = Math.max(0, ...board.used) + 1;
    board.used.add(n);
    const key = formatStoryKey(board.config?.keyPrefix ?? '', n);
    return { ...story, key, updatedAt: now() };
  }

  /** Changes a Story in memory; returns false for one doctor never saves (legacy data). */
  function touch(entry: StoryEntry, patch: Partial<Story>): boolean {
    if (entry.legacy) return false;
    entry.story = { ...entry.story, ...patch, updatedAt: now() };
    entry.dirty = true;
    return true;
  }

  /**
   * `PLUGIN_FAILED` for each Plugin that failed to load; for each Plugin that is on, its bags checked
   * against its schemas and its own checks; and one info finding for each other Plugin with data.
   */
  async function pluginFindings(
    data: DoctorData,
    entries: readonly StoryEntry[],
    local: LocalState,
    seen: PluginDataSeen,
  ): Promise<Finding[]> {
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
      check(bags.local, local.plugins?.[id], 'local.json', 'Local State');
      // Every Story's bags, at the file it was read from: a duplicate's path is its own folder.
      for (const { story, file } of entries) check(bags.story, story.plugins?.[id], file, story.key);
      if (!doctor) continue;
      const context = ops.hookContext(id);
      const prefix = `${id.toUpperCase().replaceAll('-', '_')}_`;
      try {
        const found = await invokePlugin({ plugin: id, stage: 'doctor-check', operation: 'doctor.check' }, () =>
          doctor.check({ data, plugin: context }),
        );
        for (const finding of found) {
          const code = `${prefix}${finding.code}`;
          const refused = refusedCode(id, finding.code, code);
          if (refused) {
            findings.push(
              coreFinding('PLUGIN_FAILED', 'rowbly.config.json', refused, { plugin: id, code: finding.code }),
            );
            continue;
          }
          const { fix } = finding;
          findings.push({
            code,
            severity: finding.severity,
            path: finding.path,
            message: finding.message,
            fixable: fix !== undefined,
            // The framework's attribution wins over what the Plugin put in its details (ARCH-09).
            details: { ...finding.details, plugin: id },
            pluginId: id,
            ...(fix
              ? {
                  pluginFix: (changes: CoreChangeSet) =>
                    invokePlugin({ plugin: id, stage: 'doctor-fix', operation: 'doctor.fix' }, (scope) =>
                      fix(changes.forPlugin(id, scope)),
                    ),
                }
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
    for (const entry of model.boards.flatMap((b) => b.stories).filter((e) => e.dirty && !e.legacy)) {
      changes.recordStory(entry.original, entry.story, entry.file.slice(0, entry.file.lastIndexOf('/')));
    }
    if (model.local.dirty) await changes.updateLocalState(() => model.local.state);
  }

  /**
   * One `--fix` pass, planned and saved under the Data Root lock (RES-02): structural key repairs
   * alone when there are any, else every other fix. Returns what it fixed, or `null` when nothing is
   * left to fix (with the final findings in `last`).
   */
  async function fixPass(last: { model?: Model }): Promise<DoctorFix[] | null> {
    const outcome = await withRecovery(ctx.root, 'doctor.fix', async (recovery) => {
      const finished: DoctorFix[] = (recovery.report?.finished ?? []).map(({ id, operation }) => ({
        code: 'TRANSACTION_PENDING',
        path: `.txn/${id}`,
        message: `finished ${operation} (transaction ${id})`,
      }));
      for (const id of recovery.report?.removed ?? []) {
        finished.push({ code: 'TRANSACTION_LEFTOVER', path: `.txn/${id}`, message: `removed .txn/${id}` });
      }
      const model = await analyze(recovery);
      last.model = model;
      const fixable = model.findings.filter((f) => f.apply || f.pluginFix || f.cleanup);
      const structural = fixable.filter((f) => STRUCTURAL.has(f.code as CoreDoctorCode));
      // Renumbering first, as its own operation; the next pass analyzes the renumbered Stories (RES-09).
      const chosen = structural.length > 0 ? structural : fixable;
      if (chosen.length === 0) return { fixed: finished, more: false };
      // Each pass is one operation, so Plugins can guard, transform and react to fixes too.
      const done = await ops.run('doctor.fix', { findings: report(chosen, []).findings }, async (changes) => {
        const pass: DoctorFix[] = [];
        for (const finding of chosen) {
          if (finding.apply) pass.push({ code: finding.code, path: finding.path, message: finding.apply() });
        }
        await flush(model, changes);
        for (const finding of chosen) {
          if (!finding.pluginFix) continue;
          pass.push({ code: finding.code, path: finding.path, message: await finding.pluginFix(changes) });
        }
        return pass;
      });
      // Leftover files go once the guarded pass has saved.
      const cleaned = await withMutation(ctx.root, 'doctor.fix', async () => {
        const out: DoctorFix[] = [];
        for (const finding of chosen) {
          if (finding.cleanup) out.push({ code: finding.code, path: finding.path, message: await finding.cleanup() });
        }
        return out;
      });
      return { fixed: [...finished, ...done, ...cleaned], more: true };
    });
    return outcome.more || outcome.fixed.length > 0 ? outcome.fixed : null;
  }

  return {
    check: () =>
      withRecovery(ctx.root, 'doctor.check', async (recovery) => report((await analyze(recovery)).findings, [])),

    async fix() {
      const fixed: DoctorFix[] = [];
      const last: { model?: Model } = {};
      try {
        // Bounded: after MAX_FIX_PASSES the remaining findings are reported, fixable or not.
        for (let pass = 0; pass < MAX_FIX_PASSES; pass++) {
          const done = await fixPass(last);
          if (done === null) break;
          fixed.push(...done);
          if (last.model?.findings.some((f) => f.code === 'TRANSACTION_PENDING')) break;
        }
      } catch (err) {
        // The failed pass saved nothing; the passes before it did, and the error says which.
        if (isRowblyError(err)) Object.assign(err.details, { committed: fixed });
        throw err;
      }
      const final = await withRecovery(ctx.root, 'doctor.check', analyze);
      return report(final.findings, fixed);
    },
  };
}

function coreFinding(code: CoreDoctorCode, path: string, message: string, details: Record<string, unknown>): Finding {
  return { code, severity: SEVERITY[code], path, message, fixable: false, details };
}

/**
 * Why a Plugin's finding code is refused, or `undefined`: a local code is uppercase words joined
 * by `_`, and the prefixed code must not read as a core code (ARCH-09).
 */
function refusedCode(id: string, local: string, code: string): string | undefined {
  if (!LOCAL_CODE_RE.test(local)) {
    return `Plugin "${id}" reported a finding with code "${local}": codes are uppercase words joined by "_"`;
  }
  if (code in SEVERITY)
    return `Plugin "${id}" reported a finding with code "${local}", which would read as core code ${code}`;
  return undefined;
}

/** The finding for a transaction recovery could not finish, from the recovery error. */
function pendingTransaction(failure: unknown): [path: string, message: string, extra: Partial<Finding>] {
  const details = isRowblyError(failure) ? failure.details : {};
  const id = typeof details.transaction === 'string' ? details.transaction : 'unknown';
  const operation = typeof details.operation === 'string' ? details.operation : 'an operation';
  const pending = Array.isArray(details.pending) ? (details.pending as string[]) : [];
  const cause = typeof details.cause === 'string' ? details.cause : messageOf(failure);
  return [
    `.txn/${id}`,
    `${operation} (transaction ${id}) was saved only in part and recovery could not finish it: ${cause}. Pending: ${pending.join(', ') || 'none'}`,
    {
      details: {
        transaction: id,
        operation,
        pending,
        cause,
        hint: 'fix the cause (for example file permissions), then run `rowbly doctor --fix`',
      },
    },
  ];
}

/** The fields of an older Rowbly in a Story file's raw JSON, before the schema drops them (VER-03). */
function legacyFields(text: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof raw !== 'object' || raw === null) return [];
  const story = raw as { assignees?: unknown; comments?: unknown; epicId?: unknown };
  const fields: string[] = [];
  if (story.assignees !== undefined) fields.push('assignees');
  if (story.comments !== undefined) fields.push('comments');
  if (story.epicId !== undefined) fields.push('epicId');
  return fields;
}

/** Whether the raw `rowbly.config.json` still has the roster of a Rowbly before the Assignees Plugin. */
function hasLegacyRoster(text: string): boolean {
  try {
    const raw: unknown = JSON.parse(text);
    return typeof raw === 'object' && raw !== null && 'assignees' in raw;
  } catch {
    return false;
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
    .map(({ apply: _apply, pluginFix: _pluginFix, cleanup: _cleanup, pluginId: _pluginId, ...finding }) => finding)
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
