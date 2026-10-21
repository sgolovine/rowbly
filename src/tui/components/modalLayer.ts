import { createContext, type ReactNode, useContext } from 'react';

/** A nested task quiets the frame of the screen or task underneath it. */
export const ModalLayerContext = createContext<(() => () => void) | null>(null);

/**
 * The layers shown over a modal's body. A Modal opened inside another modal's content (a Story tab,
 * a scrolled body) is drawn here instead of where it is rendered, so nothing that clips the content
 * clips the task on top.
 */
export interface LayerHost {
  show(id: string, node: ReactNode): void;
  hide(id: string): void;
  layers(): ReadonlyMap<string, ReactNode>;
  subscribe(listener: () => void): () => void;
}

export function createLayerHost(): LayerHost {
  const nodes = new Map<string, ReactNode>();
  let snapshot: ReadonlyMap<string, ReactNode> = new Map();
  const listeners = new Set<() => void>();
  const changed = () => {
    snapshot = new Map(nodes);
    for (const listener of listeners) listener();
  };
  return {
    show(id, node) {
      nodes.set(id, node);
      changed();
    },
    hide(id) {
      if (nodes.delete(id)) changed();
    },
    layers: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const LayerHostContext = createContext<LayerHost | null>(null);

/**
 * Wraps a layer drawn away from where it was rendered in what encloses it there, such as the
 * boundary of the Plugin that opened it.
 */
export const LayerWrapContext = createContext<(node: ReactNode) => ReactNode>((node) => node);

/** Inside a modal's content, shows a Form's keys in the modal's hint strip until the returned call. */
export const FormKeysContext = createContext<(() => () => void) | null>(null);

/** True inside a modal's content while a task is open on top of it. */
export const CoveredContext = createContext(false);

/**
 * Whether a task (a Modal) is open over this content, opened by it or by a tab inside it. A screen
 * takes no keys of its own while it is covered: only the top layer does.
 */
export function useCovered(): boolean {
  return useContext(CoveredContext);
}
