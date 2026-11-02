import type { ScreenRegistry } from '../types';
import { ContextScreen } from './ContextScreen';
import { DataRootPickerScreen } from './DataRootPickerScreen';
import { SetupScreen } from './SetupScreen';

export type { SetupParams } from './SetupScreen';

export const setupScreens: ScreenRegistry = {
  setup: SetupScreen,
  'data-roots': DataRootPickerScreen,
  context: ContextScreen,
};
