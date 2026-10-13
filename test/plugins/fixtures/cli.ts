// A CLI entry point with the fixture Plugins as its registry; the test setup builds it like dist/cli.js.
import { main } from '../../../src/main';
import { fixturePlugins } from '.';

process.exitCode = await main(process.argv.slice(2), fixturePlugins);
