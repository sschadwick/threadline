"""Suggest projects from local metadata and checkouts; never create or link them."""

import configparser
from pathlib import Path

from .history import normalize


def checkout_name(root):
    """Use only the repository name, never expose credentials from its remote."""
    try:
        git = root / ".git"
        if git.is_file():
            target = git.read_text(encoding="utf-8")[:4096].strip().removeprefix("gitdir: ")
            git = root / target
        if (git / "commondir").is_file():
            git = git / (git / "commondir").read_text(encoding="utf-8").strip()
        config = configparser.ConfigParser(interpolation=None)
        with (git / "config").open(encoding="utf-8") as stream:
            config.read_string(stream.read(65536))
        remote = config.get('remote "origin"', "url", fallback="").rstrip("/")
        name = remote.rsplit("/", 1)[-1].rsplit(":", 1)[-1].removesuffix(".git")
        if name and len(name) <= 100 and all(c.isalnum() or c in "-_." for c in name):
            return name
    except (OSError, ValueError, configparser.Error):
        pass
    return root.name[:100]


def session_roots(cwd, workspace):
    root = Path(cwd)
    if not root.is_absolute() or root in (Path("/"), Path.home()):
        return []
    # Generated chat directories can contain a checkout instead of being one.
    # Inspect two established locations, not the full filesystem or transcripts.
    try:
        children = sorted(root.glob("*/.git"))[:40] + sorted(root.glob("outputs/*/.git"))[:40]
    except OSError:
        children = []
    if children:
        return [(str(path.parent), checkout_name(path.parent), "Checkout inside session directory") for path in children]
    if (root / ".git").exists():
        return [(str(root), checkout_name(root), "Repository checkout")]
    # A distant shared ancestor, such as Documents/Codex, conflates separate chats.
    if workspace and Path(workspace) == root.parent and (root.parent / ".git").exists():
        return [(workspace, checkout_name(root.parent), "Repository checkout")]
    return [(str(root), root.name[:100], "Shared session directory")]


def suggest_projects(rows, projects, overrides):
    groups, roots = {}, {}
    unlinked = [row for row in rows if not row["project"] and row["key"] not in overrides]
    for row in unlinked:
        location = (row["cwd"], row["workspace"])
        if location not in roots:
            roots[location] = session_roots(*location)
        for workspace, name, reason in roots[location]:
            # Restoring or linking an existing project is separate from discovery.
            if any(workspace in project["roots"] or normalize(name) in
                   [normalize(value) for value in (project["name"], *project["aliases"])] for project in projects):
                continue
            group = groups.setdefault(workspace, {"id": workspace, "workspace": workspace,
                                                  "name": name, "reason": reason, "members": {}})
            group["members"][row["key"]] = row
    repositories = [group for group in groups.values() if group["reason"] != "Shared session directory"]
    for row in unlinked:
        if not Path(row["cwd"]).is_absolute() or not Path(row["cwd"]).is_dir():
            continue
        label = f" {normalize(row['title'])} "
        matched = [group for group in repositories if len(normalize(group["name"])) >= 4
                   and f" {normalize(group['name'])} " in label]
        if len(matched) == 1:
            for group in groups.values():
                group["members"].pop(row["key"], None)
            matched[0]["members"][row["key"]] = row
    suggestions = []
    for group in groups.values():
        members = sorted(group.pop("members").values(), key=lambda row: row["updated"], reverse=True)
        if not members or (group["reason"] == "Shared session directory" and len(members) < 2):
            continue
        suggestions.append({**group, "sessions": [row["key"] for row in members],
                            "updated": members[0]["updated"],
                            "sources": sorted({row["source"] for row in members})})
    return sorted(suggestions, key=lambda group: (len(group["sessions"]), group["updated"]), reverse=True)
