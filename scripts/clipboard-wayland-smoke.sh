#!/usr/bin/env bash
# Sway supports data-control selections without a focused window or an X11 server.
set -euo pipefail
runtime=$(mktemp -d)
compositor=''
cleanup() {
  if [[ -n "$compositor" ]]; then
    kill "$compositor" 2>/dev/null || true
    wait "$compositor" 2>/dev/null || true
  fi
  cat "$runtime/sway.log" 2>/dev/null || true
  rm -rf "$runtime"
}
trap cleanup EXIT
export XDG_RUNTIME_DIR="$runtime"
export WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman
unset DISPLAY WAYLAND_DISPLAY
cat > "$runtime/config" <<'CONFIG'
output * mode 800x600
seat seat0 fallback true
CONFIG
timeout --kill-after=2s 60s sway --unsupported-gpu --config "$runtime/config" > "$runtime/sway.log" 2>&1 &
compositor=$!
for ((attempt=0; attempt<100; attempt++)); do
  for socket in "$runtime"/wayland-*; do
    if [[ -S "$socket" ]]; then
      export WAYLAND_DISPLAY="${socket##*/}"
      break 2
    fi
  done
  if ! kill -0 "$compositor" 2>/dev/null; then
    echo 'Headless compositor exited before creating a Wayland socket' >&2
    exit 1
  fi
  sleep 0.1
done
: "${WAYLAND_DISPLAY:?Headless compositor did not create a socket within 10 seconds}"
node scripts/clipboard-smoke.mjs wayland
