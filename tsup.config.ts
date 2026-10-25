import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts', clipboard: 'src/services/clipboard.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
