import type { Slug } from '../../../schemas';
import type { ScreenProps } from '../types';
import { EditBoard } from './EditBoard';
import { NewBoard } from './NewBoard';

/**
 * Creates a Board, then switches to it. Opened from the sidebar's New Board button. The Board's id and
 * key prefix are inferred from its name, numbered when another Board already uses them. With
 * `params.boardId` it edits that Board instead, as the sidebar's `e` and its context menu do.
 */
export function BoardFormScreen({ params }: ScreenProps) {
  const boardId = typeof params.boardId === 'string' ? (params.boardId as Slug) : undefined;
  return boardId ? <EditBoard boardId={boardId} /> : <NewBoard />;
}
