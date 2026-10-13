import { join } from 'node:path';
import type { DataRoot, Slug, StoryKey } from '../schemas';

export interface DataRootPaths {
  rootConfig: string;
  localState: string;
  boardsDir: string;
  board(board: Slug): string;
  boardConfig(board: Slug): string;
  storiesDir(board: Slug): string;
  story(board: Slug, key: StoryKey): string;
}

/** Absolute paths for every file and folder in the Data Root layout (contracts §1). */
export function paths(root: DataRoot): DataRootPaths {
  const boardsDir = join(root.path, 'boards');
  const board = (b: Slug) => join(boardsDir, b);
  const storiesDir = (b: Slug) => join(board(b), 'stories');
  return {
    rootConfig: join(root.path, 'rowbly.config.json'),
    localState: join(root.path, 'local.json'),
    boardsDir,
    board,
    boardConfig: (b) => join(board(b), 'board.config.json'),
    storiesDir,
    story: (b, key) => join(storiesDir(b), `${key}.json`),
  };
}
