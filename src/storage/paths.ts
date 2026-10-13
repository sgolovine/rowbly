import { join } from 'node:path';
import type { DataRoot, Slug, StoryKey } from '../schemas';

export interface DataRootPaths {
  rootConfig: string;
  localState: string;
  boardsDir: string;
  board(board: Slug): string;
  boardConfig(board: Slug): string;
  storiesDir(board: Slug): string;
  storyDir(board: Slug, key: StoryKey): string;
  story(board: Slug, key: StoryKey): string;
  /** A Plugin's folder at the Data Root, Board or Story level (ADR-0013). */
  rootPlugin(id: string): string;
  boardPlugin(board: Slug, id: string): string;
  storyPlugin(board: Slug, key: StoryKey, id: string): string;
}

/** Absolute paths for every file and folder in the Data Root layout (contracts §1). */
export function paths(root: DataRoot): DataRootPaths {
  const boardsDir = join(root.path, 'boards');
  const board = (b: Slug) => join(boardsDir, b);
  const storiesDir = (b: Slug) => join(board(b), 'stories');
  const storyDir = (b: Slug, key: StoryKey) => join(storiesDir(b), key);
  return {
    rootConfig: join(root.path, 'rowbly.config.json'),
    localState: join(root.path, 'local.json'),
    boardsDir,
    board,
    boardConfig: (b) => join(board(b), 'board.config.json'),
    storiesDir,
    storyDir,
    story: (b, key) => join(storyDir(b, key), 'story.json'),
    rootPlugin: (id) => join(root.path, 'plugins', id),
    boardPlugin: (b, id) => join(board(b), 'plugins', id),
    storyPlugin: (b, key, id) => join(storyDir(b, key), 'plugins', id),
  };
}
