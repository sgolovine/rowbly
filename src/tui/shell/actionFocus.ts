import type { ActionFocus, PluginAction, PluginContext, PluginUi } from '../../services';

/** What the shell passes to a bound Action. */
export interface ActionRunArgs {
  plugin: PluginContext;
  ui: PluginUi;
}

/**
 * `action.run` bound to the focus its target needs, or `null` when that target is not in focus: a
 * Board for `board`, a Story for `story`, a Task with its Story for `task`; `none` always runs (DX-30).
 * The header button and the key both use this, so they show and run the same Actions.
 */
export function bindAction(
  action: PluginAction<unknown>,
  focus: ActionFocus | null,
): ((args: ActionRunArgs) => void | Promise<void>) | null {
  const current = focus ?? {};
  switch (action.target) {
    case 'board': {
      const { board } = current;
      return board ? (args) => action.run({ ...args, focus: { ...current, board } }) : null;
    }
    case 'story': {
      const { story } = current;
      return story ? (args) => action.run({ ...args, focus: { ...current, story } }) : null;
    }
    case 'task': {
      const { story, task } = current;
      return story && task ? (args) => action.run({ ...args, focus: { ...current, story, task } }) : null;
    }
    case 'none':
      return (args) => action.run({ ...args, focus: current });
  }
}
