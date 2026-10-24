import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts', gitRebaseStrategy: 'src/storage/gitRebaseStrategy.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
