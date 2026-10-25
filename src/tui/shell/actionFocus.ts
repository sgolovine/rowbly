import type { ActionFocus, PluginAction, PluginContext, PluginUi } from '../../services';

/** An Action bound to the exact focus required by its target. */
export interface BoundAction {
  run(args: { plugin: PluginContext; ui: PluginUi }): void | Promise<void>;
  status?(plugin: PluginContext): Promise<{ label?: string; busy?: boolean }>;
}

/** Keyboard, mouse and status use the same target-qualified focus (ADR-0017). */
export function bindAction(action: PluginAction<unknown>, focus: ActionFocus | null): BoundAction | null {
  const current = focus ?? {};
  switch (action.target) {
    case 'board': {
      const { board } = current;
      if (!board) return null;
      const focus = { ...current, board },
        status = action.status;
      return {
        run: (args) => action.run({ ...args, focus }),
        status: status && ((plugin) => status({ plugin, focus })),
      };
    }
    case 'story': {
      const { story } = current;
      if (!story) return null;
      const focus = { ...current, story },
        status = action.status;
      return {
        run: (args) => action.run({ ...args, focus }),
        status: status && ((plugin) => status({ plugin, focus })),
      };
    }
    case 'none': {
      const status = action.status;
      return {
        run: (args) => action.run({ ...args, focus: current }),
        status: status && ((plugin) => status({ plugin, focus: current })),
      };
    }
  }
}
