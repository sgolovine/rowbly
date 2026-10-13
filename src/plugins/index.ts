// The registry of Built-in Plugins (ADR-0009). Plugins run in this order. Only the entry point
// (src/cli.ts) reads it; core never imports a Plugin.
import type { AnyPluginDefinition } from '../plugin-api';

import { epics } from './epics';

export const builtInPlugins: readonly AnyPluginDefinition[] = [epics];
