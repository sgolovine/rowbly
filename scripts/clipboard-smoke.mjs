// Exercise the globally installed tarball, never the checkout's dist or native dependency.
import assert from 'node:assert/strict';
import { execFileSync, fork, spawn } from 'node:child_process';
// biome-ignore lint/style/noRestrictedImports: Standalone CI harness, outside application layers.
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const script = fileURLToPath(import.meta.url);
const mode = process.argv[2];

if (mode === '--writer') {
  const require = createRequire(process.argv[3]);
  const clipboard = require('@mariozechner/clipboard');
  assert.equal(typeof clipboard.setImageBinary, 'function');
  assert.equal(typeof clipboard.getImageBase64, 'function');
  process.send({ loaded: require.resolve('@mariozechner/clipboard') });
  process.on('message', (base64) => {
    clipboard.setImageBinary([...Buffer.from(base64, 'base64')]);
    process.send({ written: true });
  });
  // Keep the X11 selection owner alive, but never leave a hung smoke writer behind.
  setTimeout(() => process.exit(1), 20_000).unref();
} else {
  assert.ok(
    ['native', 'wayland', 'load'].includes(mode),
    'Usage: node scripts/clipboard-smoke.mjs native|wayland|load',
  );
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const globalRoot = execFileSync(npm, ['root', '-g'], {
    encoding: 'utf8',
    timeout: 15_000,
    shell: process.platform === 'win32',
  }).trim();
  const packagePath = join(globalRoot, 'rowbly', 'package.json');
  const require = createRequire(packagePath);
  const pkg = require(packagePath);
  const nativePackage = require('@mariozechner/clipboard/package.json');
  assert.equal(nativePackage.version, '0.3.9');
  const readerPath = join(globalRoot, 'rowbly', 'dist', 'clipboard.js');
  const { readClipboardImage } = await import(pathToFileURL(readerPath).href);
  assert.equal(typeof readClipboardImage, 'function');
  console.log(
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      rowbly: pkg.version,
      native: nativePackage.version,
      packagePath,
      readerPath,
      nativePath: require.resolve('@mariozechner/clipboard'),
    }),
  );

  const children = [];
  const directory = mkdtempSync(join(tmpdir(), 'rowbly-clipboard-smoke-'));
  const watchdog = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    console.error('Clipboard smoke exceeded 45 seconds');
    process.exit(1);
  }, 45_000);
  function start(command, args, options = {}) {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
    children.push(child);
    child.on('error', (error) => console.error(error));
    return child;
  }
  function message(child, action) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Native writer did not respond within 10 seconds')), 10_000);
      function finish(error, value) {
        clearTimeout(timer);
        child.off('message', received);
        child.off('exit', exited);
        child.off('error', finish);
        if (error) reject(error);
        else resolve(value);
      }
      function received(value) {
        finish(null, value);
      }
      function exited(code, signal) {
        finish(new Error(`Native writer exited: ${code}, ${signal}`));
      }
      child.once('message', received);
      child.once('exit', exited);
      child.once('error', finish);
      action?.();
    });
  }
  try {
    const writer = fork(script, ['--writer', packagePath], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    children.push(writer);
    const loaded = await message(writer);
    assert.ok(loaded.loaded);
    console.log('Installed native binding loaded:', loaded.loaded);
    if (mode !== 'load') {
      const expected = new PNG({ width: 2, height: 2 });
      expected.data = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 233, 127, 41, 255]);
      const bytes = PNG.sync.write(expected);
      if (mode === 'native') {
        delete process.env.WAYLAND_DISPLAY;
        assert.deepEqual(await message(writer, () => writer.send(bytes.toString('base64'))), { written: true });
      } else {
        assert.equal(process.platform, 'linux');
        assert.ok(!process.env.DISPLAY, 'Wayland fallback must run without X11');
        assert.ok(process.env.WAYLAND_DISPLAY);
        const realPaste = execFileSync('which', ['wl-paste'], { encoding: 'utf8', timeout: 5000 }).trim();
        const calls = join(directory, 'wl-paste.log');
        const wrapper = join(directory, 'wl-paste');
        // Forward to the real executable and record both fallback calls, without changing their output.
        writeFileSync(
          wrapper,
          `#!/bin/sh\nprintf '%s\\n' "$*" >> "$ROWBLY_SMOKE_CALLS"\nexec "$ROWBLY_SMOKE_WL_PASTE" "$@"\n`,
          { mode: 0o755 },
        );
        process.env.ROWBLY_SMOKE_CALLS = calls;
        process.env.ROWBLY_SMOKE_WL_PASTE = realPaste;
        process.env.PATH = `${directory}${delimiter}${process.env.PATH}`;
        appendFileSync(calls, '');
        const copy = start('wl-copy', ['--foreground', '--type', 'image/png'], {
          stdio: ['pipe', 'inherit', 'inherit'],
        });
        copy.stdin.end(bytes);
        // Wait for a real selection offer, with every probe bounded and owner failure visible.
        const deadline = Date.now() + 8000;
        while (true) {
          assert.equal(copy.exitCode, null, 'wl-copy exited before offering the image');
          try {
            const types = execFileSync(realPaste, ['--list-types'], { encoding: 'utf8', timeout: 1000 });
            if (types.split(/\r?\n/).includes('image/png')) break;
          } catch {
            /* The compositor may not have received the offer yet. */
          }
          assert.ok(Date.now() < deadline, 'Wayland image offer was not ready within 8 seconds');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const result = await readClipboardImage();
      assert.ok('bytes' in result, `Rowbly read failed: ${JSON.stringify(result)}`);
      assert.equal(result.type, 'image/png');
      const actual = PNG.sync.read(Buffer.from(result.bytes));
      assert.equal(actual.width, expected.width);
      assert.equal(actual.height, expected.height);
      assert.deepEqual(actual.data, expected.data, 'Decoded clipboard pixels differ');
      if (mode === 'wayland') {
        const calls = readFileSync(join(directory, 'wl-paste.log'), 'utf8');
        assert.ok(calls.includes('--list-types\n') && calls.includes('--type image/png\n'), calls);
        console.log(`Real wl-paste fallback calls:\n${calls.trim()}`);
      }
      console.log(`PASS ${mode}: 2x2 PNG dimensions and all RGBA pixels match`);
    }
  } finally {
    clearTimeout(watchdog);
    await Promise.all(
      children.map(
        (child) =>
          new Promise((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) return resolve();
            child.once('close', resolve);
            child.kill('SIGKILL');
          }),
      ),
    );
    rmSync(directory, { recursive: true, force: true });
  }
}
