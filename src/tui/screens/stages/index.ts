import type { ScreenRegistry } from '../types';
import { StagesScreen } from './StagesScreen';

export { ConfigScopeNote } from './ConfigScopeNote';
export { type ConfigScope, targetFor, useConfigScope } from './shared';

export const stagesScreens: ScreenRegistry = {
  stages: StagesScreen,
};
