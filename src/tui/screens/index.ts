import { boardScreens, withBoardHome } from './board';
import { boardsScreens } from './boards';
import { demoScreens } from './demo';
import { doctorScreens } from './doctor';
import { fieldsScreens } from './fields';
import { homeScreens } from './home';
import { pluginsScreens } from './plugins';
import { settingsScreens } from './settings';
import { setupScreens } from './setup';
import { stagesScreens } from './stages';
import { storiesScreens } from './stories';
import { tasksScreens } from './tasks';
import type { ScreenRegistry } from './types';

export type { ScreenComponent, ScreenProps, ScreenRegistry } from './types';

/** Every screen the router can open. One line per area; each area adds screens in its own folder. */
export const screens: ScreenRegistry = {
  ...homeScreens,
  ...setupScreens,
  ...boardsScreens,
  ...stagesScreens,
  ...fieldsScreens,
  ...storiesScreens,
  ...tasksScreens,
  ...boardScreens,
  ...doctorScreens,
  ...settingsScreens,
  ...pluginsScreens,
  ...demoScreens,
  home: withBoardHome(homeScreens.home),
};
