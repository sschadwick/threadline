"""A local project dashboard for Claude Code and Codex."""

import argparse
import json
import os
import signal
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
from .activity import read_activity
from .demo import demo_content
from .discovery import suggest_projects
from .history import load_history, organize
from .kickoff import eval_summary, new_decision, new_eval, render_kickoff, replay, revisit_state, update_revisit
from .patterns import PATTERNS, checkpoint_fields, preview_kickoff
from .project_draft import prepare_draft, validate_draft
from .runner import PROVIDERS, RunError, Runner
from .session_evidence import session_evidence
from .session_review import SCHEMA as REVIEW_SCHEMA, apply_review, fingerprint, prompt_for, select_context, validate_review

WEB = files("threadline").joinpath("web")
STATUSES = ("In progress", "In production", "Prototype", "Planned", "Blocked", "Parked", "Completed")
FIELDS = {"name": 100, "area": 70, "summary": 2400, "next": 800, "evidence": 300}
ASSETS = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
          "/style.css": ("style.css", "text/css")}
RUN_FIELDS = ("id", "project", "pattern", "pattern_revision", "provider", "workspace", "task", "status",
              "started", "finished", "session_id", "result", "error", "review")


class Tracker:
    def __init__(self, data, codex, claude, demo=False, runner=None, *, live_activity=False, codex_socket=None):
        self.path = data
        self.codex = codex
        self.claude = claude
        self.cache = {}
        self.lock = threading.RLock()
        self.draft_lock = threading.Lock()
        self.demo = demo
        self.live_activity = live_activity
        self.codex_socket = codex_socket
        self.runner = runner or Runner()
        self.worker = None
        self.projects = []
        self.overrides = {}
        self.runs = []
        self.dismissed_suggestions = []
        self.session_reviews = {}
        if data.exists():
            try:
                state = json.loads(data.read_text(encoding="utf-8"))
                self.projects, self.overrides = state["projects"], state["overrides"]
                self.runs = state.get("runs", [])
                self.dismissed_suggestions = state.get("dismissed_suggestions", [])
                self.session_reviews = state.get("session_reviews", {})
                if (not isinstance(self.projects, list) or not isinstance(self.overrides, dict)
                        or not isinstance(self.runs, list)
                        or not isinstance(self.dismissed_suggestions, list)
                        or any(not isinstance(value, str) for value in self.dismissed_suggestions)
                        or not isinstance(self.session_reviews, dict)
                        or any(not isinstance(value, dict) or not {"id", "fingerprint", "provider", "decisions", "evals", "coverage", "notes"} <= value.keys()
                               or any(not isinstance(value[key], list) for key in ("decisions", "evals", "coverage"))
                               or any(not isinstance(value[key], str) for key in ("id", "fingerprint", "provider", "notes"))
                               for value in self.session_reviews.values())
                        or any(not isinstance(run, dict) or not set(RUN_FIELDS).issubset(run)
                               or not {"digest", "checkpoint"} <= run.keys() for run in self.runs)
                        or any(value is not None and not isinstance(value, str) for value in self.overrides.values())):
                    raise ValueError("Invalid project store")
                for project in self.projects:
                    if (any(not isinstance(project[key], str) for key in (*FIELDS, "id"))
                            or project["status"] not in STATUSES
                            or not isinstance(project.get("archived", False), bool)
                            or not isinstance(project.get("continuation_session"), (str, type(None)))
                            or any(not isinstance(project[key], list) or any(not isinstance(value, str) for value in project[key])
                                   for key in ("aliases", "roots", "sessions"))):
                        raise ValueError("Invalid project")
                    date.fromisoformat(project["checkpoint"])
                    if project.pop("in_production", False) is True:
                        project["status"] = "In production"
            except (ValueError, KeyError, TypeError) as error:
                raise ValueError(f"Could not read project store at {data}") from error
        elif demo:
            self.projects, _ = demo_content()
        self.rows = []
        self.sources = {}
        self.scanned = 0
        if any(run["status"] == "running" for run in self.runs):
            recovered = [
                {**run, "status": "interrupted", "error": "Threadline stopped before recording a result.",
                 "finished": int(time.time())} if run["status"] == "running" else run
                for run in self.runs
            ]
            self.save(self.projects, self.overrides, recovered)

    def refresh(self):
        if self.demo:
            _, self.rows = demo_content()
            self.sources = {source: {"count": sum(row["source"] == source for row in self.rows), "note": "",
                                     "activity_available": True}
                            for source in ("codex", "claude")}
        else:
            self.rows, self.sources = load_history(self.codex, self.claude, self.cache)
            if self.live_activity:
                read_activity(self.rows, self.sources, self.claude, self.codex_socket)
        self.scanned = int(time.time())

    def snapshot(self, refresh=False):
        if refresh or self.scanned == 0:
            self.refresh()
        rows = [row.copy() for row in self.rows]
        by_project, _ = organize(rows, self.projects, self.overrides)
        suggestions = [{**group, "dismissed": group["id"] in self.dismissed_suggestions}
                       for group in suggest_projects(rows, self.projects, self.overrides)]
        projects = []
        for project in self.projects:
            linked = by_project[project["id"]]
            pin = project.get("continuation_session")
            checkpoint = datetime.fromisoformat(project["checkpoint"]).timestamp()
            updated = max([int(checkpoint), *(s["updated"] for s in linked)])
            reminder = revisit_state(project, updated, self.scanned)
            decisions = project.get("decisions", [])
            review = self.session_reviews.get(project["id"])
            fields = {k: project[k] for k in (*FIELDS, "status", "id", "checkpoint")}
            projects.append({**fields, "updated": updated,
                             "revisit": reminder in ("due", "inactive"), "revisit_state": reminder,
                             "archived": project.get("archived", False),
                             "continuation_session": pin if any(row["key"] == pin for row in linked) else None,
                             "revisit_later": project.get("revisit_later", False),
                             "revisit_on": project.get("revisit_on"),
                             "workspaces": sorted(set(project["roots"]) | {row["workspace"] for row in linked if row["workspace"]}),
                             "sessions": [row["key"] for row in linked],
                             "decisions": decisions,
                             "session_review": {**review, "stale": review["fingerprint"] != fingerprint(project, [row["key"] for row in linked])}
                             if review and not review.get("applied") else None,
                             "evals": [eval_summary(case) for case in project.get("evals", [])],
                             "kickoff": render_kickoff(project, linked, decisions)})
        projects.sort(key=lambda p: p["updated"], reverse=True)
        return {"projects": projects, "sessions": rows, "sources": self.sources,
                "suggestions": suggestions, "scanned": self.scanned, "statuses": STATUSES,
                "demo": self.demo, "patterns": PATTERNS, "runner": self.runner.options(),
                "drafting": self.draft_lock.locked(),
                "outbox": [{**{key: run[key] for key in RUN_FIELDS}, "acknowledged": run.get("acknowledged", False)}
                           for run in reversed(self.runs)]}

    def save(self, projects, overrides, runs=None, *, dismissed_suggestions=None, session_reviews=None):
        runs = self.runs if runs is None else runs
        dismissed_suggestions = self.dismissed_suggestions if dismissed_suggestions is None else dismissed_suggestions
        session_reviews = self.session_reviews if session_reviews is None else session_reviews
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=self.path.parent, prefix=".threadline-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump({"projects": projects, "overrides": overrides, "runs": runs,
                           "dismissed_suggestions": dismissed_suggestions, "session_reviews": session_reviews}, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            Path(name).unlink(missing_ok=True)
        self.projects, self.overrides, self.runs = projects, overrides, runs
        self.dismissed_suggestions = dismissed_suggestions
        self.session_reviews = session_reviews

    def preview(self, data):
        project = next((p for p in self.projects if p["id"] == data.get("project")), None)
        if project is None:
            raise ValueError("Choose a project.")
        if project.get("archived"):
            raise ValueError("Restore this project before preparing a kickoff.")
        if self.scanned == 0:
            self.refresh()
        linked, _ = organize([row.copy() for row in self.rows], self.projects, self.overrides)
        return preview_kickoff(project, linked[project["id"]], data, self.runner.options())

    def draft_project(self, data):
        if self.demo:
            raise ValueError("AI drafting is unavailable in demo mode.")
        if not self.draft_lock.acquire(blocking=False):
            raise RunError("An AI project draft is already being generated. Try again shortly.")
        try:
            with self.lock:
                provider, prompt, schema = prepare_draft(data, self.snapshot())
            try:
                result = self.runner.draft(provider, prompt, schema)
            except OSError as error:
                raise RunError("Could not start the AI provider. You can fill the form manually.") from error
            except (ValueError, KeyError, TypeError) as error:
                raise RunError("AI returned an invalid project draft. You can fill the form manually.") from error
            return validate_draft(result, STATUSES)
        finally:
            self.draft_lock.release()

    def review_context(self, data):
        if self.demo:
            raise ValueError("Session analysis is unavailable in demo mode.")
        with self.lock:
            project, rows = select_context(data, self.snapshot())
        return project, session_evidence(rows, self.codex, self.claude)

    def analyze_sessions(self, data):
        if not self.draft_lock.acquire(blocking=False):
            raise RunError("An AI request is already running. Try again shortly.")
        try:
            with self.lock:
                provider = data.get("provider")
                if not isinstance(provider, str) or provider not in self.runner.options()["providers"]:
                    raise ValueError("Choose an enabled AI provider.")
                project, rows = select_context(data, self.snapshot())
                original = next(item for item in self.projects if item["id"] == project["id"])
                baseline = fingerprint(original, project["sessions"])
            if self.demo:
                raise ValueError("Session analysis is unavailable in demo mode.")
            evidence = session_evidence(rows, self.codex, self.claude)
            prompt = prompt_for(project, evidence)
            try:
                result = self.runner.draft(provider, prompt, REVIEW_SCHEMA)
                clean = validate_review(result, project, evidence)
            except OSError as error:
                raise RunError("Could not start the session-analysis provider.") from error
            except (ValueError, TypeError, KeyError) as error:
                raise RunError("The agent returned an invalid session review. Nothing was applied.") from error
            review = {**clean, "id": uuid4().hex, "fingerprint": baseline, "provider": provider}
            with self.lock:
                self.save(self.projects, self.overrides, session_reviews={**self.session_reviews, project["id"]: review})
        finally:
            self.draft_lock.release()
        with self.lock:
            return self.snapshot()

    def apply_session_review(self, path, data):
        project = next((item for item in self.projects if item["id"] == data.get("project")), None)
        review = self.session_reviews.get(project["id"]) if project else None
        if project is None or project.get("archived") or review is None or review["id"] != data.get("review"):
            raise ValueError("Choose a current session review for an active project.")
        reviews = dict(self.session_reviews)
        if path == "/api/session-review-dismiss":
            reviews.pop(project["id"])
            self.save(self.projects, self.overrides, session_reviews=reviews)
        else:
            snapshot = next(item for item in self.snapshot()["projects"] if item["id"] == project["id"])
            linked = {row["key"]: row for row in self.rows if row["key"] in snapshot["sessions"]}
            updated, applied = apply_review(data, review, project, linked)
            if review.get("applied"):
                return self.snapshot()
            reviews[project["id"]] = applied
            projects = [updated if item["id"] == project["id"] else item for item in self.projects]
            self.save(projects, self.overrides, session_reviews=reviews)
        return self.snapshot()

    def launch(self, data):
        request_id = data.get("request_id")
        if not isinstance(request_id, str) or len(request_id) != 32 or any(c not in "0123456789abcdef" for c in request_id):
            raise ValueError("Preview the kickoff before starting a session.")
        previous = next((run for run in self.runs if run["id"] == request_id), None)
        if previous:
            if previous["digest"] != data.get("digest"):
                raise ValueError("Preview again to start a different session.")
            return self.snapshot()
        preview = self.preview(data)
        if not preview["provider"] or preview["digest"] != data.get("digest"):
            raise ValueError("Preview the kickoff again before starting the session.")
        if self.runner.stop.is_set() or any(run["status"] == "running" for run in self.runs):
            raise ValueError("A session is already running or Threadline is shutting down.")
        run = {**preview, "id": request_id, "status": "running", "started": int(time.time()),
               "finished": None, "session_id": None, "result": None, "error": "", "review": {}}
        self.save(self.projects, self.overrides, [*self.runs, run])
        self.worker = threading.Thread(target=self.finish_launch, args=(run,), name="threadline-runner")
        try:
            self.worker.start()
        except RuntimeError:
            self.worker = None
            failed = {**run, "status": "failed", "finished": int(time.time()), "error": "Could not start the worker."}
            self.save(self.projects, self.overrides, [*self.runs[:-1], failed])
        return self.snapshot()

    def finish_launch(self, run):
        try:
            session_id, result = self.runner.run(run)
            completed = {**run, "status": "completed", "session_id": session_id, "result": result,
                         "review": {key: "pending" for key in ("checkpoint", "decision") if result[key]}}
        except RunError as error:
            completed = {**run, "status": "failed", "error": str(error)}
        except OSError:
            completed = {**run, "status": "failed", "error": "Could not run the configured CLI in that workspace."}
        except (ValueError, KeyError, TypeError):
            completed = {**run, "status": "failed", "error": "The runner response did not match the Outbox result format."}
        completed["finished"] = int(time.time())
        with self.lock:
            runs = [completed if item["id"] == run["id"] else item for item in self.runs]
            overrides = self.overrides.copy()
            if completed["session_id"]:
                overrides.setdefault(f"{run['provider']}:{completed['session_id']}", run["project"])
                self.scanned = 0
            try:
                self.save(self.projects, overrides, runs)
            except OSError:
                completed["error"] = "Could not save the result. It remains available until Threadline stops."
                self.runs, self.overrides = runs, overrides

    def review(self, data):
        run = next((item for item in self.runs if item["id"] == data.get("run")), None)
        key, action = data.get("proposal"), data.get("action")
        if run is None or key not in ("checkpoint", "decision") or action not in ("accept", "dismiss"):
            raise ValueError("Choose an Outbox proposal and review action.")
        if run["review"].get(key) != "pending":
            return self.snapshot()
        projects = list(self.projects)
        if action == "accept":
            previous = next((p for p in projects if p["id"] == run["project"]), None)
            if previous is None:
                raise ValueError("Project no longer exists.")
            proposal = run["result"][key]
            source = f"{proposal['source']} · {PROVIDERS[run['provider']]} session {run['session_id']}"
            if key == "checkpoint":
                if checkpoint_fields(previous) != run["checkpoint"]:
                    raise ValueError("The checkpoint changed after launch. Review the proposal and update the project manually.")
                project = {**previous, "summary": proposal["summary"], "next": proposal["next"], "evidence": source,
                           "checkpoint": date.today().isoformat()}
            else:
                decisions = previous.get("decisions", [])
                project = {**previous, "decisions": [*decisions, new_decision({**proposal, "source": source}, decisions, {})]}
            projects[projects.index(previous)] = project
        state = "accepted" if action == "accept" else "dismissed"
        reviewed = {**run, "review": {**run["review"], key: state}}
        self.save(projects, self.overrides, [reviewed if item["id"] == run["id"] else item for item in self.runs])
        return self.snapshot()

    def acknowledge(self, data):
        run = next((item for item in self.runs if item["id"] == data.get("run")), None)
        if run is None or run["status"] not in ("failed", "interrupted"):
            raise ValueError("Choose a failed or interrupted run.")
        if not run.get("acknowledged"):
            runs = [{**item, "acknowledged": True} if item["id"] == run["id"] else item for item in self.runs]
            self.save(self.projects, self.overrides, runs)
        return self.snapshot()

    def change(self, path, data):
        if path in ("/api/session-review-apply", "/api/session-review-dismiss"):
            return self.apply_session_review(path, data)
        if path == "/api/suggestion":
            identity, dismissed = data.get("suggestion"), data.get("dismissed")
            if not isinstance(identity, str) or not isinstance(dismissed, bool):
                raise ValueError("Choose a suggested project and review action.")
            if not any(group["id"] == identity for group in self.snapshot()["suggestions"]):
                raise ValueError("Suggested project no longer exists. Refresh the suggestions.")
            reviewed = [value for value in self.dismissed_suggestions if value != identity]
            if dismissed:
                reviewed.append(identity)
            self.save(self.projects, self.overrides, dismissed_suggestions=reviewed)
            return self.snapshot()
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
            status = "In production" if data.get("in_production") is True else data.get("status")
            if not values["name"] or status not in STATUSES:
                raise ValueError("Enter a project name and status.")
            if previous:
                project = {**previous, **values, "status": status}
                if any(previous[k] != project[k] for k in FIELDS):
                    project["checkpoint"] = date.today().isoformat()
                update_revisit(project, data)
                projects[projects.index(previous)] = project
            else:
                project_id = uuid4().hex
                suggestion = None
                if "suggestion" in data:
                    suggestion = next((group for group in self.snapshot()["suggestions"]
                                       if group["id"] == data["suggestion"] and not group["dismissed"]), None)
                    if suggestion is None:
                        raise ValueError("Suggested project no longer exists. Refresh the suggestions.")
                keys = data.get("sessions", [])
                if not isinstance(keys, list) or any(not isinstance(k, str) or k not in known for k in keys):
                    raise ValueError("Refresh the session list before creating the project.")
                if suggestion is not None and (not keys or len(keys) != len(set(keys))
                                               or not set(keys) <= set(suggestion["sessions"])):
                    raise ValueError("Choose sessions from the suggested project.")
                workspace = data.get("workspace")
                if workspace is not None and (
                    not isinstance(workspace, str) or not keys
                    or any(known[k]["workspace"] != workspace for k in keys)
                ):
                    raise ValueError("Workspace does not match the selected sessions.")
                project = {**values, "id": project_id, "status": status,
                           "checkpoint": date.today().isoformat(), "aliases": [values["name"]],
                           "roots": [suggestion["workspace"]] if suggestion else [workspace] if workspace else [],
                           "sessions": []}
                if suggestion and suggestion["name"] not in project["aliases"]:
                    project["aliases"].append(suggestion["name"])
                update_revisit(project, data)
                projects.append(project)
                overrides.update(dict.fromkeys(keys, project_id))
                if suggestion:
                    overrides.update(dict.fromkeys(set(suggestion["sessions"]) - set(keys), None))
        elif path == "/api/link":
            key = data.get("session")
            if not isinstance(key, str) or key not in known:
                raise ValueError("Session no longer exists. Refresh the session list.")
            if project_id is not None and (not isinstance(project_id, str) or project_id not in project_ids):
                raise ValueError("Project no longer exists.")
            overrides[key] = project_id
        else:
            previous = next((p for p in projects if p["id"] == project_id), None)
            if previous is None:
                raise ValueError("Project no longer exists.")
            project = dict(previous)
            if path == "/api/project-state":
                if "status" in data and "archived" not in data and data["status"] in STATUSES:
                    project["status"] = data["status"]
                elif "status" not in data and isinstance(data.get("archived"), bool):
                    project["archived"] = data["archived"]
                else:
                    raise ValueError("Choose a project status or archive action.")
            elif path == "/api/project-pin":
                if "session" not in data:
                    raise ValueError("Choose a session or clear the pin.")
                key = data.get("session")
                if key is not None:
                    if not isinstance(key, str) or key not in known:
                        raise ValueError("Choose a session linked to the project.")
                    linked, _ = organize([row.copy() for row in self.rows], self.projects, self.overrides)
                    if not any(session["key"] == key for session in linked[project_id]):
                        raise ValueError("Choose a session linked to the project.")
                project["continuation_session"] = key
            else:
                self.change_kickoff(project, path, data, known)
            projects[projects.index(previous)] = project
        for index, project in enumerate(projects):
            pinned = project.get("continuation_session")
            if pinned in overrides and overrides[pinned] != project["id"]:
                projects[index] = {**project, "continuation_session": None}
        self.save(projects, overrides)
        return {**self.snapshot(), "savedProject": project_id}

    def change_kickoff(self, project, path, data, known):
        decisions = project.get("decisions", [])
        cases = list(project.get("evals", []))
        if path == "/api/replay":
            index = next((i for i, case in enumerate(cases) if case["id"] == data.get("case")), None)
            if index is None:
                raise ValueError("Eval case no longer exists.")
            case = cases[index]
            cases[index] = {**case, "results": [*case["results"], replay(case)]}
            project["evals"] = cases
            return
        snapshot = next(item for item in self.snapshot()["projects"] if item["id"] == project["id"])
        linked = {key: known[key] for key in snapshot["sessions"]}
        if path == "/api/decision":
            project["decisions"] = [*decisions, new_decision(data, decisions, linked)]
        else:
            project["evals"] = [*cases, new_eval(data, project, list(linked.values()), decisions)]


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
        if path not in ("/api/project", "/api/project-state", "/api/link", "/api/refresh", "/api/decision", "/api/eval", "/api/replay",
                        "/api/kickoff", "/api/launch", "/api/review", "/api/project-pin", "/api/run-acknowledge",
                        "/api/suggestion", "/api/project-draft", "/api/session-review", "/api/session-review-context",
                        "/api/session-review-apply", "/api/session-review-dismiss"):
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
            if path == "/api/project-draft":
                self.send_json(200, tracker.draft_project(data))
                return
            if path == "/api/session-review-context":
                self.send_json(200, tracker.review_context(data)[1])
                return
            if path == "/api/session-review":
                self.send_json(200, tracker.analyze_sessions(data))
                return
            with tracker.lock:
                if path == "/api/refresh":
                    result = tracker.snapshot(refresh=True)
                elif path == "/api/kickoff":
                    preview = tracker.preview(data)
                    result = {"brief": preview["brief"], "digest": preview["digest"], "request_id": uuid4().hex}
                elif path == "/api/launch":
                    result = tracker.launch(data)
                elif path == "/api/review":
                    result = tracker.review(data)
                elif path == "/api/run-acknowledge":
                    result = tracker.acknowledge(data)
                else:
                    tracker.snapshot()
                    result = tracker.change(path, data)
            self.send_json(200, result)
        except RunError as error:
            self.send_json(503, {"error": str(error)})
        except (ValueError, UnicodeError) as error:
            self.send_json(400, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            return
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
    parser.add_argument("--codex-socket", type=Path, help="Read live state from an existing local Codex App Server socket.")
    parser.add_argument("--claude-dir", type=Path, default=Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude"))
    parser.add_argument("--demo", action="store_true", help="Try synthetic sessions in a temporary workspace")
    parser.add_argument("--runner", action="append", choices=PROVIDERS, default=[],
                        help="Enable read-only launches with this installed CLI. Repeat for additional providers.")
    parser.add_argument("--runner-workspace", action="append", type=Path, default=[],
                        help="Permit launches from this directory. Repeat for additional workspaces.")
    args = parser.parse_args()
    if args.bind.is_unspecified or args.bind.is_multicast or args.bind == IPv4Address("255.255.255.255"):
        parser.error("--bind requires a single interface address.")
    if not args.bind.is_loopback and not args.allow_from:
        parser.error("A non-loopback --bind requires at least one --allow-from address.")
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535.")
    if args.demo and args.runner:
        parser.error("Session launch requires a non-demo register.")
    if not all(WEB.joinpath(name).is_file() for name, _ in ASSETS.values()):
        parser.exit(1, "Build the frontend first with npm --prefix frontend run build.\n")
    with ExitStack() as stack:
        data = args.data.expanduser().resolve()
        if args.demo:
            data = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="threadline-demo-"))) / "state.json"
        try:
            runner = Runner(args.runner, args.runner_workspace)
            server = stack.enter_context(ThreadingHTTPServer((str(args.bind), args.port), Handler))
            server.tracker = Tracker(data, args.codex_dir.expanduser().resolve(), args.claude_dir.expanduser().resolve(),
                                     args.demo, runner, live_activity=True,
                                     codex_socket=args.codex_socket.expanduser() if args.codex_socket else None)
        except (OSError, ValueError) as error:
            parser.exit(1, f"Threadline: {error}\n")
        server.daemon_threads = False
        server.allowed_clients = {str(address) for address in [args.bind, *args.allow_from]}
        print(f"Threadline → http://{args.bind}:{server.server_port}", flush=True)
        def interrupt(*_args):
            raise KeyboardInterrupt

        signal.signal(signal.SIGTERM, interrupt)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            runner.stop.set()
            if server.tracker.worker:
                server.tracker.worker.join()
