// Reading and writing the roster, `plugins/assignees/roster.json` in the Data Root. A missing file is
// an empty roster. A stored file that cannot be read is `DataIntegrityError` (exit 6) with its path;
// it is never rewritten or treated as empty.
import { DataIntegrityError, type PluginChangeSet, type PluginReadContext } from '../../plugin-api';
import { type Assignee, formatIssues, RosterSchema, validate } from './model';

export const ROSTER_FILE = 'roster.json';
export const ROSTER_PATH = `plugins/assignees/${ROSTER_FILE}`;

/** A line starting with a git conflict marker, as core's JSON store detects it. */
const CONFLICT_MARKER = /^<{7}(?: |$)/m;

/** Reads the stored roster file; `null` when it does not exist. */
export type RosterReader = (name: string) => Promise<string | null>;

/** The Assignees of the stored roster text, or why it cannot be read. */
export function parseRoster(text: string): { assignees: Assignee[] } | { problem: string } {
  if (CONFLICT_MARKER.test(text)) return { problem: 'file has git conflict markers' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { problem: `file is not valid JSON (${(err as Error).message})` };
  }
  const version = (data as { version?: unknown } | null)?.version;
  if (typeof version === 'number' && version > 1) {
    return { problem: `file is roster version ${version}; this Rowbly reads version 1` };
  }
  const parsed = RosterSchema.safeParse(data);
  if (!parsed.success) return { problem: `file is not a valid roster: ${formatIssues(parsed.error.issues)}` };
  return { assignees: parsed.data.assignees };
}

/** The roster, in the order Assignees were added; `DATA_INTEGRITY` when the file cannot be read. */
export async function readRoster(read: RosterReader): Promise<Assignee[]> {
  const text = await read(ROSTER_FILE);
  if (text === null) return [];
  const roster = parseRoster(text);
  if ('assignees' in roster) return roster.assignees;
  throw new DataIntegrityError(`The Assignee roster is unavailable: ${ROSTER_PATH}: ${roster.problem}`, {
    details: { path: ROSTER_PATH },
    hint: 'run `rowbly doctor`; fix the file by hand, it is kept as it is',
  });
}

/** The stored roster. */
export function listAssignees(plugin: PluginReadContext): Promise<Assignee[]> {
  return readRoster((name) => plugin.files.read('dataRoot', name));
}

/** The roster as this Change Set will save it. */
export function pendingRoster(changes: Pick<PluginChangeSet, 'readFile'>): Promise<Assignee[]> {
  return readRoster((name) => changes.readFile('dataRoot', name));
}

/** Writes the roster: validated, two-space JSON in schema key order, with a final newline. */
export async function writeRoster(changes: PluginChangeSet, assignees: Assignee[]): Promise<void> {
  const roster = validate(RosterSchema, { version: 1, assignees }, 'roster');
  await changes.writeFile('dataRoot', ROSTER_FILE, `${JSON.stringify(roster, null, 2)}\n`);
}
