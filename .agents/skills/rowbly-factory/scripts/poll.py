#!/usr/bin/env python3
"""Watch the workers and the Board, and print one line per new event, for the Monitor tool.

Events: STATUS <KEY> <status>, MARKER <KEY> <ROWBLY-UPDATE|QUESTIONS FOR USER|DONE> (msg <hash>),
NEW-IN-PROGRESS <KEY> <name>, LOWMEM available=<MB>MB, POLL-ERROR <error>.
Each event is printed once; seen.json in FACTORY_DIR remembers them.

  python3 -u poll.py            # every FACTORY_INTERVAL seconds (default 180)
  python3 -u poll.py --once     # one pass, then exit
"""
import hashlib
import json
import os
import re
import sys
import time

from factory_common import load, rowbly, save, ssh, thread_show, threads

MARKERS = {"ROWBLY-UPDATE": r"ROWBLY-UPDATE \S+", "QUESTIONS FOR USER": r"QUESTIONS FOR USER", "DONE": r"\bDONE [A-Z][A-Z0-9]*-\d+"}
ACTIVE = ("running", "starting", "queued", "preparing", "waiting")
INTERVAL = int(os.environ.get("FACTORY_INTERVAL", "180"))
LOW_MEMORY_MB = int(os.environ.get("FACTORY_LOW_MEMORY_MB", "6000"))

seen = load("seen.json", {})


def emit(line):
    print(line, flush=True)


def mark(key, value):
    """True the first time a key has this value."""
    if seen.get(key) != value:
        seen[key] = value
        return True
    return False


def poll():
    tracked = threads()
    running = 0
    for story, thread_id in tracked:
        data = thread_show(thread_id)
        status = data["thread"]["status"]
        running += status in ACTIVE
        if mark(f"{story}:{thread_id}:status", status):
            emit(f"STATUS {story} {status}")
        for message in data.get("messages", []):
            text = message.get("text", "")
            if message.get("role") != "assistant":
                continue
            for marker, pattern in MARKERS.items():
                if re.search(pattern, text):
                    digest = hashlib.sha1(text.encode()).hexdigest()[:10]
                    if mark(f"{story}:{marker}:{digest}", 1):
                        emit(f"MARKER {story} {marker} (msg {digest})")
    available = ssh("free -m | awk '/Mem:/{print $7}'").strip()
    if available.isdigit() and int(available) < LOW_MEMORY_MB and mark("lowmem", available):
        emit(f"LOWMEM available={available}MB")
    keys = {story for story, _ in tracked}
    for story in json.loads(rowbly("stories", "list").stdout):
        if story["stage"] == "in-progress" and story["key"] not in keys and mark(f"new:{story['key']}", 1):
            emit(f"NEW-IN-PROGRESS {story['key']} {story['name']} (threads running: {running})")
    save("seen.json", seen)


while True:
    try:
        poll()
    except Exception as error:  # a failed pass must not end the Monitor
        if mark("error", str(error)[:80]):
            emit(f"POLL-ERROR {error}")
    if "--once" in sys.argv:
        break
    time.sleep(INTERVAL)
