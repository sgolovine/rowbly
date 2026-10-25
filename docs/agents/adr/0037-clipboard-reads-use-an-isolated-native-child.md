# ADR-0037: Clipboard images are read by an isolated optional native child

**Status:** Accepted

## 1. Context

The upcoming Story paste hook and Attachments Plugin need PNG bytes from the system clipboard.
Terminals send keys or text, not clipboard images. Reading a clipboard is independent of the Data
Root and must not hold its lock, print over the TUI, or crash or hang Rowbly.

`@mariozechner/clipboard` supplies prebuilt N-API binaries for macOS, Windows and Linux. Its published
Linux binaries use X11, including XWayland; a Wayland session without working X11 needs `wl-paste`.
Its `hasImage()` call is synchronous, and even loading native code can fail or abort the process.
The upstream implementation is at <https://github.com/earendil-works/clipboard>.

## 2. Decision

- Pin `@mariozechner/clipboard` to exactly **0.3.9**, including its lockfile. Review the upstream source,
  JavaScript loader, release diff and platform binaries before each upgrade. This is a dependency
  with a single-maintainer supply-chain risk; the exact pin makes upgrades deliberate. It ships no
  install script, so no `allowBuilds` change is needed. Child isolation contains failures, but is not
  a security sandbox for a compromised dependency.
- Lazily `await import()` inside a short-lived Node child, catching load failures. Cache an explicit
  failed load in the parent until restart. Do not cache connection failures, crashes or timeouts:
  a clipboard or display can recover. Call `hasImage()`, then `getImageBase64()`; decode with
  `Buffer.from(base64, 'base64')` in the parent. Do not transfer native `number[]` image results.
- Run all native code outside Rowbly's process. Discard child stdout and stderr and return a bounded
  JSON response through a separate pipe. Kill the child with `SIGKILL` on the deadline or excessive
  output; dispose the pipe and timer. A crash, unsuccessful exit or malformed response becomes
  `unsupported`; an expired deadline becomes `timeout`. Native connection/read errors become
  `no-display`. Linux without `DISPLAY` also returns `no-display` from the child.
- When native reading returns `unsupported` or `no-display` and `WAYLAND_DISPLAY` is set, use
  `execFile` without a shell to run `wl-paste --list-types`. Require an exact `image/png` line, then
  run `wl-paste --type image/png`. A missing helper returns `unsupported`; an unsuccessful helper
  returns `no-display`. A successful type list without PNG returns `no-image`.
- Native work and both fallback commands share one **3-second** deadline. Limit PNG bytes to
  **10 MiB** (10 × 1024 × 1024), bound base64 transport accordingly, and bound helper output.
  Reject malformed base64 or bytes without a PNG signature. This checks the transport format, not
  the full PNG contents. Native image conversion can allocate more memory in the child before the
  size check; the cap bounds accepted bytes and parent transport rather than native memory usage.
- `src/storage/clipboard.ts` owns process access and exports `readClipboardImage()`. A small service
  facade exposes `clipboard.readImage()` through the Plugin API without expanding `PluginContext`.
  Reads neither write the Data Root nor start an Operation. Callers read before starting a save.
- Build `dist/clipboard.js` as a separate entry, exporting the reader and facade for package smoke
  checks and future consumers. The inline child program resolves the external native dependency
  relative to the source or built module's directory, including an installed npm package. No native
  code is inlined into `dist/cli.js` or its chunks, and ordinary CLI startup does not load it.

ROW-27 originally proposed an in-process `Promise.race` and ADR-0034. The user replaced that design
with a killable subprocess because a promise deadline cannot interrupt synchronous native code or
contain a crash. ADR-0034 was already allocated; ROW-17 uses 0035 and ROW-26 uses 0036, so this decision
uses **0037**. UI keys, image persistence and cross-platform CI smoke jobs belong to later Stories.

## 3. Rejected alternatives

- **In-process native calls with a promise timeout:** synchronous hangs and native crashes escape
  that boundary, and native output can damage the TUI.
- **A native worker thread:** a native process abort still terminates Rowbly.
- **Always use desktop command-line helpers:** macOS and Windows need different tools, while the
  native package already supplies PNG conversion and platform binaries.
- **Fork the native package for Wayland:** the small `wl-paste` fallback covers that gap without
  maintaining a native fork. Users install `wl-clipboard` when their environment needs it.
- **A persistent clipboard child:** adds lifecycle and recovery state before there is a need for it.
