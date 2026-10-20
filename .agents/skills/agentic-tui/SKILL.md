---
name: agentic-tui
description: >
  Use agentic-tui to run, inspect, and control terminal or TUI applications through CLI commands.
  Use when testing interactive CLIs, prompts, REPLs, setup wizards, full-screen terminal apps, or when an agent needs screenshots of terminal state.
  Do not use for web browsers, desktop GUI apps, MCP servers, or non-terminal interfaces.
---

# agentic-tui

## Purpose

Drive terminal applications through an observe/act loop:

1. Run the app in a persistent PTY session.
2. Observe output or rendered screen state.
3. Send keyboard, text, or terminal mouse-wheel input.
4. Wait for text or stability.
5. Repeat until complete.
6. Clean up the session.

## Setup

- Plain text output is fine for most observe/act loops.
- Add `--json` when you need structured metadata such as session ids, cursor coordinates, match rows/cols, or saved file details.
- Start the daemon explicitly when shell selection matters:
  - Windows PowerShell: `agentic-tui daemon start --shell powershell.exe`
  - PowerShell Core: `agentic-tui daemon start --shell pwsh`
  - Windows cmd: `agentic-tui daemon start --shell cmd.exe`
  - Unix shell: `agentic-tui daemon start --shell bash`
- On Windows, the default PTY backend is `winpty` because it passes raw terminal input sequences more reliably for TUI automation. Set `AGENTIC_TUI_WINDOWS_PTY=conpty` only when you specifically need ConPTY behavior.
- If state directory access is restricted, set `AGENTIC_TUI_STATE_DIR` to a writable directory.

## Core Workflow

```bash
agentic-tui daemon start --shell powershell.exe
agentic-tui run <command> [...args]
agentic-tui screen
agentic-tui press Enter
agentic-tui wheel down 3
agentic-tui wait --stable
agentic-tui screen
agentic-tui kill
```

Start and attach in one step when a human should immediately use the PTY while agents retain inspect/control access:

```bash
agentic-tui run --attach --attach-mode shared codex
```

Attach modes:

- `read-only`: stream PTY output to the user's terminal; user input is not forwarded; agent mutation commands continue.
- `exclusive`: stream output and forward user input; agent mutation commands are rejected with `SESSION_ATTACHED_BY_USER`; read commands still work.
- `shared`: stream output and forward user input; agent commands also continue. Use this for human/agent collaboration.

Attach an existing session:

```bash
agentic-tui attach --session <id> --mode shared
```

Detach with `Ctrl+D` or `Ctrl+]`.

Rules:

- Re-observe after every action that can change the UI.
- Use `wait --stable` before interpreting full-screen TUIs or prompts.
- Use `--session <id>` when more than one session exists.
- End sessions with `kill` or clean all sessions with `sessions cleanup --all`.

## Choosing The Read Mode

- Regular commands: `agentic-tui output --mode streaming`
  - Use for `npm`, `git`, `ls`, compilers, tests, and commands that print sequential logs.
  - Streaming output clears after read.
- Live-updating commands: `agentic-tui output --mode snapshot`
  - Use for raw recent output from progress or monitor-style commands.
  - Snapshot output does not clear.
- TUI apps and prompts: `agentic-tui screen`
  - Use for menus, editors, forms, full-screen apps, alternate-screen apps, and visual prompts.
  - This returns the rendered text grid.

## Common Actions

Run:

```bash
agentic-tui run npm install
agentic-tui run --attach --attach-mode shared codex
agentic-tui run htop --cols 120 --rows 40
agentic-tui run --cwd <dir> <command> [...args]
```

Type and submit:

```bash
agentic-tui type "hello world"
agentic-tui press Enter
```

Navigate:

```bash
agentic-tui press ArrowDown ArrowDown Enter
agentic-tui scroll down 5
agentic-tui wheel down 3
agentic-tui scroll down 3 --row 12 --col 40
agentic-tui scroll down 3 --keys
agentic-tui press Tab
agentic-tui press Escape
agentic-tui press Ctrl+C
```

Scrolling guidance:

- Use `scroll up|down|left|right [amount]` for terminal mouse-wheel events.
- `wheel up|down|left|right [amount]` is an explicit alias for the same wheel-event path.
- Use `scroll --keys` only when the app expects repeated arrow keys rather than wheel input.
- Add `--row N --col N` when the app scrolls only under the pointer or has multiple panes.
- Use `--protocol sgr` only when auto detection fails; modern TUIs usually request SGR mouse mode automatically.

Resize:

```bash
agentic-tui resize --cols 120 --rows 40
```

Wait:

```bash
agentic-tui wait "Done" --timeout 30000
agentic-tui wait "Loading" --gone --timeout 60000
agentic-tui wait --stable --timeout 5000
```

Inspect:

```bash
agentic-tui search "Continue"
agentic-tui search "error|failed" --regex
agentic-tui region --row 5 --col 0 --rows 10 --cols 80 --trim
agentic-tui cursor
```

