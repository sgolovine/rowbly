// The filesystem calls that the commit engine, atomic writes and the lock make, gathered in one
// object so that tests can inject failures (for example `vi.spyOn(io, 'rename')`) without chmod,
// which does not stop root. Production code calls these through `io.<name>` and never caches them.
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises';

export const io = {
  readFile: (path: string): Promise<string> => readFile(path, 'utf8'),
  readdir: (path: string): Promise<string[]> => readdir(path),
  lstat,
  stat,
  realpath: (path: string): Promise<string> => realpath(path),
  mkdir: (path: string): Promise<string | undefined> => mkdir(path, { recursive: true }),
  rename,
  link,
  unlink,
  rmdir,
  rm: (path: string): Promise<void> => rm(path, { recursive: true, force: true }),

  /**
   * Writes `text` to `path` and fsyncs it. `flag` is `'wx'` (the default: the file must not exist
   * yet) or `'w'`.
   */
  async writeFile(path: string, text: string, flag: 'w' | 'wx' = 'wx'): Promise<void> {
    const handle = await open(path, flag);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  },

  /**
   * Fsyncs a folder so that renames and creations inside it survive a crash. Best effort: skipped on
   * Windows and wherever the platform refuses to sync a folder handle (ADR-0019 §3). A folder that
   * is gone (pruned, or moved on) has nothing to sync.
   */
  async syncDir(path: string): Promise<void> {
    if (process.platform === 'win32') return;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(path, 'r');
      await handle.sync();
    } catch (err) {
      if (!UNSYNCABLE.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
    } finally {
      await handle?.close();
    }
  },
};

const UNSYNCABLE = new Set(['ENOENT', 'EISDIR', 'EPERM', 'EINVAL', 'EBADF', 'EACCES', 'ENOTSUP']);

export function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** Whether anything, a link included, exists at `path`. */
export async function entryExists(path: string): Promise<boolean> {
  try {
    await io.lstat(path);
    return true;
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return false;
    throw err;
  }
}
