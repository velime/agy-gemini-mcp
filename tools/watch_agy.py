#!/usr/bin/env python3
"""watch_agy.py: a live view of what an Antigravity CLI (agy) agent is doing.

Reads agy's own step log (~/.gemini/antigravity-cli/conversations/<id>.db, read only) and prints one
line per new step: commands it runs, files it reads and writes, sub-agent calls, API errors.

    python watch_agy.py                    follow the most recently active conversation
    python watch_agy.py --conversation ID  follow one conversation
    python watch_agy.py --from-start       also print the steps that already exist

Standard library only. Stop with Ctrl-C.
"""
import argparse
import glob
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import time

CONV_DIR = os.path.join(os.path.expanduser("~"), ".gemini", "antigravity-cli", "conversations")


def mtime(db):
    return max(os.path.getmtime(p) for p in (db, db + "-wal") if os.path.exists(p))


def newest_db():
    dbs = glob.glob(os.path.join(CONV_DIR, "*.db"))
    return max(dbs, key=mtime) if dbs else None


def rows_after(db, last):
    """Steps with idx > last. Read only; falls back to a temporary copy if the live file is locked."""
    sql = "select idx, step_type, step_payload from steps where idx > ? order by idx"
    try:
        con = sqlite3.connect("file:%s?mode=ro" % db.replace("\\", "/"), uri=True, timeout=2)
        try:
            return con.execute(sql, (last,)).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        tmp = tempfile.mkdtemp()
        try:
            for suffix in ("", "-wal", "-shm"):
                if os.path.exists(db + suffix):
                    shutil.copy(db + suffix, os.path.join(tmp, os.path.basename(db) + suffix))
            con = sqlite3.connect(os.path.join(tmp, os.path.basename(db)))
            try:
                return con.execute(sql, (last,)).fetchall()
            finally:
                con.close()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def short(text, n=110):
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 3] + "..."


def describe(step_type, payload):
    """One line for a step, or None for steps that carry nothing readable."""
    raw = payload or b""
    if step_type == 15:
        return "think"
    if step_type == 17:
        return "ERR  API error or retry (the agent waited; a stalled stream can take up to 5 minutes)"
    if step_type != 132:
        return None
    # layout: ... call_<id> \x12 <len> <tool name> \x1a <len> {json arguments} ...
    name_m = re.search(rb"call_\d+\x12[\x00-\x1f]([A-Za-z_]+)", raw)
    name = name_m.group(1).decode() if name_m else ""
    data = {}
    start = raw.find(b"{")
    if start != -1:
        try:
            data, _ = json.JSONDecoder().raw_decode(raw[start:].decode("utf-8", "replace"))
        except ValueError:
            data = {}
    if not isinstance(data, dict):
        data = {}
    if name == "invoke_subagent" or b"invoke_subagent" in raw:
        return "agent " + short(data.get("Prompt", "sub-agent"), 100)
    if "CommandLine" in data:
        return "run   " + short(data.get("toolSummary") or data["CommandLine"])
    target = next((str(v) for k, v in data.items() if re.search(r"path|file|dir|url|query", k, re.I)
                   and isinstance(v, str) and v), "")
    if "Content" in data:
        return "write %s (%d chars)" % (short(target or name, 80), len(str(data["Content"])))
    return "%-5s %s" % ("read" if "view" in name or "read" in name or "list" in name else "tool",
                        short((name + " " + target).strip() or "call", 90))


def main():
    ap = argparse.ArgumentParser(description="Live view of an agy agent's steps.")
    ap.add_argument("--conversation", help="conversation id (default: the most recently active one)")
    ap.add_argument("--from-start", action="store_true", help="also print steps that already exist")
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    db, last, thinking = None, -1, False
    print("watching agy steps (Ctrl-C to stop)...", flush=True)
    while True:
        cur = os.path.join(CONV_DIR, args.conversation + ".db") if args.conversation else newest_db()
        if cur and cur != db:
            db = cur
            rows = rows_after(db, -1)
            last = -1 if args.from_start else (rows[-1][0] if rows else -1)
            print("[%s] following %s" % (time.strftime("%H:%M:%S"), os.path.basename(db)[:-3]), flush=True)
        if db:
            try:
                new = rows_after(db, last)
            except sqlite3.Error:
                new = []
            for idx, step_type, payload in new:
                last = idx
                line = describe(step_type, payload)
                if line is None:
                    continue
                if line == "think":  # print only the first of a run of thinking steps
                    if thinking:
                        continue
                    thinking = True
                else:
                    thinking = False
                print("[%s] %s" % (time.strftime("%H:%M:%S"), line), flush=True)
        time.sleep(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
