import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from threadline.history import session
from threadline.project_draft import prepare_draft, validate_draft
from threadline.runner import RunError, Runner
from threadline.server import STATUSES, Tracker

DRAFT = {"name": "Threadline", "area": "Developer tooling", "status": "Prototype",
         "summary": "The repository implements a local project register.",
         "next": "Review session matching.", "evidence": "codex:original"}


class DraftRunner:
    def __init__(self):
        self.stop = threading.Event()
        self.calls = []

    def options(self):
        return {"providers": ["codex"], "workspaces": []}

    def draft(self, provider, prompt, schema):
        self.calls.append((provider, prompt, schema))
        return dict(DRAFT)


class ProjectDraftTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        (self.root / ".git").mkdir()
        (self.root / "README.md").write_text("A local project register. " + "x" * 20000)
        self.runner = DraftRunner()
        self.tracker = Tracker(self.root / "state.json", self.root / "codex", self.root / "claude", runner=self.runner)
        row = session("codex", "original", "Build project tracker UI", str(self.root), 1)
        row["workspace"] = str(self.root)
        self.tracker.rows = [row]
        self.tracker.scanned = 1
        self.request = {"provider": "codex", "sessions": [row["key"]], "fields": {"name": "Threadline"}}

    def test_drafts_validated_fields_without_saving_or_linking(self):
        self.assertEqual(self.tracker.draft_project(self.request), DRAFT)
        state = self.tracker.snapshot()
        self.assertEqual(state["projects"], [])
        self.assertIsNone(state["sessions"][0]["project"])
        self.assertFalse(self.tracker.path.exists())
        self.assertFalse(state["drafting"])
        evidence = json.loads(self.runner.calls[0][1].split("\n", 1)[1])
        self.assertEqual(len(evidence["repository"]["readme"]), 12000)
        self.assertEqual(evidence["sessions"][0]["key"], "codex:original")

    def test_accepts_notes_without_a_repository_or_session(self):
        request = {"provider": "codex", "sessions": [], "fields": {"name": "New effort", "summary": "Planning only."}}
        provider, prompt, schema = prepare_draft(request, self.tracker.snapshot())
        self.assertEqual(provider, "codex")
        evidence = json.loads(prompt.split("\n", 1)[1])
        self.assertIsNone(evidence["repository"])
        self.assertIn("not deployed", prompt)
        self.assertFalse(schema["additionalProperties"])

    def test_input_boundaries_reject_unknown_provider_or_sessions(self):
        invalid = [{**self.request, "provider": "api"}, {**self.request, "sessions": ["unknown"]},
                   {**self.request, "sessions": ["codex:original"] * 2},
                   {**self.request, "fields": {"name": "x" * 101}},
                   {**self.request, "sessions": [], "fields": {}},
                   {**self.request, "suggestion": "missing"}]
        for request in invalid:
            with self.assertRaises(ValueError):
                self.tracker.draft_project(request)
        self.assertEqual(self.runner.calls, [])
        self.assertFalse(self.tracker.draft_lock.locked())

    def test_cannot_read_a_client_supplied_repository(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "README.md").write_text("SHOULD_NOT_BE_READ")
        request = {"provider": "codex", "sessions": [], "workspace": str(outside),
                   "fields": {"name": "New project"}}
        _, prompt, _ = prepare_draft(request, self.tracker.snapshot())
        self.assertNotIn("SHOULD_NOT_BE_READ", prompt)

    def test_readme_symlink_cannot_escape_selected_repository(self):
        other = self.root.parent / (self.root.name + "-outside.md")
        other.write_text("OUTSIDE_PRIVATE_CONTEXT")
        self.addCleanup(other.unlink)
        (self.root / "README.md").unlink()
        (self.root / "README.md").symlink_to(other)
        _, prompt, _ = prepare_draft(self.request, self.tracker.snapshot())
        self.assertNotIn("OUTSIDE_PRIVATE_CONTEXT", prompt)

    def test_model_output_is_not_trusted(self):
        for result in ({}, {**DRAFT, "status": "Live"}, {**DRAFT, "summary": "x" * 2401},
                       {**DRAFT, "name": " "}, {**DRAFT, "extra": "unrequested"}, {**DRAFT, "area": []}):
            with self.assertRaises(RunError):
                validate_draft(result, STATUSES)

    def test_generation_does_not_block_dashboard_and_only_one_draft_runs(self):
        started, release = threading.Event(), threading.Event()
        def delayed(*_args):
            started.set()
            release.wait(3)
            return DRAFT
        with patch.object(self.runner, "draft", side_effect=delayed):
            worker = threading.Thread(target=self.tracker.draft_project, args=(self.request,))
            worker.start()
            try:
                self.assertTrue(started.wait(2))
                self.assertTrue(self.tracker.lock.acquire(timeout=0.2))
                self.tracker.lock.release()
                self.assertTrue(self.tracker.snapshot()["drafting"])
                with self.assertRaisesRegex(RunError, "already"):
                    self.tracker.draft_project(self.request)
            finally:
                release.set()
                worker.join(3)
        self.assertFalse(self.tracker.draft_lock.locked())

    def test_provider_failure_leaves_form_data_and_store_unchanged(self):
        with patch.object(self.runner, "draft", side_effect=RunError("Provider unavailable")):
            with self.assertRaisesRegex(RunError, "unavailable"):
                self.tracker.draft_project(self.request)
        self.assertFalse(self.tracker.path.exists())
        self.assertFalse(self.tracker.draft_lock.locked())

    def test_subscription_drafts_do_not_inherit_metered_api_keys(self):
        runner = Runner()
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-test-value", "ANTHROPIC_API_KEY": "synthetic-test-value"}):
            output = runner.capture([sys.executable, "-c",
                "import os;print(any(key in os.environ for key in ('OPENAI_API_KEY','ANTHROPIC_API_KEY')))"],
                self.root, "", self.root, subscription_only=True, timeout=5)
        self.assertEqual(output.strip(), b"False")
