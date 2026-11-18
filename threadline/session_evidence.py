"""Read bounded dialogue excerpts from selected, locally available sessions."""

import json
import re
import sqlite3
from collections import deque
from contextlib import closing
from pathlib import Path

from .history import UUID

MAX_SESSIONS = 6
WINDOW = 1024 * 1024
SECRET = re.compile(r"(?i)\b(?:Bearer\s+\S+|sk-[\w-]{16,}|gh[pousr]_[\w]{16,}|AKIA[A-Z0-9]{16})")
ASSIGNMENT = re.compile(r"(?im)(\b[\w-]*(?:api[_-]?key|token|secret|password)[\w-]*\s*[:=]\s*)[^\s,;]+")


def redact(text):
    return ASSIGNMENT.sub(r"\1[REDACTED]", SECRET.sub("[REDACTED]", text))


def transcript_path(row, codex, claude):
    identity = row["id"]
    if not UUID.fullmatch(identity):
        return None
    root = codex if row["source"] == "codex" else claude
    candidates = []
    if row["source"] == "codex":
        for db_path in sorted(root.glob("state_*.sqlite"), reverse=True):
            try:
                with closing(sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True, timeout=1)) as db:
                    record = db.execute("SELECT rollout_path FROM threads WHERE id=?", (identity,)).fetchone()
                if record and isinstance(record[0], str):
                    candidates.append(Path(record[0]))
                break
            except sqlite3.Error:
                continue
        for directory in ("sessions", "archived_sessions"):
            candidates.extend((root / directory).rglob(f"*{identity}.jsonl"))
    else:
        candidates.extend((root / "projects").glob(f"*/{identity}.jsonl"))
    for path in candidates:
        try:
            if path.suffix == ".jsonl" and path.is_file() and path.resolve().is_relative_to(root.resolve()):
                return path
        except OSError:
            continue
    return None


def dialogue(item, source):
    if source == "codex":
        payload = item.get("payload")
        if (item.get("type") != "response_item" or not isinstance(payload, dict)
                or payload.get("type") != "message" or payload.get("channel") not in (None, "final")):
            return None
        message = payload
    else:
        if item.get("isSidechain") or item.get("isMeta") or item.get("type") not in ("user", "assistant"):
            return None
        message = item.get("message")
    if not isinstance(message, dict) or message.get("role") not in ("user", "assistant"):
        return None
    content = message.get("content", "")
    if isinstance(content, list):
        content = "\n".join(block.get("text", "") for block in content if isinstance(block, dict)
                            and block.get("type") in ("text", "input_text", "output_text")
                            and isinstance(block.get("text"), str))
    if not isinstance(content, str):
        return None
    content = content.strip()
    if not content or content.startswith(("# AGENTS.md", "<environment_context>", "<permissions", "<INSTRUCTIONS>")):
        return None
    return message["role"], redact(content[:1600])


def excerpts(row, path):
    first, recent, seen = [], deque(maxlen=40), set()
    size = path.stat().st_size
    with path.open("rb") as stream:
        for start, stop in ((0, min(size, WINDOW // 4)), (max(0, size - WINDOW), size)):
            stream.seek(start)
            if start:
                stream.readline(256 * 1024)
            while stream.tell() < stop:
                offset = stream.tell()
                line = stream.readline(256 * 1024)
                if not line:
                    break
                if not line.endswith(b"\n") and stream.tell() < size:
                    # Skip oversized physical records without parsing partial JSON.
                    while line and not line.endswith(b"\n"):
                        line = stream.readline(256 * 1024)
                        if stream.tell() >= stop:
                            break
                    continue
                if offset in seen:
                    continue
                seen.add(offset)
                try:
                    item = json.loads(line)
                except (ValueError, UnicodeError):
                    continue
                value = dialogue(item, row["source"]) if isinstance(item, dict) else None
                if value:
                    entry = {"reference": f"{row['key']}@{offset}", "session": row["key"],
                             "role": value[0], "text": value[1]}
                    if len(first) < 2:
                        first.append(entry)
                    recent.append(entry)
    chosen, remaining = list(first), 8000 - sum(len(item["text"]) for item in first)
    for item in reversed(recent):
        if item not in chosen and len(item["text"]) <= remaining:
            chosen.append(item)
            remaining -= len(item["text"])
    return sorted(chosen, key=lambda item: int(item["reference"].rsplit("@", 1)[1]))


def session_evidence(rows, codex, claude):
    evidence, coverage = [], []
    for row in rows:
        try:
            path = transcript_path(row, codex, claude)
            records = excerpts(row, path) if path else []
        except (OSError, ValueError):
            records = []
        evidence.extend(records)
        coverage.append({"session": row["key"], "title": row["title"], "excerpts": len(records),
                         "note": "Sampled dialogue; long messages are truncated and common credential patterns redacted."
                         if records else "No readable dialogue found. Missing or compressed histories need a local JSONL copy."})
    return {"excerpts": evidence, "coverage": coverage}
