import json
import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from threadline.history import load_history
from threadline.server import Handler, Tracker

CODEX_ID = "11111111-1111-4111-8111-111111111111"
CLAUDE_ID = "22222222-2222-4222-8222-222222222222"
CHILD_ID = "33333333-3333-4333-8333-333333333333"


class ThreadlineTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.codex = self.root / "codex"
        self.claude = self.root / "claude"
        self.checkout = self.root / "example"
        self.state = self.root / "state.json"
        self.codex.mkdir()
        self.claude.mkdir()
        self.checkout.mkdir()
        (self.checkout / ".git").mkdir()

    def write_logs(self):
        (self.claude / "history.jsonl").write_text(json.dumps({
            "display": "Draft a review schema", "project": str(self.checkout),
            "timestamp": 1794000000000, "sessionId": CLAUDE_ID,
        }) + "\n" + '{"partial"', encoding="utf-8")
        with sqlite3.connect(self.codex / "state_5.sqlite") as db:
            db.execute("CREATE TABLE threads (id, title, cwd, updated_at, archived, source)")
            db.executemany("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)", [
                (CODEX_ID, "Compare reviewer output", str(self.checkout), 1794000200, 1, "vscode"),
                (CHILD_ID, "Subagent replay", str(self.checkout), 1794000000, 1, '{"subagent":{}}'),
            ])
        (self.codex / "session_index.jsonl").write_text(json.dumps({
            "id": CODEX_ID, "thread_name": "Review replay report", "updated_at": "2026-11-06T23:50:00.123456789Z",
        }), encoding="utf-8")

    def tracker(self):
        return Tracker(self.state, self.codex, self.claude)

    def test_read_metadata_and_group_workspace(self):
        self.write_logs()
        sessions, sources = load_history(self.codex, self.claude, {})
        self.assertEqual({row["id"] for row in sessions}, {CODEX_ID, CLAUDE_ID})
        self.assertEqual({row["workspace"] for row in sessions}, {str(self.checkout)})
        self.assertEqual(sources["codex"]["count"], 1)
        row = next(row for row in sessions if row["source"] == "codex")
        self.assertEqual(row["title"], "Review replay report")
        self.assertTrue(row["archived"])
        suggested = self.tracker().snapshot()["suggestions"]
        self.assertEqual(suggested[0]["sources"], ["claude", "codex"])
        self.assertEqual(len(suggested[0]["sessions"]), 2)

    def test_link_and_unlink_survive_restart(self):
        self.write_logs()
        tracker = self.tracker()
        workspace = tracker.snapshot()["suggestions"][0]
        result = tracker.change("/api/project", dict(name="Example", status="Prototype",
                                                    workspace=workspace["workspace"], sessions=workspace["sessions"]))
        project_id = result["savedProject"]
        tracker.change("/api/link", {"id": None, "session": f"codex:{CODEX_ID}"})
        restored = self.tracker().snapshot()
        self.assertEqual(restored["projects"][0]["id"], project_id)
        self.assertEqual(restored["projects"][0]["sessions"], [f"claude:{CLAUDE_ID}"])

    def test_revisit_uses_project_activity_and_status(self):
        tracker = self.tracker()
        tracker.snapshot()
        for status in ("In progress", "Parked", "Completed"):
            tracker.change("/api/project", {"name": status, "status": status})
        old = (date.today() - timedelta(days=20)).isoformat()
        for project in tracker.projects:
            project["checkpoint"] = old
        revisit = [p["status"] for p in tracker.snapshot()["projects"] if p["revisit"]]
        self.assertEqual(revisit, ["In progress"])

    def test_demo_uses_synthetic_history(self):
        tracker = Tracker(self.state, self.codex, self.claude, demo=True)
        with patch("threadline.server.load_history", side_effect=AssertionError("read real history")):
            result = tracker.snapshot()
        self.assertEqual(len(result["projects"]), 6)
        self.assertEqual(len(result["sessions"]), 19)
        self.assertTrue(result["demo"])
        self.assertFalse(self.state.exists())

    def test_invalid_project_does_not_write_state(self):
        tracker = self.tracker()
        tracker.snapshot()
        with self.assertRaises(ValueError):
            tracker.change("/api/project", {"name": "Example", "status": "Prototype", "sessions": ["missing"]})
        self.assertFalse(self.state.exists())

    def test_direct_access_requires_peer_host_and_origin(self):
        handler = Handler.__new__(Handler)
        handler.server = SimpleNamespace(server_address=("100.64.0.10", 8765),
                                         allowed_clients={"100.64.0.20"})
        handler.client_address = ("100.64.0.20", 49152)
        handler.headers = {"Host": "100.64.0.10:8765", "Origin": "http://100.64.0.10:8765"}
        self.assertTrue(handler.allowed_request())
        with patch.object(handler, "client_address", ("100.64.0.30", 49152)):
            self.assertFalse(handler.allowed_request())
        with patch.dict(handler.headers, {"Host": "unrelated.example:8765"}):
            self.assertFalse(handler.allowed_request())
        with patch.dict(handler.headers, {"Origin": "https://unrelated.example"}):
            self.assertFalse(handler.allowed_request())


if __name__ == "__main__":
    unittest.main()
