import { createContext, type ReactNode, useContext } from "react";
import { Store, withEntry, withMember, withoutEntry, withoutMember } from "../../services/store/store.js";
import type { KeyHint } from "../keymap.js";

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

/** The layers of a host and the listeners that it tells about a change. */
interface LayerState {
  /** Also the snapshot of `layers()`: a new map on each change, and the same map between changes. */
  readonly nodes: ReadonlyMap<string, ReactNode>;
  readonly listeners: ReadonlySet<() => void>;
}

function notify(state: Store<LayerState>): void {
  for (const listener of state.current.listeners) {
    listener();
  }
}

function showLayer(state: Store<LayerState>, id: string, node: ReactNode): void {
  state.update(({ nodes }) => ({ nodes: withEntry(nodes, id, node) }));
  notify(state);
}

function hideLayer(state: Store<LayerState>, id: string): void {
  if (!state.current.nodes.has(id)) {
    return;
  }

  state.update(({ nodes }) => ({ nodes: withoutEntry(nodes, id) }));
  notify(state);
}

function subscribeLayers(state: Store<LayerState>, listener: () => void): () => void {
  state.update(({ listeners }) => ({ listeners: withMember(listeners, listener) }));

  return () => state.update(({ listeners }) => ({ listeners: withoutMember(listeners, listener) }));
}

/** Makes the host of the layers of one modal. */
export function createLayerHost(): LayerHost {
  const state = new Store<LayerState>({ nodes: new Map(), listeners: new Set() });

  return {
    show: (id, node) => showLayer(state, id, node),
    hide: (id) => hideLayer(state, id),
    layers: () => state.current.nodes,
    subscribe: (listener) => subscribeLayers(state, listener),
  };
}

export const LayerHostContext = createContext<LayerHost | null>(null);

/**
 * Wraps a layer drawn away from where it was rendered in what encloses it there, such as the
 * boundary of the Plugin that opened it.
 */
export const LayerWrapContext = createContext<(node: ReactNode) => ReactNode>((node) => node);

/**
 * Inside a modal's content, shows a Form's keys first in the modal's hint strip, with `esc cancel`,
 * until the returned call.
 */
export const FormKeysContext = createContext<((keys: readonly KeyHint[]) => () => void) | null>(null);

/** True inside a modal's content while a task is open on top of it. */
export const CoveredContext = createContext(false);

/**
 * Whether a task (a Modal) is open over this content, opened by it or by a tab inside it. A screen
 * takes no keys of its own while it is covered: only the top layer does.
 */
export function useCovered(): boolean {
  return useContext(CoveredContext);
}
