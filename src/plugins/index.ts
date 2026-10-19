// The registry of Built-in Plugins (ADR-0009). Plugins run in this order. Only the entry point
// (src/cli.ts) reads it; core never imports a Plugin.
import type { AnyPluginDefinition } from '../plugin-api';
import { assignees } from './assignees';
import { comments } from './comments';
import { epics } from './epics';
import { specs } from './specs';
import { tasks } from './tasks';

export const builtInPlugins: readonly AnyPluginDefinition[] = [assignees, tasks, epics, specs, comments];
