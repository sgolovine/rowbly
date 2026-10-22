import type { ContextFlags } from '../shared';

export interface StoryOptions extends ContextFlags {
  name?: string;
  description?: string;
  descriptionFile?: string;
  edit?: boolean;
  stage?: string[] | string;
  category?: string;
  open?: boolean;
  /** `--priority <P>` (repeatable on `list`) or `false` with `--no-priority`. */
  priority?: string[] | string | false;
  label?: string[];
  addLabel?: string[];
  removeLabel?: string[];
  /** `--due <date>` or `false` with `--no-due`. */
  due?: string | false;
  field?: string[];
  unsetField?: string[];
  search?: string;
  sort?: string;
  allBoards?: boolean;
  top?: boolean;
  bottom?: boolean;
  before?: string;
  after?: string;
}
