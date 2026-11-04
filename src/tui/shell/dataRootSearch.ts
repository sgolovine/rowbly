import { fuzzySearch } from '../../core';
import type { KnownDataRootChoice } from '../../services';
import type { KeyHint } from '../keymap';
import { dataRootName, tildePath } from './dataRootName';

/**
 * The known Data Roots matching `query`, best first, by name, full path or `~` path. Ties keep the
 * order given (the sort is stable); an empty query keeps them all.
 */
export function searchDataRoots(
  roots: readonly KnownDataRootChoice[],
  query: string,
  home: string,
): KnownDataRootChoice[] {
  return fuzzySearch(
    roots,
    query,
    (root) => [dataRootName(root), root.path, tildePath(root.path, home)],
    () => 0,
  );
}

/** The list's keys: typing starts the search, `esc` clears and leaves it. */
export function dataRootSearchHints(query: string | null): KeyHint[] {
  return [
    { key: '↑/↓', description: 'select' },
    { key: 'enter', description: 'open' },
    query === null ? { key: 'type', description: 'search' } : { key: 'esc', description: 'clear search' },
  ];
}
