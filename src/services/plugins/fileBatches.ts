// Batched Plugin file reads (ADR-0052): many reads in a few read scopes (ADR-0019 §5), each scope
// bounded by a number of requests, and no Plugin code running while one holds the Data Root lock.
import { isSlug, NotFoundError, parseStoryKey, ValidationError } from '../../core';
import type { DataRoot } from '../../schemas';
import {
  type Repositories,
  readPluginFile as storedPluginFile,
  listPluginFiles as storedPluginFiles,
} from '../../storage';
import { coordinated } from '../coordination';
import { checkName, scopeFolder } from './changeSet';
import type { FileScope, PluginFileFailure, PluginFileList, PluginFileRead, PluginFileRequest } from './types';

/** At most this many `readMany` requests are read in one read scope. */
export const READ_BATCH = 32;
/** At most this many `listMany` scopes are listed in one read scope. */
export const LIST_BATCH = 32;
/**
 * A `listMany` read scope takes no further scope once this many names were listed. It is checked
 * after each whole scope, so one scope can list more: a soft stop, not a bound on names or time.
 */
export const LIST_NAMES_SOFT_STOP = 256;

/** `PluginFiles.readMany` of Plugin `id`. */
export async function readPluginFiles(
  root: DataRoot,
  repos: Repositories,
  id: string,
  requests: readonly PluginFileRequest[],
): Promise<PluginFileRead[]> {
  // Every request is checked before anything is read, as `read` checks its one.
  const checked = requests.map(({ scope, name }) => ({ scope: checkScope(scope), name: checkName(name) }));
  const results: PluginFileRead[] = [];
  for (let at = 0; at < checked.length; at += READ_BATCH) {
    const batch = checked.slice(at, at + READ_BATCH);
    // One read scope per batch, released before the next: callers queued for the lock meanwhile go first.
    const read = await coordinated(root, `${id}.files.readMany`, async () => {
      const folders = folderCache(root, repos);
      const files = new Map<string, Promise<PluginFileRead>>();
      const out: PluginFileRead[] = [];
      for (const { scope, name } of batch) {
        const key = `${scopeKey(scope)}\n${name}`;
        let file = files.get(key);
        if (!file) {
          file = readOne(folders, id, scope, name);
          files.set(key, file);
        }
        out.push(await file);
      }
      return out;
    });
    results.push(...read);
  }
  return results;
}

/** `PluginFiles.listMany` of Plugin `id`. */
export async function listPluginFilesMany(
  root: DataRoot,
  repos: Repositories,
  id: string,
  scopes: readonly FileScope[],
): Promise<PluginFileList[]> {
  const checked = scopes.map(checkScope);
  const results: PluginFileList[] = [];
  while (results.length < checked.length) {
    const from = results.length;
    const listed = await coordinated(root, `${id}.files.listMany`, async () => {
      const folders = folderCache(root, repos);
      const out: PluginFileList[] = [];
      let names = 0;
      for (const scope of checked.slice(from, from + LIST_BATCH)) {
        if (names >= LIST_NAMES_SOFT_STOP) break;
        const list = await listOne(folders, id, scope);
        if (list.status === 'found') names += list.names.length;
        out.push(list);
      }
      return out;
    });
    results.push(...listed);
  }
  return results;
}

type Folders = (scope: FileScope) => Promise<string | PluginFileFailure>;

/**
 * The record folder of each scope, resolved once per read scope. A Story or Board that does not exist
 * fails only its entries; any other failure, such as a record that cannot be read, rejects the call.
 */
function folderCache(root: DataRoot, repos: Repositories): Folders {
  const found = new Map<string, Promise<string | PluginFileFailure>>();
  return (scope) => {
    const key = scopeKey(scope);
    let folder = found.get(key);
    if (!folder) {
      folder = scopeFolder(root, repos, scope).catch((err: unknown) => {
        if (err instanceof NotFoundError) return failed(err.code, err.message);
        throw err;
      });
      found.set(key, folder);
    }
    return folder;
  };
}

async function readOne(folders: Folders, id: string, scope: FileScope, name: string): Promise<PluginFileRead> {
  const folder = await folders(scope);
  if (typeof folder !== 'string') return folder;
  try {
    const text = await storedPluginFile(folder, id, name);
    return text === null ? { status: 'missing' } : { status: 'found', text };
  } catch (err) {
    return fileFailure(err);
  }
}

async function listOne(folders: Folders, id: string, scope: FileScope): Promise<PluginFileList> {
  const folder = await folders(scope);
  if (typeof folder !== 'string') return folder;
  try {
    return { status: 'found', names: await storedPluginFiles(folder, id) };
  } catch (err) {
    return fileFailure(err);
  }
}

/**
 * The failure of one file or folder: a filesystem error on it, or the symbolic link policy refusing
 * it (ADR-0019 §10). Anything else is not about that file, and rejects the call.
 */
function fileFailure(err: unknown): PluginFileFailure {
  if (err instanceof ValidationError) return failed(err.code, err.message);
  const { errno, code, message } = (err ?? {}) as NodeJS.ErrnoException;
  if (err instanceof Error && typeof errno === 'number' && typeof code === 'string') return failed(code, message);
  throw err;
}

function failed(code: string, message: string): PluginFileFailure {
  return { status: 'failed', code, message };
}

/** `scope`, checked as a single read checks it before it reads anything. */
function checkScope(scope: FileScope): FileScope {
  if (scope === 'dataRoot') return scope;
  if (typeof scope === 'object' && scope !== null && 'board' in scope && isSlug(scope.board)) {
    return { board: scope.board };
  }
  if (typeof scope === 'object' && scope !== null && 'story' in scope && typeof scope.story === 'string') {
    return { story: parseStoryKey(scope.story).key };
  }
  throw new ValidationError(`invalid Plugin file scope ${JSON.stringify(scope)}`, {
    hint: 'use "dataRoot", { board: <id> } or { story: <KEY> }',
  });
}

function scopeKey(scope: FileScope): string {
  if (scope === 'dataRoot') return 'dataRoot';
  return 'board' in scope ? `board:${scope.board}` : `story:${scope.story}`;
}
