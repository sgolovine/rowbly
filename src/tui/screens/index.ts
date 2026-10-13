import { assigneesScreens } from './assignees';
import { boardScreens } from './board';
import { boardsScreens } from './boards';
import { commentsScreens } from './comments';
import { demoScreens } from './demo';
import { doctorScreens } from './doctor';
import { epicsScreens } from './epics';
import { fieldsScreens } from './fields';
import { homeScreens } from './home';
import { setupScreens } from './setup';
import { stagesScreens } from './stages';
import { storiesScreens } from './stories';
import { tasksScreens } from './tasks';
import type { ScreenRegistry } from './types';
import { workspacesScreens } from './workspaces';

export type { ScreenComponent, ScreenProps, ScreenRegistry } from './types';

/** Every screen the router can open. One line per area; each area adds screens in its own folder. */
export const screens: ScreenRegistry = {
  ...homeScreens,
  ...setupScreens,
  ...workspacesScreens,
  ...assigneesScreens,
  ...boardsScreens,
  ...stagesScreens,
  ...fieldsScreens,
  ...storiesScreens,
  ...tasksScreens,
  ...commentsScreens,
  ...epicsScreens,
  ...boardScreens,
  ...doctorScreens,
  ...demoScreens,
};