Save screenshots:

```bash
agentic-tui screen --out screen.txt --format text
agentic-tui screen --out screen.json --format json
agentic-tui screen --out screen.png --format png
```

## Reliability Rules

- Do not rely on old screenshots after input. Always call `screen` again.
- Do not use `streaming` to inspect full-screen TUIs; use `screen`.
- Use `search` before complex coordinate assumptions.
- Use `region` for tables, menus, status bars, and focused extraction.
- Use `--out` to save evidence or reports. Prefer text for quick inspection, JSON for metadata, and PNG for human visual review.
- Resize early to make layouts deterministic.
- If a wait times out, capture `screen` before deciding the next action.
- For short-lived commands, it is still valid to read `output` or `screen` after the process exits.

## Session Handling

List sessions:

```bash
agentic-tui sessions list
```

Use a specific session:

```bash
agentic-tui --session <id> screen
agentic-tui --session <id> press Enter
```

Switch active session:

```bash
agentic-tui sessions switch <id>
```

Clean up:

```bash
agentic-tui kill
agentic-tui sessions cleanup --all
agentic-tui daemon stop
```

## Remote PTY Host

Use remote mode when the PTY session should run on another machine, VM, container-like environment, or Windows Sandbox while commands are driven from the local host.

Operating modes:

- Local default: `agentic-tui <command>` uses the existing local daemon behavior.
- Remote server: `agentic-tui daemon --remote-server ...` runs on the machine that should host PTY sessions.
- Remote client: `agentic-tui --remote <url> ...` runs on the controlling machine and sends the same user-facing commands over WebSocket.

Start a remote server:

```bash
agentic-tui daemon --remote-server --listen 0.0.0.0:45731 --auth-token CHANGE_ME --shell powershell.exe
```

Rules:

- Keep `node-pty` local to the remote server. The client only changes transport; it does not host or emulate the PTY.
- Always pass `--auth-token` for non-loopback binds such as `0.0.0.0:45731`.
- Loopback-only testing can bind `127.0.0.1:45731`; do not expose a no-token server on a network.
- Use `--shell <shell>` on the server when shell selection matters.

Connect as a client:

```bash
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" daemon status
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" run <command> [...args]
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" screen
```

Remote global flags:

- `--remote <url>`: remote daemon URL. `http`/`https` are converted to `ws`/`wss`; direct `ws`/`wss` URLs are also valid.
- `--remote-header "Name: value"`: add a WebSocket connection header. Use `Authorization: Bearer <token>` for authenticated servers.
- `--remote-timeout <ms>`: timeout for remote connect and request/response calls.
- `--session-namespace <name>`: isolate active-session state for separate test runs or environments sharing one daemon.

Remote workflow:

```bash
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" run cmd.exe
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" type "echo remote-smoke"
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" press Enter
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" output --mode streaming
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" kill
```

Remote attach:

```bash
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" attach --session <id> --mode shared
```

Start and attach on the remote host itself, then inspect/control from another machine:

```bash
agentic-tui run --attach --attach-mode shared cmd.exe
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" sessions list
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" --session <id> screen
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" --session <id> type "echo from agent"
agentic-tui --remote http://HOST:45731 --remote-header "Authorization: Bearer CHANGE_ME" --session <id> press Enter
```

Remote behavior should match local behavior as much as possible:

- Use the same `run`, `screen`, `output`, `press`, `type`, `scroll`, `wheel`, `resize`, `wait`, `search`, `region`, `cursor`, `sessions`, and `kill` commands.
- If `--remote` is present, do not start or inspect the local daemon.
- Use `daemon status` to check reachability and `daemon capabilities` to inspect protocol/platform support.
- For short-lived remote commands, read `output` or `screen` after exit instead of trying to `kill`; exited sessions can be removed with `sessions cleanup`.

General remote troubleshooting:

- `Unexpected server response: 401`: missing or incorrect bearer token.
- `REMOTE_TIMEOUT`: increase `--remote-timeout`, confirm host/port reachability, and check firewall rules.
- `REMOTE_CONNECTION_FAILED`: verify the remote daemon is running and the URL scheme/host/port are correct.
- `SESSION_EXITED`: the remote process already ended; inspect output or start another session.

## Windows Sandbox Remote Host

Use this when terminal/TUI sessions must run inside Windows Sandbox while the controlling agent stays on the host.

Prerequisites:

- Windows Sandbox is enabled on the host.
- The host copy of `agentic-tui` is already prepared with:

```bash
npm install
npm run build
```

- The sandbox needs access to Node. Windows Sandbox does not include Node by default, so map `C:\Program Files\nodejs` from the host or use another prepared Node runtime.
- Use an auth token for any non-loopback bind. The remote daemon can spawn processes, so do not expose it without a token.

Recommended `.wsb` pattern:

