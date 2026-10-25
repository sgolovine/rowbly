import { createContext } from 'react';
import type { KeyHint } from '../keymap';

/** The create host owns tab navigation and global save; field editors keep their arrow keys. */
export const FormNavigationContext = createContext<{
  extraHints: readonly KeyHint[];
  register(id: string, editing: boolean): () => void;
} | null>(null);
