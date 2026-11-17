import json
import tempfile
import unittest
from pathlib import Path
from threading import Event
from uuid import uuid4

from threadline.runner import RunError, parse_result
from threadline.server import Tracker


SESSION = "22222222-2222-4222-8222-222222222222"
RESULT = {
    "summary": "Reviewed the packaging requirements.",
    "checkpoint": {"summary": "Verified native startup.", "next": "Test optional Docker.", "source": "Smoke report"},
    "decision": {"choice": "Keep Docker optional", "rationale": "Python startup is sufficient.", "source": "Smoke report"},
}


class FakeRunner:
    def __init__(self, workspace):
        self.workspace = workspace
        self.stop = Event()
        self.release = Event()
        self.calls = []

    def options(self):
        return {"providers": ["codex"], "workspaces": [str(self.workspace)]}

    def run(self, run):
        self.calls.append(run)
        if not self.release.wait(3):
            raise RunError("Test worker timed out.")
        return SESSION, RESULT


class RunnerTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.store = self.root / "state.json"
        self.runner = FakeRunner(self.root)
        self.tracker = self.make_tracker()
        self.addCleanup(self.stop_worker)
        changed = self.tracker.change("/api/project", {"name": "Packaging", "status": "Prototype", "summary": "Initial checkpoint"})
        self.id = changed["savedProject"]
        self.draft = {
            "project": self.id, "pattern": "molt-sinai", "provider": "codex", "workspace": str(self.root),
            "task": "Review packaging setup.", "criteria": "Cite a reproducible result.",
        }

    def make_tracker(self):
        return Tracker(self.store, self.root / "codex", self.root / "claude", runner=self.runner)

    def stop_worker(self):
        self.runner.release.set()
        if self.tracker.worker:
            self.tracker.worker.join(5)

    def request(self):
        preview = self.tracker.preview(self.draft)
        return {**self.draft, "digest": preview["digest"], "request_id": uuid4().hex}

    def test_preview_freezes_decisions_and_requires_reviewed_inputs(self):
        self.tracker.change("/api/decision", {
            "id": self.id, "choice": "Native install remains default", "rationale": "Compatible runtime", "source": "ADR-42",
        })
        preview = self.tracker.preview(self.draft)
        self.assertEqual(preview, self.tracker.preview(self.draft))
        for text in ("MOLT Sinai", "Initial checkpoint", "ADR-42", self.draft["criteria"], self.draft["task"]):
            self.assertIn(text, preview["brief"])
        with self.assertRaises(ValueError):
            self.tracker.preview({**self.draft, "workspace": str(self.root / "unchecked")})
        request = self.request()
        self.tracker.change("/api/project", {"id": self.id, "name": "Packaging", "status": "Completed"})
        with self.assertRaisesRegex(ValueError, "Preview"):
            self.tracker.launch(request)

    def test_launch_is_idempotent_and_outbox_acceptance_survives_restart(self):
        request = self.request()
        first = self.tracker.launch(request)["outbox"][0]
        self.assertEqual(first["status"], "running")
        self.assertEqual(self.tracker.launch(request)["outbox"][0]["id"], first["id"])
        with self.assertRaisesRegex(ValueError, "already running"):
            self.tracker.launch(self.request())
        self.stop_worker()
        self.assertEqual(len(self.runner.calls), 1)
        restarted = self.make_tracker()
        snapshot = restarted.launch(request)
        self.assertEqual(len(self.runner.calls), 1)
        self.assertEqual(snapshot["outbox"][0]["session_id"], SESSION)
        self.assertEqual(snapshot["projects"][0]["summary"], "Initial checkpoint")
        self.assertFalse(snapshot["projects"][0]["decisions"])

        review = {"run": first["id"], "action": "accept"}
        project = restarted.review({**review, "proposal": "decision"})["projects"][0]
        self.assertEqual(project["decisions"][0]["choice"], RESULT["decision"]["choice"])
        self.assertIn(SESSION, project["decisions"][0]["source"])
        restarted.review({**review, "proposal": "decision"})
        restarted.review({**review, "proposal": "checkpoint"})
        state = self.make_tracker().snapshot()
        self.assertEqual(len(state["projects"][0]["decisions"]), 1)
        self.assertEqual(state["projects"][0]["summary"], RESULT["checkpoint"]["summary"])
        self.assertEqual(state["outbox"][0]["review"], {"checkpoint": "accepted", "decision": "accepted"})

    def test_stale_checkpoint_cannot_be_accepted_and_can_be_dismissed(self):
        request = self.request()
        self.tracker.launch(request)
        self.stop_worker()
        self.tracker.change("/api/project", {"id": self.id, "name": "Packaging", "status": "Completed"})
        review = {"run": request["request_id"], "proposal": "checkpoint"}
        with self.assertRaisesRegex(ValueError, "changed"):
            self.tracker.review({**review, "action": "accept"})
        self.tracker.review({**review, "action": "dismiss"})
        state = self.make_tracker().snapshot()
        self.assertEqual(state["projects"][0]["status"], "Completed")
        self.assertEqual(state["outbox"][0]["review"]["checkpoint"], "dismissed")

    def test_provider_results_are_validated(self):
        codex = "\n".join(map(json.dumps, [
            {"type": "thread.started", "thread_id": SESSION},
            {"type": "item.completed", "item": {"type": "agent_message", "text": json.dumps(RESULT)}},
            {"type": "turn.completed"},
        ])).encode()
        claude = json.dumps({"type": "result", "session_id": SESSION, "structured_output": RESULT}).encode()
        self.assertEqual(parse_result("codex", codex), (SESSION, RESULT))
        self.assertEqual(parse_result("claude", claude), (SESSION, RESULT))
        with self.assertRaises(ValueError):
            parse_result("claude", claude.replace(SESSION.encode(), b"-not-a-session"))

    def test_recovery_does_not_repeat_an_interrupted_launch(self):
        request = self.request()
        self.tracker.launch(request)
        saved_while_running = self.store.read_bytes()
        self.stop_worker()
        self.store.write_bytes(saved_while_running)
        restarted = self.make_tracker()
        run = restarted.launch(request)["outbox"][0]
        self.assertEqual(run["status"], "interrupted")
        self.assertEqual(len(self.runner.calls), 1)