```xml
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>C:\Path\To\agentic-tui</HostFolder>
      <SandboxFolder>C:\agentic-tui</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>C:\Program Files\nodejs</HostFolder>
      <SandboxFolder>C:\nodejs</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force -Path C:\agentic-tui\.tmp | Out-Null; 'starting' | Set-Content C:\agentic-tui\.tmp\sandbox-startup.txt; Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1 -ExpandProperty IPAddress | Set-Content C:\agentic-tui\.tmp\sandbox-ip.txt; New-NetFirewallRule -DisplayName agentic-tui-remote -Direction Inbound -Action Allow -Protocol TCP -LocalPort 45731 -ErrorAction SilentlyContinue | Out-Null; Set-Location C:\agentic-tui; C:\nodejs\node.exe C:\agentic-tui\dist\src\cli.js daemon --remote-server --listen 0.0.0.0:45731 --auth-token CHANGE_ME 2&gt; C:\agentic-tui\.tmp\sandbox-remote.err 1&gt; C:\agentic-tui\.tmp\sandbox-remote.out"</Command>
  </LogonCommand>
</Configuration>
```

There is a ready-to-edit example at `examples/windows-sandbox/remote-agentic-tui.wsb`.

After launching the `.wsb`, confirm startup from the host:

```powershell
type D:\Codeboltapps\agentic-tui\agentic-tui\.tmp\sandbox-ip.txt
type D:\Codeboltapps\agentic-tui\agentic-tui\.tmp\sandbox-remote.err
```

If needed, find the sandbox IP address inside Sandbox:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
```

Then control the remote PTY sessions from the host by adding `--remote` and the bearer header before the usual subcommand:

```bash
agentic-tui --remote http://SANDBOX_IP:45731 --remote-header "Authorization: Bearer CHANGE_ME" daemon status
agentic-tui --remote http://SANDBOX_IP:45731 --remote-header "Authorization: Bearer CHANGE_ME" sessions list
agentic-tui --remote http://SANDBOX_IP:45731 --remote-header "Authorization: Bearer CHANGE_ME" --session <id> screen
agentic-tui --remote http://SANDBOX_IP:45731 --remote-header "Authorization: Bearer CHANGE_ME" --session <id> type "echo sandbox-smoke"
agentic-tui --remote http://SANDBOX_IP:45731 --remote-header "Authorization: Bearer CHANGE_ME" --session <id> press Enter
agentic-tui --remote http://SANDBOX_IP:45731 --remote-header "Authorization: Bearer CHANGE_ME" --session <id> output --mode streaming
```

Remote commands should otherwise follow the same observe/act rules as local commands:

- Re-observe after every input.
- Use `screen`, `output`, `search`, `region`, `wait`, `sessions`, and `kill` the same way.
- Add `--session <id>` when controlling a non-active remote session.
- Add `--session-namespace <name>` when multiple test environments share one remote daemon.

Troubleshooting:

- `Unexpected server response: 401`: the auth token is missing or wrong.
- Connection refused or timeout: confirm the Sandbox daemon started, the Sandbox IP is correct, and the firewall rule allows TCP port `45731`.
- `sessions list` from the host shows no sessions even though one is attached inside Sandbox: the session may have auto-started a separate loopback daemon. Run `C:\nodejs\node.exe C:\agentic-tui\dist\src\cli.js daemon status` inside Sandbox before `run --attach`; inspect `.tmp\sandbox-remote.err` if the WSB daemon did not start.
- `node.exe` not found in Sandbox: confirm `C:\Program Files\nodejs` is mapped to `C:\nodejs`, or adjust the `.wsb` command for the Node location.
- Missing modules or `dist/src/cli.js`: run `npm install` and `npm run build` on the host before launching Sandbox.

## Error Recovery

- `DAEMON_NOT_RUNNING`: run `agentic-tui daemon start --shell <shell>`.
- `NO_SESSION`: run a command or inspect `agentic-tui sessions list`.
- `SESSION_EXITED`: inspect with `output`, `screen`, `search`, or `region`; start a new session if more input is required.
- `INVALID_KEY`: use supported names like `Enter`, `Tab`, `Escape`, arrows, `F1`-`F12`, `Ctrl+C`.
- Timeout from `wait`: capture `screen`, then decide whether to wait longer, search for alternate text, or send a corrective key.

## Minimal Examples

Interactive prompt:

```bash
agentic-tui run npm init
agentic-tui wait --stable
agentic-tui screen
agentic-tui type "my-package"
agentic-tui press Enter
agentic-tui wait --stable
agentic-tui screen
```

Full-screen TUI:

```bash
agentic-tui run htop --cols 120 --rows 40
agentic-tui wait --stable --timeout 3000
agentic-tui screen
agentic-tui search "CPU"
agentic-tui press F10
agentic-tui kill
```

Regular command:

```bash
agentic-tui run npm test
agentic-tui output --mode streaming --wait-for-idle 1000
```
