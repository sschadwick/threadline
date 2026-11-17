"""A local project dashboard for Claude Code and Codex."""

import argparse
import json
import os
import tempfile
import threading
import time
from contextlib import ExitStack
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from ipaddress import IPv4Address
from pathlib import Path
from uuid import uuid4

from . import __version__
from .demo import demo_content
from .history import load_history, organize

WEB = files("threadline").joinpath("web")
STATUSES = ("In progress", "Prototype", "Planned", "Blocked", "Parked", "Completed")
FIELDS = {"name": 100, "area": 70, "summary": 2400, "next": 800, "evidence": 300}
ASSETS = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
          "/style.css": ("style.css", "text/css")}


class Tracker:
    def __init__(self, data, codex, claude, demo=False):
        self.path = data
        self.codex = codex
        self.claude = claude
        self.cache = {}
        self.lock = threading.RLock()
        self.demo = demo
        self.projects = []
        self.overrides = {}
        if data.exists():
            try:
                state = json.loads(data.read_text(encoding="utf-8"))
                self.projects, self.overrides = state["projects"], state["overrides"]
                if (not isinstance(self.projects, list) or not isinstance(self.overrides, dict)
                        or any(value is not None and not isinstance(value, str) for value in self.overrides.values())):
                    raise ValueError("Invalid project store")
                for project in self.projects:
                    if (any(not isinstance(project[key], str) for key in (*FIELDS, "id"))
                            or project["status"] not in STATUSES
                            or any(not isinstance(project[key], list) or any(not isinstance(value, str) for value in project[key])
                                   for key in ("aliases", "roots", "sessions"))):
                        raise ValueError("Invalid project")
                    date.fromisoformat(project["checkpoint"])
            except (ValueError, KeyError, TypeError) as error:
                raise ValueError(f"Could not read project store at {data}") from error
        elif demo:
            self.projects, _ = demo_content()
        self.rows = []
        self.sources = {}
        self.scanned = 0

    def refresh(self):
        if self.demo:
            _, self.rows = demo_content()
            self.sources = {source: {"count": sum(row["source"] == source for row in self.rows), "note": ""}
                            for source in ("codex", "claude")}
        else:
            self.rows, self.sources = load_history(self.codex, self.claude, self.cache)
        self.scanned = int(time.time())

    def snapshot(self, refresh=False):
        if refresh or self.scanned == 0:
            self.refresh()
        rows = [row.copy() for row in self.rows]
        by_project, suggestions = organize(rows, self.projects, self.overrides)
        projects = []
        for project in self.projects:
            linked = by_project[project["id"]]
            checkpoint = datetime.fromisoformat(project["checkpoint"]).timestamp()
            updated = max([int(checkpoint), *(s["updated"] for s in linked)])
            fields = {k: project[k] for k in (*FIELDS, "status", "id", "checkpoint")}
            projects.append({**fields, "updated": updated,
                             "revisit": project["status"] not in ("Completed", "Parked")
                             and self.scanned - updated >= 14 * 86400,
                             "sessions": [row["key"] for row in linked]})
        projects.sort(key=lambda p: p["updated"], reverse=True)
        return {"projects": projects, "sessions": rows, "sources": self.sources,
                "suggestions": suggestions, "scanned": self.scanned, "statuses": STATUSES,
                "demo": self.demo}

    def save(self, projects, overrides):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=self.path.parent, prefix=".threadline-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump({"projects": projects, "overrides": overrides}, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            Path(name).unlink(missing_ok=True)
        self.projects, self.overrides = projects, overrides

    def change(self, path, data):
        project_ids = {p["id"] for p in self.projects}
        known = {s["key"]: s for s in self.rows}
        projects, overrides = list(self.projects), dict(self.overrides)
        project_id = data.get("id")
        if path == "/api/project":
            previous = next((p for p in projects if p["id"] == project_id), None)
            if project_id is not None and not previous:
                raise ValueError("Project no longer exists.")
            values = {}
            for field, limit in FIELDS.items():
                value = data.get(field, "")
                if not isinstance(value, str) or len(value) > limit:
                    raise ValueError(f"{field.capitalize()} must be at most {limit} characters.")
                values[field] = value.strip()
            status = data.get("status")
            if not values["name"] or status not in STATUSES:
                raise ValueError("Enter a project name and status.")
            if previous:
                project = {**previous, **values, "status": status}
                if any(previous[k] != project[k] for k in (*FIELDS, "status")):
                    project["checkpoint"] = date.today().isoformat()
                projects[projects.index(previous)] = project
            else:
                project_id = uuid4().hex
                keys = data.get("sessions", [])
                if not isinstance(keys, list) or any(not isinstance(k, str) or k not in known for k in keys):
                    raise ValueError("Refresh the session list before creating the project.")
                workspace = data.get("workspace")
                if workspace is not None and (
                    not isinstance(workspace, str) or not keys
                    or any(known[k]["workspace"] != workspace for k in keys)
                ):
                    raise ValueError("Workspace does not match the selected sessions.")
                projects.append({**values, "id": project_id, "status": status,
                                 "checkpoint": date.today().isoformat(), "aliases": [values["name"]],
                                 "roots": [workspace] if workspace else [], "sessions": []})
                overrides.update(dict.fromkeys(keys, project_id))
        else:
            key = data.get("session")
            if not isinstance(key, str) or key not in known:
                raise ValueError("Session no longer exists. Refresh the session list.")
            if project_id is not None and (not isinstance(project_id, str) or project_id not in project_ids):
                raise ValueError("Project no longer exists.")
            overrides[key] = project_id
        self.save(projects, overrides)
        return {**self.snapshot(), "savedProject": project_id}


