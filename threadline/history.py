"""Read local session metadata. Transcript bodies stay in the source stores."""

import json
import re
import sqlite3
from collections import defaultdict
from contextlib import closing
from datetime import datetime
from pathlib import Path

UUID = re.compile(r"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}")
WORD = re.compile(r"[^\w]+", re.UNICODE)


def normalize(value):
    return WORD.sub(" ", value.casefold()).strip()


def title(value):
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if value.startswith(("<", "# AGENTS.md", "[Request interrupted", "/clear", "/compact")):
        return ""
    value = value.splitlines()[0] if value else ""
    return " ".join(value.split())[:140] if len(value.strip()) >= 8 else ""


def timestamp(value):
    try:
        if isinstance(value, str):
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
        value = int(value or 0)
        return value // 1000 if value >= 10**12 else value
    except (ValueError, TypeError, OverflowError):
        return 0


def records(path, max_lines=None):
    """Bound physical lines while allowing an active writer to leave a partial record."""
    limit = 256 * 1024
    with path.open("rb") as stream:
        count = 0
        while max_lines is None or count < max_lines:
            line = stream.readline(limit)
            if not line:
                break
            count += 1
            if len(line) == limit and not line.endswith(b"\n"):
                while line and not line.endswith(b"\n"):
                    line = stream.readline(limit)
                continue
            try:
                value = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if isinstance(value, dict):
                yield value


def recent_records(path):
    with path.open("rb") as stream:
        start = max(0, stream.seek(0, 2) - 96 * 1024)
        stream.seek(start)
        if start:
            stream.readline()
        for line in stream:
            try:
                item = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if isinstance(item, dict):
                yield item


def session(source, identity, label="", cwd="", when=0, archived=None):
    return {
        "key": f"{source}:{identity}",
        "source": source,
        "id": identity,
        "title": label or "Untitled session",
        "cwd": cwd if isinstance(cwd, str) else "",
        "updated": when,
        "archived": None if archived is None else bool(archived),
        "activity": "unknown",
        "workspace": "",
    }


def codex_sessions(root):
    found = {}
    excluded = set()
    errors = []
    index = root / "session_index.jsonl"
    for path in sorted(root.glob("state_*.sqlite"), reverse=True, key=lambda p: int(p.stem.split("_")[-1]) if p.stem.split("_")[-1].isdigit() else 0):
        try:
            with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=1)) as db:
                rows = db.execute("SELECT id, title, cwd, updated_at, archived, source FROM threads").fetchall()
        except sqlite3.Error:
            errors.append("Codex state database could not be read. Available index entries were used.")
            continue
        for identity, label, cwd, when, archived, source in rows:
            if not isinstance(identity, str) or not UUID.fullmatch(identity):
                continue
            if "subagent" in str(source).lower():
                excluded.add(identity)
                continue
            found[identity] = session("codex", identity, title(label), cwd, timestamp(when), archived)
        break

    if index.is_file():
        for item in records(index):
            identity = item.get("id")
            if not isinstance(identity, str) or not UUID.fullmatch(identity) or identity in excluded:
                continue
            row = found.setdefault(identity, session("codex", identity))
            row["title"] = title(item.get("thread_name")) or row["title"]
            row["updated"] = max(row["updated"], timestamp(item.get("updated_at")))

    # Older installations and copied histories can have rollouts outside the state DB.
    for archived, directory in [(False, "sessions"), (True, "archived_sessions")]:
        for path in (root / directory).rglob("rollout-*.jsonl*"):
            match = UUID.search(path.name)
            if not match or match[0] in excluded:
                continue
            identity = match[0]
            row = found.get(identity)
            if row and row["cwd"]:
                continue
            if path.suffix != ".jsonl":
                if row:
                    row["archived"] = archived
                continue
            cwd, label, when = "", "", 0
            for item in records(path, 48):
                payload = item.get("payload") or {}
                if not isinstance(payload, dict):
                    continue
                if item.get("type") == "session_meta":
                    if "subagent" in str(payload.get("source")).lower():
                        excluded.add(identity)
                        found.pop(identity, None)
                        break
                    cwd = payload.get("cwd") or ""
                    when = timestamp(item.get("timestamp") or payload.get("timestamp"))
                if item.get("type") == "event_msg" and payload.get("type") == "user_message":
                    label = title(payload.get("message"))
                    if label:
                        break
                if item.get("type") == "response_item" and payload.get("role") == "user":
                    content = payload.get("content")
                    if isinstance(content, list):
                        label = next((value for b in content if isinstance(b, dict)
                                      and (value := title(b.get("text")))), "")
                    if label:
                        break
            if identity not in excluded and (row or cwd or label):
                found[identity] = session("codex", identity, row["title"] if row and row["title"] != "Untitled session" else label,
                                          cwd, max(when, row["updated"] if row else 0), archived)
    return list(found.values()), errors


