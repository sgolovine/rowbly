import { type Dispatch, type SetStateAction, useCallback, useState } from "react";
import type { KeyHint } from "../keymap.js";
import { createLayerHost, type LayerHost } from "./modal-layer.js";

/** The keys of one Form in the content. */
export interface FormLead {
  readonly keys: readonly KeyHint[];
}

/** The layers over a body and the keys of the Forms in it. `ModalBody` gives them to its content. */
export interface ModalLayers {
  readonly host: LayerHost;
  /** Counts a layer over the body until the returned call. */
  readonly registerLayer: () => () => void;
  /** Shows the keys of a Form until the returned call. */
  readonly registerForm: (keys: readonly KeyHint[]) => () => void;
  /** A task is open over the body. */
  readonly covered: boolean;
  /** The keys of the Forms in the body, in the order that they opened. */
  readonly leads: readonly FormLead[];
}

/** Counts a layer over the body until the returned call. */
function countLayer(setNested: Dispatch<SetStateAction<number>>): () => void {
  setNested((count) => count + 1);

  return () => setNested((count) => count - 1);
}

/** Shows the keys of a Form until the returned call. */
function addLead(setLeads: Dispatch<SetStateAction<readonly FormLead[]>>, keys: readonly KeyHint[]): () => void {
  const entry = { keys };

  setLeads((list) => [...list, entry]);

  return () => setLeads((list) => list.filter((other) => other !== entry));
}

/** The layer host, the layer count and the Form keys of a body that holds Forms and nested Modals. */
export function useModalLayers(): ModalLayers {
  const [nested, setNested] = useState(0);
  const registerLayer = useCallback(() => countLayer(setNested), []);
  const [leads, setLeads] = useState<readonly FormLead[]>([]);
  const registerForm = useCallback((keys: readonly KeyHint[]) => addLead(setLeads, keys), []);
  const [host] = useState(createLayerHost);

  return { host, registerLayer, registerForm, covered: nested > 0, leads };
}
