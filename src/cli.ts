// The entry point: the only module that reads the Plugin registry (ADR-0009).
import { main } from './main';
import { builtInPlugins } from './plugins';

process.exitCode = await main(process.argv.slice(2), builtInPlugins);
