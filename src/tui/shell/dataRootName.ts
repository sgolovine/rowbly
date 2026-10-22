import { basename, dirname } from 'node:path';

/**
 * What the header and the Data Root switcher call a Data Root: its label in the Home Config, else
 * "Global" for `~/.rowbly`, else the folder holding `.rowbly` (or the folder itself when it has another name).
 */
export function dataRootName(root: { path: string; label?: string; global?: boolean }): string {
  if (root.label) return root.label;
  if (root.global) return 'Global';
  const base = basename(root.path);
  return (base === '.rowbly' ? basename(dirname(root.path)) : base) || root.path;
}

/** `path` with the home folder written `~`, to keep rows short. */
export function tildePath(path: string, home: string): string {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
