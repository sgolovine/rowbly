// Test helpers for the Comments Plugin.
import { type Comment, CommentsBag } from '../../src/plugins/comments/model';
import { createRepositories } from '../../src/storage';
import type { TempRoot } from '../helpers';

/**
 * The saved Thread of Story `key`, or of its Task at `taskIndex`, parsed as a Comments bag. Without a
 * bag the Thread is empty; an invalid bag or a missing Task fails the test.
 */
export async function readCommentThread(t: TempRoot, key: string, taskIndex?: number): Promise<Comment[]> {
  const story = await createRepositories(t.root).stories.findByKey(key);
  const record = taskIndex === undefined ? story : story.tasks[taskIndex];
  if (!record) throw new Error(`${key} has no Task at index ${taskIndex}`);
  const bag = record.plugins?.comments;
  return bag === undefined ? [] : CommentsBag.parse(bag).comments;
}
