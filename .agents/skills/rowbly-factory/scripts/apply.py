#!/usr/bin/env python3
"""Apply each new ROWBLY-UPDATE block from the workers to the Board, once.

A block's `comment:` becomes a Comment on the Story, and `stage: in-pr` moves the Story to `in-pr`.
applied.json in FACTORY_DIR remembers the blocks already applied. Push `main` afterwards.

  apply.py [KEY ...]              # apply new blocks (all tracked Stories when no Key is given)
  apply.py --dry-run [KEY ...]    # print what would be applied
  apply.py --mark-only KEY ...    # record the current blocks as applied without changing the Board
"""
import hashlib
import re
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the skill folder
from factory_common import load, rowbly, save, thread_show, threads

BLOCK = re.compile(r"ROWBLY-UPDATE (\S+)\n(.*?)(?:```|\n\n|\Z)", re.S)

args = sys.argv[1:]
dry_run = "--dry-run" in args
mark_only = "--mark-only" in args
only = {a.upper() for a in args if not a.startswith("--")}
applied = set(load("applied.json", []))

for story, thread_id in threads():
    if only and story not in only:
        continue
    for message in thread_show(thread_id)["messages"]:
        if message["role"] != "assistant":
            continue
        for key, body in BLOCK.findall(message["text"]):
            digest = hashlib.sha1((key + body).encode()).hexdigest()[:12]
            if digest in applied or key != story:
                continue
            stage = re.search(r"^stage:\s*(\S+)", body, re.M)
            comment = re.search(r"^comment:\s*(.*)", body, re.M | re.S)
            text = comment.group(1).strip() if comment else ""
            wants_in_pr = bool(stage and stage.group(1) == "in-pr")
            if dry_run or mark_only:
                print(key, "would comment:" if dry_run else "marked:", text[:200], "| in-pr" if wants_in_pr else "")
                if mark_only:
                    applied.add(digest)
                continue
            if text:
                result = rowbly("comments", "add", key, "--body-file", "-", stdin=text)
                print(key, "comment", "ok" if result.returncode == 0 else f"FAILED {result.stdout}{result.stderr}")
                if result.returncode:
                    continue
            if wants_in_pr:
                result = rowbly("stories", "move", key, "in-pr")
                print(key, "moved to in-pr", "ok" if result.returncode == 0 else f"FAILED {result.stdout}{result.stderr}")
            applied.add(digest)

if not dry_run:
    save("applied.json", sorted(applied))
