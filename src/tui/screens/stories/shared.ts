// Pure helpers shared by the story list and form screens.
import type { Slug } from '../../../schemas';
import type { Services } from '../../../services';

/** The select choice meaning "no value" (no Priority, an unset Custom Field). */
export const NONE = '(none)';

/** `params.boardId` when given, else the Board in context. */
export async function boardIdFor(services: Services, params: Record<string, unknown>): Promise<Slug> {
  return (params.boardId as Slug | undefined) ?? services.context.resolveBoard();
}
