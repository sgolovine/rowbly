import { join } from 'node:path';
import type { DataRoot } from '../schemas';
import type { PublicationFile } from './gitSyncJournal';
import { io } from './io';

export type GitDataFiles = Record<string, PublicationFile>;
export function isGitDataPath(path: string): boolean {
  return (
    /^(rowbly.config.json|\.gitignore|boards\/[^/]+\/board.config.json|boards\/[^/]+\/stories\/[^/]+\/story.json)$/.test(
      path,
    ) || /^(?:boards\/[^/]+\/(?:stories\/[^/]+\/)?)?plugins\/[^/]+\/.+/.test(path)
  );
}
/** A complete bounded immutable root capture. No Git child, ignore decision or schema round-trip. */
export async function readGitDataFiles(root: DataRoot): Promise<GitDataFiles> {
  const files: GitDataFiles = {};
  let total = 0;
  const walk = async (path: string) => {
    for (const name of (await io.readdir(join(root.path, path))).sort()) {
      if (!path && !['rowbly.config.json', '.gitignore', 'boards', 'plugins'].includes(name)) continue;
      const relative = path ? `${path}/${name}` : name;
      const info = await io.lstat(join(root.path, relative));
      if (info.isSymbolicLink()) throw new Error(`Git synchronization refuses a linked Rowbly path: ${relative}`);
      if (info.isDirectory()) {
        await walk(relative);
        continue;
      }
      if (!isGitDataPath(relative)) continue;
      if (!info.isFile()) throw new Error(`Unsupported Rowbly file kind: ${relative}`);
      const bytes = await io.readBytes(join(root.path, relative));
      total += bytes.length;
      if (Object.keys(files).length >= 4096 || total > 64 * 1024 * 1024)
        throw new Error('Git synchronization exceeds its bounded Data Root size');
      files[relative] = { data: bytes.toString('base64'), mode: info.mode & 0o111 ? '100755' : '100644' };
    }
  };
  await walk('');
  return files;
}
