// Test helpers for the Comments Plugin.
import { type Comment, CommentsBag } from '../../src/plugins/comments/model';
import { createRepositories } from '../../src/storage';
import type { TempRoot } from '../helpers';

/**
 * The saved Thread of Story `key`, parsed as a Comments bag. Without a bag the Thread is empty; an
 * invalid bag fails the test.
 */
export async function readCommentThread(t: TempRoot, key: string): Promise<Comment[]> {
  const story = await createRepositories(t.root).stories.findByKey(key);
  const bag = story.plugins?.comments;
  return bag === undefined ? [] : CommentsBag.parse(bag).comments;
}

/**
 * Comment bodies whose whitespace matters (UI-02): an indented first line, blank lines at both
 * edges, and multiline Markdown. The CLI and the TUI must store each exactly as given.
 */
export const WHITESPACE_BODIES = [
  '  indented first line\nnext',
  '\n\nblank edges\n\n',
  '# Title\n\n- item\n  - nested\n\n    code',
] as const;
