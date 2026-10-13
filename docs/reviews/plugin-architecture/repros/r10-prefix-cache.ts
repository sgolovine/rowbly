// TUI (long-lived services) + CLI (another process) creates a Board: can the TUI open its Stories?
import { makeRoot, withPlugins, show } from './lib';

const t = await makeRoot({});
const tui = await withPlugins(t, []);
await tui.services.stories.get('WEB-9').catch(() => {}); // warms the prefix index as any list/open does
const cli = await withPlugins(t, []);
await cli.services.boards.create({ id: 'api', name: 'API', keyPrefix: 'API' });
await cli.services.stories.create('api', { name: 'New on API' });
show('TUI sees the Board in the sidebar', (await tui.services.boards.list()).map((b) => b.id));
show('TUI opens API-1', await tui.services.stories.get('API-1').then((s) => s.key, (e) => `ERR ${e.constructor.name}: ${e.message} (${e.hint})`));
show('TUI lists Stories of api', await tui.services.stories.list('api', {}).then((l) => l.map((s) => s.key), (e) => `ERR ${e.message}`));
show('TUI creates a Story on api', await tui.services.stories.create('api', { name: 'From TUI' }).then((s) => s.key, (e) => `ERR ${e.constructor.name}: ${e.message}`));
await t.cleanup();
