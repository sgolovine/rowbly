import { join } from 'node:path';
import type { DataRoot, Slug, StoryKey } from '../schemas';

export interface DataRootPaths {
  rootConfig: string;
  localState: string;
  workspacesDir: string;
  workspace(ws: Slug): string;
  workspaceConfig(ws: Slug): string;
  boardsDir(ws: Slug): string;
  board(ws: Slug, board: Slug): string;
  boardConfig(ws: Slug, board: Slug): string;
  storiesDir(ws: Slug, board: Slug): string;
  story(ws: Slug, board: Slug, key: StoryKey): string;
  epicsDir(ws: Slug): string;
  epic(ws: Slug, id: Slug): string;
}

/** Absolute paths for every file and folder in the Data Root layout (contracts §1). */
export function paths(root: DataRoot): DataRootPaths {
  const workspacesDir = join(root.path, 'workspaces');
  const workspace = (ws: Slug) => join(workspacesDir, ws);
  const boardsDir = (ws: Slug) => join(workspace(ws), 'boards');
  const board = (ws: Slug, b: Slug) => join(boardsDir(ws), b);
  const storiesDir = (ws: Slug, b: Slug) => join(board(ws, b), 'stories');
  const epicsDir = (ws: Slug) => join(workspace(ws), 'epics');
  return {
    rootConfig: join(root.path, 'rowbly.config.json'),
    localState: join(root.path, 'local.json'),
    workspacesDir,
    workspace,
    workspaceConfig: (ws) => join(workspace(ws), 'workspace.config.json'),
    boardsDir,
    board,
    boardConfig: (ws, b) => join(board(ws, b), 'board.config.json'),
    storiesDir,
    story: (ws, b, key) => join(storiesDir(ws, b), `${key}.json`),
    epicsDir,
    epic: (ws, id) => join(epicsDir(ws), `${id}.json`),
  };
}
