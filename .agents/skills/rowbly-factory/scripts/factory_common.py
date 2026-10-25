"""Settings and helpers shared by the factory scripts. Every setting comes from the environment."""
import json
import os
import shlex
import subprocess

STATE = os.path.expanduser(os.environ.get(
    "FACTORY_DIR", os.path.join(os.environ.get("XDG_STATE_HOME", "~/.local/state"), "rowbly-factory")))
HOST = os.environ.get("FACTORY_HOST", "192.168.68.62")
T3 = os.environ.get("FACTORY_T3", "~/.t3/runtime/versions/0.1.2/t3")
REMOTE_REPO = os.environ.get("FACTORY_REMOTE_REPO", "~/Projects/rowbly")
REPO = os.environ.get("FACTORY_REPO") or subprocess.run(
    ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
ROWBLY = shlex.split(os.environ.get("FACTORY_ROWBLY", "pnpm --silent dev"))
DATA_ROOT = os.environ.get("FACTORY_DATA_ROOT", os.path.join(REPO, ".rowbly"))


def ssh(command, timeout=120):
    """Run a command on the worker server and return its stdout."""
    return subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", HOST, command],
                          capture_output=True, text=True, timeout=timeout).stdout


def thread_show(thread_id):
    """The server's `t3 thread show --json` for one thread: {"thread": {...}, "messages": [...]}."""
    return json.loads(ssh(f"cd {REMOTE_REPO} && {T3} thread show --json {thread_id}"))


def rowbly(*args, stdin=None):
    """Run a rowbly command against the control checkout's Data Root."""
    return subprocess.run([*ROWBLY, *args, "--data-root", DATA_ROOT, "--json", "--no-prompt"],
                          input=stdin, capture_output=True, text=True, cwd=REPO)


def threads():
    """(Story Key, thread id) pairs from threads.tsv. A later line for a Key replaces an earlier one."""
    path = os.path.join(STATE, "threads.tsv")
    pairs = {}
    if os.path.exists(path):
        for line in open(path):
            if line.strip() and not line.startswith("#"):
                key, thread_id = line.split()[:2]
                pairs[key] = thread_id
    return list(pairs.items())


def load(name, default):
    path = os.path.join(STATE, name)
    return json.load(open(path)) if os.path.exists(path) else default


def save(name, value):
    os.makedirs(STATE, exist_ok=True)
    json.dump(value, open(os.path.join(STATE, name), "w"))
