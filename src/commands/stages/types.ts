import type { Slug } from '../../schemas';
import type { ConfigTarget } from '../../services';
import type { ContextFlags } from '../shared';

/** `--board` and `--level`, shared by `stages` and `fields`. */
export interface LevelFlags extends ContextFlags {
  level?: string;
}

/** The JSON/human result of every `stages`/`fields` mutation: the new list, the level and the Boards it applies to. */
export interface MutationResult<T> {
  level: ConfigTarget['level'];
  items: T[];
  affectedBoards: Slug[];
}

export interface StageOptions extends LevelFlags {
  name?: string;
  before?: string;
  after?: string;
  first?: boolean;
  last?: boolean;
  moveTo?: string;
}
