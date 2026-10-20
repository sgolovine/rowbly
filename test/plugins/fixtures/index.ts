// The registry of fixture Plugins, in run order, as the tests use it.
import type { AnyPluginDefinition } from '../../../src/plugin-api';
import { notes } from './notes';
import { boom, clash, echo, faulty, rival, stamp, storiesPlugin, strict, tracer } from './others';

export { NoteBag, notes } from './notes';
export * from './others';

export const fixturePlugins: readonly AnyPluginDefinition[] = [
  notes,
  stamp,
  rival,
  boom,
  strict,
  clash,
  storiesPlugin,
  faulty,
  echo,
  tracer,
];