def claude_sessions(root, cache):
    found = {}
    history = root / "history.jsonl"
    if history.is_file():
        for item in records(history):
            identity = item.get("sessionId")
            if not isinstance(identity, str) or not UUID.fullmatch(identity):
                continue
            label = title(item.get("display"))
            if not label and identity not in found:
                continue
            row = found.setdefault(identity, session("claude", identity, label, item.get("project", "")))
            row["updated"] = max(row["updated"], timestamp(item.get("timestamp")))

    for path in (root / "projects").glob("*/*.jsonl"):
        identity = path.stem
        if not UUID.fullmatch(identity):
            continue
        try:
            modified = path.stat().st_mtime_ns
            cached = cache.get(path)
            if cached and cached[0] == modified:
                label, cwd, when = cached[1:]
            else:
                label, cwd, when = "", "", 0
                for item in records(path, 95):
                    if item.get("isSidechain") or item.get("isMeta"):
                        continue
                    kind = item.get("type")
                    if kind not in ("user", "assistant", "custom-title", "ai-title"):
                        continue
                    when = max(when, timestamp(item.get("timestamp")))
                    cwd = cwd or item.get("cwd") or ""
                    if kind in ("custom-title", "ai-title"):
                        label = title(item.get("customTitle") or item.get("aiTitle")) or label
                    if kind != "user" or label:
                        continue
                    message = item.get("message")
                    content = message.get("content") if isinstance(message, dict) else ""
                    if isinstance(content, list):
                        content = next((b.get("text") for b in content if isinstance(b, dict) and b.get("type") == "text"), "")
                    label = title(content)
                for item in recent_records(path):
                    if not item.get("isSidechain") and item.get("type") in ("user", "assistant", "custom-title", "ai-title"):
                        when = max(when, timestamp(item.get("timestamp")))
                        if item.get("type") in ("custom-title", "ai-title"):
                            label = title(item.get("customTitle") or item.get("aiTitle")) or label
                cache[path] = (modified, label, cwd, when)
        except OSError:
            continue
        if not label and identity not in found:
            continue
        row = found.setdefault(identity, session("claude", identity, label))
        row["cwd"] = cwd if isinstance(cwd, str) and cwd else row["cwd"]
        row["updated"] = max(row["updated"], when)
    return list(found.values()), []


def repo_root(cwd, memo):
    if cwd in memo:
        return memo[cwd]
    if not cwd.startswith("/") or cwd in ("/", str(Path.home())):
        return ""
    for parent in (Path(cwd), *Path(cwd).parents):
        if (parent / ".git").exists():
            memo[cwd] = str(parent)
            return memo[cwd]
    memo[cwd] = ""
    return ""


def load_history(codex_dir, claude_dir, cache):
    sessions, sources = [], {}
    for source, root, loader in [("codex", codex_dir, codex_sessions),
                                 ("claude", claude_dir, lambda p: claude_sessions(p, cache))]:
        try:
            rows, errors = loader(root)
        except (OSError, ValueError, AttributeError, TypeError):
            rows, errors = [], ["The local history could not be read."]
        if not root.is_dir():
            errors.append("History directory was not found.")
        sessions.extend(rows)
        sources[source] = {"count": len(rows), "note": " ".join(dict.fromkeys(errors))}
    memo = {}
    for row in sessions:
        row["workspace"] = repo_root(row["cwd"], memo)
    return sorted(sessions, key=lambda row: row["updated"], reverse=True), sources


def matches(row, project):
    if row["id"] in project["sessions"]:
        return 3
    cwd = row["cwd"].casefold().strip("/")
    if any(f"/{root.strip('/').casefold()}/" in f"/{cwd}/" for root in project["roots"]):
        return 2
    label = f" {normalize(row['title'])} "
    if any(f" {normalize(alias)} " in label for alias in project["aliases"] if normalize(alias)):
        return 1
    return 0


def organize(rows, projects, overrides):
    groups = defaultdict(list)
    by_project = {p["id"]: [] for p in projects}
    for row in rows:
        project_id = overrides.get(row["key"])
        if row["key"] not in overrides:
            # Tie between plausibly related projects stays in the inbox.
            scores = sorted(((matches(row, p), p["id"]) for p in projects), reverse=True)
            if scores and scores[0][0] and (len(scores) == 1 or scores[0][0] > scores[1][0]):
                project_id = scores[0][1]
        row["project"] = project_id if project_id in by_project else None
        if row["project"]:
            by_project[project_id].append(row)
        elif row["workspace"]:
            groups[row["workspace"]].append(row)
    suggestions = []
    for workspace, members in groups.items():
        if len(members) < 2:
            continue
        suggestions.append({
            "workspace": workspace,
            "name": Path(workspace).name,
            "sessions": [row["key"] for row in members],
            "updated": members[0]["updated"],
            "sources": sorted({row["source"] for row in members}),
        })
    suggestions.sort(key=lambda x: (len(x["sessions"]), x["updated"]), reverse=True)
    return by_project, suggestions
