import type { ComponentType } from 'react';

/** Every screen receives the params it was opened with through the router. */
export interface ScreenProps {
  params: Record<string, unknown>;
}

export type ScreenComponent = ComponentType<ScreenProps>;

/** Each area exports a record of its screens, keyed by screen name. */
export type ScreenRegistry = Record<string, ScreenComponent>;
