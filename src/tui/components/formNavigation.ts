import { createContext } from 'react';

/** The create host owns tab navigation and global save; field editors keep their arrow keys. */
export const FormNavigationContext = createContext<{
  register(id: string, editing: boolean): () => void;
} | null>(null);
