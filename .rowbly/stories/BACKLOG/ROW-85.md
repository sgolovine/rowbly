---
title: Add the SSH transport for worker hosts
stage: BACKLOG
createdAt: 2026-11-16T19:45:02.850Z
updatedAt: 2026-11-16T19:45:02.850Z
worktree: null
pull_request: null
---

## Goal

Make the SSH transport that the main machine uses to talk to a worker host.

Read the Spec `remote-worker-hosts`, section "Transport".

## Scope

In scope:

- A service that runs a fixed remote Rowbly command over SSH with `-o BatchMode=yes`, `ServerAliveInterval` and connection reuse (ControlMaster).
- The data goes on stdin as JSON. It never goes in the SSH arguments, because SSH joins the arguments into a shell string.
- A framed JSON-lines channel for a long-lived connection, and a way to get raw bytes (for PNG files).
- A handshake that compares the protocol version and the Rowbly version.
- A fake in-process transport for tests, with a way to cut and restore the connection.
- Clear errors: host unreachable, authentication failed, version mismatch, timeout.

Not in scope:

- The host agent, the commands that it accepts, or the install of Rowbly.

## Acceptance criteria

- No test uses real SSH.
- The transport does not load Pi. Extend the `import-boundary` test if necessary.
- A test proves that Story text with quotes, `$` and `;` cannot change the remote command.
