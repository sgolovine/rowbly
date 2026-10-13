import { placeholderScreen } from '../_placeholder';
import type { ScreenRegistry } from '../types';

// Stub: WP08 replaces this area's screens.
export const setupScreens: ScreenRegistry = {
  setup: placeholderScreen('Setup', 'WP08'),
};
