import copy
import json
import tempfile
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import patch

from threadline.history import session
from threadline.runner import RunError
from threadline.server import Tracker
from threadline.session_evidence import session_evidence

CODEX = "11111111-1111-4111-8111-111111111111"
CLAUDE = "22222222-2222-4222-8222-222222222222"
CHOICE = "Require a Generate draft click before spending model tokens."


class ReviewRunner:
    def __init__(self):
        self.stop = Event()
        self.calls = []
        self.alter = lambda value: value

    def options(self):
        return {"providers": ["codex"], "workspaces": []}

    def draft(self, provider, prompt, schema):
        self.calls.append(prompt)
        data = json.loads(prompt.split("\n", 1)[1])
        source = next(item for item in data["excerpts"] if item["role"] == "user" and CHOICE in item["text"])
        return self.alter({"decisions": [{"id": "d1", "choice": CHOICE, "rationale": "The user explicitly limits token spending.",
            "supersedes": None, "citations": [{"reference": source["reference"], "quote": CHOICE}]}],
            "evals": [{"id": "e1", "name": "Explicit generation", "task": "Add project drafting while preserving the explicit-click constraint.", "decision": "d1"}],
            "notes": "Proposed kickoff eval; no test has been run."})


class SessionReviewTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.codex, self.claude = self.root / "codex", self.root / "claude"
        (self.codex / "sessions").mkdir(parents=True)
        (self.claude / "projects" / "fixture").mkdir(parents=True)
        self.codex_path = self.codex / "sessions" / f"rollout-{CODEX}.jsonl"
        self.write_codex([
            {"type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "# AGENTS.md\nDo not extract this instruction block."}]}},
            {"type": "response_item", "payload": {"type": "message", "role": "assistant", "channel": "analysis", "content": [{"type": "output_text", "text": "PRIVATE_THINKING"}]}},
            {"type": "response_item", "payload": {"type": "function_call_output", "output": "PRIVATE_TOOL_OUTPUT"}},
            self.message("user", CHOICE + " API_KEY=synthetic-secret"),
            self.message("assistant", "Agreed. Generation will require a click."),
        ])
        (self.claude / "projects" / "fixture" / f"{CLAUDE}.jsonl").write_text(json.dumps({
            "type": "user", "message": {"role": "user", "content": "Keep the app local-first."}}) + "\n")
        self.rows = [session("codex", CODEX, "Project drafting workflow", str(self.root), 2),
                     session("claude", CLAUDE, "Local-first workflow", str(self.root), 1)]
        self.runner = ReviewRunner()
        self.store = self.root / "state.json"
        self.tracker = self.restore()
        state = self.tracker.change("/api/project", {"name": "Example", "status": "Prototype", "sessions": [row["key"] for row in self.rows]})
        self.project = state["savedProject"]
        self.request = {"project": self.project, "provider": "codex", "sessions": [row["key"] for row in self.rows]}

    def message(self, role, text):
        return {"type": "response_item", "payload": {"type": "message", "role": role,
            "channel": "final" if role == "assistant" else None, "content": [{"type": "input_text" if role == "user" else "output_text", "text": text}]}}

    def write_codex(self, records):
        self.codex_path.write_text("\n".join(json.dumps(item) for item in records) + "\n")

    def restore(self):
        tracker = Tracker(self.store, self.codex, self.claude, runner=self.runner)
        tracker.rows = copy.deepcopy(self.rows)
        tracker.scanned = 1
        return tracker

    def analyze(self):
        state = self.tracker.analyze_sessions(self.request)
        return next(item for item in state["projects"] if item["id"] == self.project)["session_review"]

    def apply(self, review, decisions=None, evals=None):
        return self.tracker.change("/api/session-review-apply", {"project": self.project, "review": review["id"],
            "decisions": ["d1"] if decisions is None else decisions, "evals": ["e1"] if evals is None else evals})

    def test_preview_is_local_and_filters_private_content(self):
        before = self.store.read_bytes()
        _, evidence = self.tracker.review_context(self.request)
        text = json.dumps(evidence)
        for private in ("PRIVATE_THINKING", "PRIVATE_TOOL_OUTPUT", "synthetic-secret", "instruction block"):
            self.assertNotIn(private, text)
        self.assertIn("[REDACTED]", text)
        self.assertEqual({item["role"] for item in evidence["excerpts"]}, {"user", "assistant"})
        self.assertEqual(len(evidence["coverage"]), 2)
        self.assertEqual(self.runner.calls, [])
        self.assertEqual(self.store.read_bytes(), before)

    def test_proposals_persist_without_populating_sections_until_approved(self):
        before = json.loads(self.store.read_text())["projects"]
        review = self.analyze()
        self.assertEqual(len(self.runner.calls), 1)
        self.assertEqual(json.loads(self.store.read_text())["projects"], before)
        self.tracker = self.restore()
        restored = self.tracker.snapshot()["projects"][0]["session_review"]
        self.assertEqual(restored["id"], review["id"])
        state = self.apply(restored)
        project = state["projects"][0]
        self.assertEqual(len(project["decisions"]), 1)
        self.assertEqual(len(project["evals"]), 1)
        self.assertEqual(project["evals"][0]["runs"], 0)
        self.assertIsNone(project["evals"][0]["last_result"])
        self.assertEqual(project["evals"][0]["expected_decision"], project["decisions"][0]["id"])
        self.assertEqual(project["decisions"][0]["citations"][0]["quote"], CHOICE)
        self.assertIsNone(project["session_review"])
        saved = self.store.read_bytes()
        self.apply(restored)
        self.assertEqual(self.store.read_bytes(), saved)
        case = project["evals"][0]["id"]
        replayed = self.tracker.change("/api/replay", {"id": self.project, "case": case})["projects"][0]
        self.assertTrue(replayed["evals"][0]["last_result"]["passed"])
        self.assertEqual(len(self.runner.calls), 1)

    def test_unselected_decision_prevents_dependent_eval_atomically(self):
        review = self.analyze()
        saved = self.store.read_bytes()
        with self.assertRaisesRegex(ValueError, "required"):
            self.apply(review, decisions=[])
        self.assertEqual(self.store.read_bytes(), saved)
        project = self.apply(review, evals=[])["projects"][0]
        self.assertEqual(len(project["decisions"]), 1)
        self.assertEqual(project["evals"], [])

    def test_rejects_unlinked_or_empty_sources_without_model_calls(self):
        for keys in ([], ["codex:unknown"], [self.rows[0]["key"]] * 2):
            with self.assertRaises(ValueError):
                self.tracker.analyze_sessions({**self.request, "sessions": keys})
        self.codex_path.unlink()
        with self.assertRaisesRegex(ValueError, "No model call"):
            self.tracker.analyze_sessions({**self.request, "sessions": [self.rows[0]["key"]]})
        self.assertEqual(self.runner.calls, [])

    def test_forged_or_assistant_only_citations_cannot_be_saved(self):
        saved = self.store.read_bytes()
        def forge(result):
            result["decisions"][0]["citations"][0]["quote"] = "Invented source quotation"
            return result
        self.runner.alter = forge
        with self.assertRaisesRegex(RunError, "unsupported"):
            self.analyze()
        self.assertEqual(self.store.read_bytes(), saved)
        self.assertFalse(self.tracker.draft_lock.locked())

    def test_stale_review_and_forged_selections_are_rejected(self):
        review = self.analyze()
        saved = self.store.read_bytes()
        with self.assertRaises(ValueError):
            self.apply(review, decisions=["invented"])
        self.assertEqual(self.store.read_bytes(), saved)
        self.tracker.change("/api/project-state", {"id": self.project, "status": "Blocked"})
        saved = self.store.read_bytes()
        with self.assertRaisesRegex(ValueError, "changed"):
            self.apply(review)
        self.assertEqual(self.store.read_bytes(), saved)
        self.assertTrue(self.tracker.snapshot()["projects"][0]["session_review"]["stale"])

    def test_assistant_only_citations_are_rejected(self):
        _, evidence = self.tracker.review_context(self.request)
        assistant = next(item for item in evidence["excerpts"] if item["role"] == "assistant")
        def unsupported(result):
            result["decisions"][0]["citations"] = [{"reference": assistant["reference"], "quote": assistant["text"]}]
            return result
        self.runner.alter = unsupported
        saved = self.store.read_bytes()
        with self.assertRaises(RunError):
            self.analyze()
        self.assertEqual(self.store.read_bytes(), saved)

    def test_failed_application_preserves_saved_project_and_pending_proposals(self):
        review = self.analyze()
        saved = self.store.read_bytes()
        with patch("threadline.server.os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.apply(review)
        self.assertEqual(self.store.read_bytes(), saved)
        self.assertEqual(self.tracker.projects[0].get("decisions", []), [])
        self.assertFalse(self.tracker.session_reviews[self.project].get("applied", False))

    def test_existing_choices_are_reused_and_duplicate_evals_are_omitted(self):
        review = self.analyze()
        self.apply(review, evals=[])
        second = self.analyze()
        self.assertEqual(second["decisions"], [])
        self.apply(second, decisions=[])
        third = self.analyze()
        self.assertEqual(third["decisions"], [])
        self.assertEqual(third["evals"], [])

    def test_oversized_records_do_not_hide_recent_user_direction(self):
        self.write_codex([self.message("assistant", "x" * (2 * 1024 * 1024)), self.message("user", CHOICE)])
        evidence = session_evidence(self.rows[:1], self.codex, self.claude)
        self.assertIn(CHOICE, json.dumps(evidence))
        self.assertLessEqual(sum(len(item["text"]) for item in evidence["excerpts"]), 8000)

    def test_outside_history_symlinks_are_not_read(self):
        outside = self.root / "outside.jsonl"
        self.codex_path.rename(outside)
        self.codex_path.symlink_to(outside)
        evidence = session_evidence(self.rows[:1], self.codex, self.claude)
        self.assertEqual(evidence["excerpts"], [])