class Handler(BaseHTTPRequestHandler):
    timeout = 10

    def log_message(self, *_args):
        pass

    def respond(self, code, body, kind):
        self.send_response(code)
        self.send_header("Content-Type", kind + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, code, data):
        self.respond(code, json.dumps(data, ensure_ascii=False).encode(), "application/json")

    def allowed_request(self):
        bind, port = self.server.server_address
        host = self.headers.get("Host")
        origin = self.headers.get("Origin")
        hosts = {f"{bind}:{port}"}
        if bind == "127.0.0.1":
            hosts.add(f"localhost:{port}")
        return (self.client_address[0] in self.server.allowed_clients and host in hosts
                and (origin is None or origin == f"http://{host}"))

    def do_GET(self):
        if not self.allowed_request():
            self.send_json(403, {"error": "This client or address cannot access Threadline."})
            return
        path = self.path.partition("?")[0]
        if path in ASSETS:
            name, mime = ASSETS[path]
            self.respond(200, WEB.joinpath(name).read_bytes(), mime)
        elif path == "/api/state":
            with self.server.tracker.lock:
                data = self.server.tracker.snapshot()
            self.send_json(200, data)
        else:
            self.send_json(404, {"error": "Page not found."})

    def do_POST(self):
        if not self.allowed_request() or self.headers.get_content_type() != "application/json":
            self.send_json(403, {"error": "Use the dashboard from an allowed client to make changes."})
            return
        path = self.path.partition("?")[0]
        if path not in ("/api/project", "/api/link", "/api/refresh"):
            self.send_json(404, {"error": "Page not found."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 256 * 1024:
                raise ValueError("Invalid request size.")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("Invalid request.")
            tracker = self.server.tracker
            with tracker.lock:
                if path == "/api/refresh":
                    result = tracker.snapshot(refresh=True)
                else:
                    tracker.snapshot()
                    result = tracker.change(path, data)
            self.send_json(200, result)
        except (ValueError, UnicodeError) as error:
            self.send_json(400, {"error": str(error)})
        except OSError:
            self.send_json(500, {"error": "The project store is unavailable. Changes were not saved."})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", action="version", version=f"Threadline {__version__}")
    parser.add_argument("--port", type=int, default=8765, help="HTTP port (default: 8765)")
    parser.add_argument("--bind", type=IPv4Address, default=IPv4Address("127.0.0.1"),
                        help="Listen on this IPv4 address (default: 127.0.0.1)")
    parser.add_argument("--allow-from", action="append", type=IPv4Address, default=[],
                        help="Allow this client IPv4 address to access the service. Repeat for additional clients.")
    state_dir = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state")
    parser.add_argument("--data", type=Path, default=state_dir / "threadline" / "state.json",
                        help="Change where Threadline saves its project register")
    parser.add_argument("--codex-dir", type=Path, default=Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex"))
    parser.add_argument("--claude-dir", type=Path, default=Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude"))
    parser.add_argument("--demo", action="store_true", help="Try synthetic sessions in a temporary workspace")
    args = parser.parse_args()
    if args.bind.is_unspecified or args.bind.is_multicast or args.bind == IPv4Address("255.255.255.255"):
        parser.error("--bind requires a single interface address.")
    if not args.bind.is_loopback and not args.allow_from:
        parser.error("A non-loopback --bind requires at least one --allow-from address.")
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535.")
    with ExitStack() as stack:
        data = args.data.expanduser().resolve()
        if args.demo:
            data = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="threadline-demo-"))) / "state.json"
        try:
            server = stack.enter_context(ThreadingHTTPServer((str(args.bind), args.port), Handler))
            server.tracker = Tracker(data, args.codex_dir.expanduser().resolve(), args.claude_dir.expanduser().resolve(), args.demo)
        except (OSError, ValueError) as error:
            parser.exit(1, f"Threadline: {error}\n")
        server.daemon_threads = False
        server.allowed_clients = {str(address) for address in [args.bind, *args.allow_from]}
        print(f"Threadline → http://{args.bind}:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
