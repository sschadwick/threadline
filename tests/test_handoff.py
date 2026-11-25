import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from threadline.history import session
from threadline.runner import RunError, Runner, reported_usage
from threadline.server import Tracker

PRODUCER = "11111111-1111-4111-8111-111111111111"
AUDITOR = "22222222-2222-4222-8222-222222222222"


class AuditRunner(Runner):
    def __init__(self, workspace, commit):
        super().__init__()
        self.workspaces = [str(workspace)]
        self.commands = {"claude": "unused by fixture"}
        self.commit = commit
        self.attempts = []
        self.return_commit = commit

    def execute(self, provider, workspace, brief, schema, **options):
        self.attempts.append({"candidate": (workspace / "example.py").read_text(), "git": (workspace / ".git").exists(),
                              "brief": brief, "provider": provider})
        return json.dumps({"type": "result", "session_id": AUDITOR, "usage": {
            "input_tokens": 100, "output_tokens": 20, "cache_read_input_tokens": 5,
        }, "structured_output": {"commit": self.return_commit, "summary": "Reviewed example.py.", "verdict": "pass"}}).encode()


class HandoffTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        git = ["git", "-C", str(self.workspace), "-c", "user.name=Test", "-c", "user.email=test@example.org"]
        subprocess.run([*git, "init", "-q"], check=True)
        file = self.workspace / "example.py"
        file.write_text("candidate = True\n")
        subprocess.run([*git, "add", "example.py"], check=True)
        subprocess.run([*git, "commit", "-qm", "Candidate"], check=True)
        self.commit = subprocess.check_output([*git, "rev-parse", "HEAD"], text=True).strip()
        file.write_text("candidate = False\n")
        subprocess.run([*git, "commit", "-qam", "Later revision"], check=True)
        self.runner = AuditRunner(self.workspace, self.commit)
        self.row = {**session("codex", PRODUCER, "Private transcript title", str(self.workspace), 1),
                    "workspace": str(self.workspace)}
        self.tracker = self.restore()
        self.project = self.tracker.change("/api/project", {"name": "Example", "status": "In progress",
            "summary": "Unrelated project checkpoint", "sessions": [self.row["key"]]})["savedProject"]
        self.roadmap("save", title="Ship", outcome="Ship securely", criteria="Preserve old inputs")
        milestone = self.snapshot()["roadmap"][0]
        self.milestone = milestone["id"]
        self.roadmap("activate", milestone=self.milestone, revision=milestone["revision"])
        self.roadmap("add item", milestone=self.milestone, revision=self.snapshot()["roadmap"][0]["revision"],
                     title="Review the change", outcome="Supporting old inputs", status="in progress")
        self.item = self.snapshot()["roadmap"][0]["items"][0]["id"]
        self.location = {"milestone": self.milestone, "item": self.item}
        self.draft = {"project": self.project, **self.location, "audit": True}

    def restore(self):
        tracker = Tracker(self.root / "state.json", self.root / "codex", self.root / "claude", runner=self.runner)
        tracker.rows, tracker.scanned = [self.row.copy()], 1
        tracker.refresh = lambda: setattr(tracker, "scanned", 1)
        return tracker

    def snapshot(self):
        return self.tracker.snapshot()["projects"][0]

    def work_item(self):
        return self.snapshot()["roadmap"][0]["items"][0]

    def roadmap(self, action, **data):
        return self.tracker.change("/api/roadmap", {"project": self.project, "action": action, **data})

    def candidate(self, **data):
        values = {**self.location, "revision": self.work_item()["revision"], "commit": self.commit,
                  "producer": self.row["key"], "auditor": "claude", "workspace": str(self.workspace),
                  "checks": "Two checks passed", **data}
        return self.roadmap("audit candidate", **values)

    def launch(self, preview):
        request = {**self.draft, "request_id": uuid4().hex, "digest": preview["digest"]}
        with self.tracker.lock:
            self.tracker.launch(request)
        self.tracker.worker.join(5)
        self.assertFalse(self.tracker.worker.is_alive())
        return request

    def test_small_handoff_reads_exact_commit_and_counts_attempts(self):
        self.candidate()
        self.assertEqual(self.snapshot()["next_action"]["kind"], "handoff")
        preview = self.tracker.preview(self.draft)
        self.assertIn("Preserve old inputs", preview["brief"])
        self.assertIn("Two checks passed", preview["brief"])
        self.assertNotIn("Unrelated project checkpoint", preview["brief"])
        self.assertNotIn("Private transcript title", preview["brief"])
        self.assertEqual(self.runner.attempts, [])
        self.runner.return_commit = "a" * 40
        self.launch(preview)
        self.assertEqual(self.work_item()["audit"]["status"], "failed")
        self.runner.return_commit = self.commit
        request = self.launch(preview)
        self.assertEqual(self.runner.attempts[-1]["candidate"], "candidate = True\n")
        self.assertFalse(self.runner.attempts[-1]["git"])
        self.assertEqual(self.work_item()["audit"]["usage"], {"input_tokens": 210, "output_tokens": 40})
        self.tracker.launch(request)
        with self.assertRaisesRegex(ValueError, "already has a completed audit"):
            self.tracker.launch({**request, "request_id": uuid4().hex})
        self.assertEqual(len(self.runner.attempts), 2)
        self.tracker.review({"run": request["request_id"], "proposal": "audit", "action": "accept"})
        self.tracker = self.restore()
        self.assertEqual(self.work_item()["audit"]["status"], "accepted")

    def test_changed_handoff_invalidates_preview_and_acceptance(self):
        self.candidate()
        first = self.tracker.preview(self.draft)
        run = self.launch(first)["request_id"]
        self.candidate(checks="Different results")
        self.assertEqual(self.work_item()["audit"]["status"], "ready")
        with self.assertRaisesRegex(ValueError, "changed after launch"):
            self.tracker.review({"run": run, "proposal": "audit", "action": "accept"})
        with self.assertRaisesRegex(ValueError, "Preview the kickoff again"):
            self.tracker.launch({**self.draft, "digest": first["digest"], "request_id": uuid4().hex})

    def test_brief_includes_selected_decision_and_stales_when_superseded(self):
        for choice in ("Preserve JSON keys", "Choose the website heading"):
            self.tracker.change("/api/decision", {"id": self.project, "choice": choice,
                                                 "rationale": "Recorded during the planning session. " * 10,
                                                 "source": "Project decision log"})
        selected = self.snapshot()["decisions"][0]["id"]
        self.candidate(decisions=[selected])
        scoped = self.tracker.preview(self.draft)["brief"]
        kickoff = self.tracker.preview({"project": self.project, "pattern": "producer-auditor",
                                        "task": "Audit the implementation", "criteria": "Preserve old inputs"})["brief"]
        self.assertLess(len(scoped.encode()), len(kickoff.encode()))
        self.assertIn("Preserve JSON keys", scoped)
        self.assertNotIn("Choose the website heading", scoped)
        self.tracker.change("/api/decision", {"id": self.project, "choice": "Rename JSON keys",
                                             "rationale": "New schema", "source": "Project decision log", "supersedes": selected})
        self.assertEqual(self.work_item()["audit"]["status"], "needs update")

    def test_candidate_and_usage_validation(self):
        with self.assertRaisesRegex(ValueError, "full Git commit"):
            self.candidate(commit=self.commit[:8])
        with self.assertRaisesRegex(ValueError, "linked producer session"):
            self.candidate(workspace=str(self.root))
        with self.assertRaisesRegex(RunError, "Could not export the exact candidate commit"):
            self.runner.run({"provider": "claude", "workspace": str(self.workspace), "audit": {"commit": "0" * 40}})
        self.assertEqual(self.runner.attempts, [])
        self.assertEqual(reported_usage("codex", b'{"type":"turn.completed","usage":'
                                        b'{"input_tokens":100,"cached_input_tokens":10,"output_tokens":20}}'),
                         {"input_tokens": 100, "output_tokens": 20})
        self.assertIsNone(reported_usage("claude", b'{"type":"result","usage":{"input_tokens":true}}'))
