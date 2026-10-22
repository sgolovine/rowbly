import type { ScreenRegistry } from '../types';
import { ContextScreen } from './ContextScreen';
import { SetupScreen } from './SetupScreen';

export type { SetupParams } from './SetupScreen';

export const setupScreens: ScreenRegistry = {
  setup: SetupScreen,
  context: ContextScreen,
};
