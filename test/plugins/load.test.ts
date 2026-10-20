import { describe, expect, it } from 'vitest';
import { failureWarning, onOff } from '../../src/services';
import { boom, notes, stamp, strict } from './fixtures';
import { pluginRoot, withPlugins } from './helpers';

describe('loading Plugins (ADR-0010)', () => {
  it('turns on only the Plugins that rowbly.config.json enables, in registry order', async () => {
    const t = await pluginRoot({ stamp: true, notes: true });
    const { host } = await withPlugins(t, [notes, stamp, boom]);
    expect(host.active().map((p) => p.definition.id)).toEqual(['notes', 'stamp']);
    expect(host.status().map((s) => [s.id, onOff(s)])).toEqual([
      ['notes', 'on'],
      ['stamp', 'on'],
      ['boom', 'off'],
    ]);
    expect(host.failures()).toEqual([]);
  });

  it('skips a Plugin that throws while it starts, whose settings are invalid, or that it does not have', async () => {
    const t = await pluginRoot(
      {},
      {
        plugins: {
          notes: { enabled: true },
          boom: { enabled: true },
          strict: { enabled: true, level: 'high' },
          ghost: { enabled: true },
          // Off and unknown: listed, but no failure.
          later: { enabled: false, kept: 1 },
        },
      },
    );
    const { host } = await withPlugins(t, [notes, boom, strict]);
    expect(host.active().map((p) => p.definition.id)).toEqual(['notes']);
    expect(host.failures().map((f) => [f.id, f.reason])).toEqual([
      ['boom', 'boom at start'],
      ['strict', 'invalid settings: level: Invalid input: expected number, received string'],
      ['ghost', 'this version of Rowbly does not have it'],
    ]);
    expect(host.status().find((s) => s.id === 'later')).toMatchObject({ known: false, enabled: false });
    expect(host.status().find((s) => s.id === 'ghost')).toMatchObject({ known: false, enabled: true });
    expect(host.failures().map(failureWarning)[0]).toBe(
      'Plugin "boom" failed to load (boom at start); Rowbly runs without it and keeps its data. ' +
        'Turn it off with `rowbly plugins disable boom`',
    );
  });
});
