import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from threadline.history import session
from threadline.server import Tracker


class DiscoveryTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = self.root / "state.json"
        self.original = self.root / "2026-11-17" / "build-some-ui"
        self.checkout = self.original / "outputs" / "threadline-release"
        (self.checkout / ".git").mkdir(parents=True)
        (self.checkout / ".git" / "config").write_text(
            '[remote "origin"]\nurl = https://user:secret@example.invalid/team/threadline.git\n')
        self.followup = self.root / "2026-11-18" / "another-directory"
        self.followup.mkdir(parents=True)
        (self.followup / ".git").mkdir()
        self.rows = [session("codex", "original", "Build AI project tracker UI", str(self.original), 1),
                     session("claude", "followup", "Improve Threadline discovery", str(self.followup), 2)]
        for row in self.rows:
            row["workspace"] = str(self.root)

    def tracker(self):
        tracker = Tracker(self.state, self.root / "codex", self.root / "claude")
        tracker.rows = [row.copy() for row in self.rows]
        tracker.scanned = 1
        return tracker

    def test_discovers_checkout_across_chats_without_tracking(self):
        snapshot = self.tracker().snapshot()
        self.assertEqual(snapshot["projects"], [])
        self.assertFalse(self.state.exists())
        self.assertEqual(len(snapshot["suggestions"]), 1)
        suggestion = snapshot["suggestions"][0]
        self.assertEqual(suggestion["name"], "threadline")
        self.assertEqual(set(suggestion["sessions"]), {"codex:original", "claude:followup"})
        self.assertEqual(suggestion["workspace"], str(self.checkout))
        self.assertNotIn("secret", json.dumps(snapshot))
        self.assertTrue(all(row["project"] is None for row in snapshot["sessions"]))

    def test_dismissal_and_restore_survive_restart_and_other_saves(self):
        tracker = self.tracker()
        identity = tracker.snapshot()["suggestions"][0]["id"]
        tracker.change("/api/suggestion", {"suggestion": identity, "dismissed": True})
        tracker.change("/api/project", {"name": "Other", "status": "Planned"})
        tracker = self.tracker()
        self.assertTrue(tracker.snapshot()["suggestions"][0]["dismissed"])
        tracker.change("/api/suggestion", {"suggestion": identity, "dismissed": False})
        self.assertFalse(self.tracker().snapshot()["suggestions"][0]["dismissed"])

    def test_tracking_requires_confirmation_and_preserves_session_selection(self):
        tracker = self.tracker()
        identity = tracker.snapshot()["suggestions"][0]["id"]
        result = tracker.change("/api/project", {"name": "Project tracker", "status": "In progress",
            "suggestion": identity, "sessions": ["codex:original"]})
        self.assertEqual(result["suggestions"], [])
        restored = self.tracker().snapshot()
        self.assertEqual(restored["projects"][0]["name"], "Project tracker")
        self.assertEqual(restored["projects"][0]["sessions"], ["codex:original"])
        self.assertIsNone(next(row for row in restored["sessions"] if row["key"] == "claude:followup")["project"])
        saved = json.loads(self.state.read_text())
        self.assertEqual(saved["projects"][0]["roots"], [str(self.checkout)])
        self.assertIn("threadline", saved["projects"][0]["aliases"])
        with self.assertRaisesRegex(ValueError, "no longer exists"):
            tracker.change("/api/project", {"name": "Duplicate", "status": "Planned",
                "suggestion": identity, "sessions": ["codex:original"]})
        self.assertEqual(len(self.tracker().projects), 1)

    def test_rejects_stale_dismissed_or_unrelated_selections(self):
        other = self.root / "other"
        other.mkdir()
        self.rows.append(session("codex", "other", "Unrelated deployment", str(other), 3))
        tracker = self.tracker()
        identity = tracker.snapshot()["suggestions"][0]["id"]
        for sessions in ([], ["missing"], ["codex:other"], ["codex:original", "codex:original"]):
            with self.assertRaises(ValueError):
                tracker.change("/api/project", {"name": "Test", "status": "Planned",
                    "suggestion": identity, "sessions": sessions})
        self.assertFalse(self.state.exists())
        for body in ({"suggestion": identity, "dismissed": "yes"}, {"suggestion": [], "dismissed": True}):
            with self.assertRaises(ValueError):
                tracker.change("/api/suggestion", body)
        tracker.change("/api/suggestion", {"suggestion": identity, "dismissed": True})
        with self.assertRaisesRegex(ValueError, "no longer exists"):
            tracker.change("/api/project", {"name": "Test", "status": "Planned",
                "suggestion": identity, "sessions": ["codex:original"]})

    def test_failed_save_keeps_review_state_unchanged(self):
        tracker = self.tracker()
        identity = tracker.snapshot()["suggestions"][0]["id"]
        with patch("threadline.server.os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                tracker.change("/api/suggestion", {"suggestion": identity, "dismissed": True})
        self.assertEqual(tracker.dismissed_suggestions, [])
        self.assertFalse(self.state.exists())

    def test_unavailable_temporary_runs_are_not_related_by_title(self):
        self.rows.append(session("codex", "smoke", "Threadline synthetic smoke test",
                                 str(self.root / "deleted-run"), 3))
        suggestion = self.tracker().snapshot()["suggestions"][0]
        self.assertNotIn("codex:smoke", suggestion["sessions"])

    def test_archived_projects_are_not_suggested_again(self):
        tracker = self.tracker()
        suggestion = tracker.snapshot()["suggestions"][0]
        result = tracker.change("/api/project", {"name": "Threadline", "status": "Prototype",
            "suggestion": suggestion["id"], "sessions": suggestion["sessions"]})
        tracker.change("/api/project-state", {"id": result["savedProject"], "archived": True})
        self.assertEqual(self.tracker().snapshot()["suggestions"], [])
