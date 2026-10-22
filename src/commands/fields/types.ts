import type { LevelFlags } from '../stages';

export interface FieldOptions extends LevelFlags {
  name?: string;
  type?: string;
  description?: string;
  options?: string[];
  required?: boolean;
  /** `--optional` sets `required` to false on `edit`. */
  optional?: boolean;
  min?: string;
  max?: string;
  integer?: boolean;
}
