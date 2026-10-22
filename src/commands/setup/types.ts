export interface InitFlags {
  global?: boolean;
  label?: string;
  default?: boolean;
  board?: string;
  boardName?: string;
  prefix?: string;
}

export type ContextSource = 'flag' | 'env' | 'local' | 'only';

/** What `use` prints: the current Board and where it was resolved from. */
export interface CurrentContext {
  board: { id: string; source: ContextSource } | null;
}
