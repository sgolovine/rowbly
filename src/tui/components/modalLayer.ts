import { createContext } from 'react';

/** A nested task quiets the frame of the screen or task underneath it. */
export const ModalLayerContext = createContext<(() => () => void) | null>(null);
