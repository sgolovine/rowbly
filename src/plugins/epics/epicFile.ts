// Reading and writing Epic files, `plugins/epics/<id>.json` in the Data Root. Each file is parsed on
// its own, so one corrupt Epic never hides the others (RES-12). A stored file that cannot be read as
// an Epic is `DataIntegrityError` (exit 6) with its path; it is never rewritten or treated as absent.
import { DataIntegrityError, NotFoundError, type PluginChangeSet, type PluginFiles, type z } from '../../plugin-api';
import { type Epic, EpicSchema, formatIssues, validate } from './model';

export const EPIC_FILE_EXTENSION = '.json';

const EpicId = EpicSchema.pick({ id: true });

/** A line starting with a git conflict marker, as core's JSON store detects it. */
const CONFLICT_MARKER = /^<{7}(?: |$)/m;

/** Why a stored Epic file cannot be read. Doctor reports each as its own finding. */
export type EpicFileProblem =
  | 'unreadable'
  | 'conflict-markers'
  | 'invalid-json'
  | 'unsupported-version'
  | 'schema-invalid'
  | 'id-mismatch';

/** An Epic file that cannot be read as an Epic: shown as unavailable, reported by doctor, kept as it is. */
export interface UnavailableEpic {
  id: string;
  /** Relative to the Data Root. */
  path: string;
  problem: EpicFileProblem;
  message: string;
  issues?: readonly z.core.$ZodIssue[];
}

export type EpicFile = { id: string; path: string; epic: Epic } | UnavailableEpic;

/** Reads one stored file; `null` when it does not exist. */
export type EpicReader = (name: string) => Promise<string | null>;

export function epicFileName(id: string): string {
  return `${id}${EPIC_FILE_EXTENSION}`;
}

export function epicFilePath(id: string): string {
  return `plugins/epics/${epicFileName(id)}`;
}

/** The Epic ID a file of the Data Root folder stands for; `undefined` for other files. */
function epicIdOf(name: string): string | undefined {
  if (name.includes('/') || !name.endsWith(EPIC_FILE_EXTENSION)) return undefined;
  return name.slice(0, -EPIC_FILE_EXTENSION.length);
}

/** Parses the stored text of Epic `id`. */
export function parseEpicFile(id: string, text: string): EpicFile {
  const path = epicFilePath(id);
  const unavailable = (problem: EpicFileProblem, message: string, issues?: readonly z.core.$ZodIssue[]) => ({
    id,
    path,
    problem,
    message,
    ...(issues ? { issues } : {}),
  });
  if (CONFLICT_MARKER.test(text)) return unavailable('conflict-markers', 'file has git conflict markers');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return unavailable('invalid-json', `file is not valid JSON (${(err as Error).message})`);
  }
  const version = (data as { version?: unknown } | null)?.version;
  if (typeof version === 'number' && version > 1) {
    return unavailable('unsupported-version', `file is Epic version ${version}; this Rowbly reads version 1`);
  }
  const parsed = EpicSchema.safeParse(data);
  if (!parsed.success) {
    return unavailable('schema-invalid', `file is not a valid Epic: ${formatIssues(parsed.error.issues)}`, [
      ...parsed.error.issues,
    ]);
  }
  if (parsed.data.id !== id) {
    return unavailable('id-mismatch', `file holds Epic "${parsed.data.id}"; its file name says "${id}"`);
  }
  return { id, path, epic: parsed.data };
}

/** The error for an Epic that is stored but cannot be read. */
export function unavailableEpicError(file: UnavailableEpic): DataIntegrityError {
  return new DataIntegrityError(`Epic "${file.id}" is unavailable: ${file.path}: ${file.message}`, {
    details: {
      path: file.path,
      problem: file.problem,
      ...(file.issues ? { issues: file.issues } : {}),
    },
    hint: 'run `rowbly doctor`; fix the file by hand, it is kept as it is',
  });
}

export function isUnavailable(file: EpicFile): file is UnavailableEpic {
  return !('epic' in file);
}

/** Epic `id`: `NOT_FOUND` when there is no file, `DATA_INTEGRITY` when it cannot be read. */
export async function readEpic(read: EpicReader, id: string): Promise<Epic> {
  validate(EpicId, { id }, 'Epic ID');
  const text = await read(epicFileName(id));
  if (text === null) throw new NotFoundError(`Epic "${id}" not found`);
  const file = parseEpicFile(id, text);
  if (isUnavailable(file)) throw unavailableEpicError(file);
  return file.epic;
}

/** Every Epic file of the Data Root, sorted by ID, each read on its own. */
export async function readEpicFiles(files: PluginFiles): Promise<EpicFile[]> {
  const ids = (await files.list('dataRoot')).flatMap((name) => epicIdOf(name) ?? []);
  return Promise.all(
    ids.map(async (id): Promise<EpicFile> => {
      try {
        const text = await files.read('dataRoot', epicFileName(id));
        if (text !== null) return parseEpicFile(id, text);
        return { id, path: epicFilePath(id), problem: 'unreadable', message: 'file disappeared while reading' };
      } catch (err) {
        return { id, path: epicFilePath(id), problem: 'unreadable', message: (err as Error).message };
      }
    }),
  );
}

/** Writes `epic` to its file: validated, two-space JSON in schema key order, with a final newline. */
export async function writeEpic(changes: PluginChangeSet, epic: Epic): Promise<void> {
  const checked = validate(EpicSchema, epic, 'Epic');
  await changes.writeFile('dataRoot', epicFileName(checked.id), `${JSON.stringify(checked, null, 2)}\n`);
}
