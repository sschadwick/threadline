import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
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
        with closing(sqlite3.connect(self.codex / "state_5.sqlite")) as db, db:
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

    def test_production_and_revisit_labels_are_independent(self):
        tracker = self.tracker()
        tracker.snapshot()
        fields = {"name": "Example", "status": "Parked"}
        created = tracker.change("/api/project", fields)["projects"][0]
        self.assertFalse(created["in_production"])
        fields["id"] = created["id"]
        later = tracker.change("/api/project", {**fields, "in_production": True, "revisit_later": True})
        self.assertEqual(later["projects"][0]["revisit_state"], "later")
        tracker.change("/api/project", {**fields, "revisit_on": date.today().isoformat()})
        project = self.tracker().snapshot()["projects"][0]
        self.assertEqual(project["status"], "Parked")
        self.assertTrue(project["in_production"])
        self.assertEqual(project["revisit_state"], "due")
        self.assertEqual(project["checkpoint"], created["checkpoint"])

    def test_decision_replay_uses_frozen_revisions_and_evidence(self):
        self.write_logs()
        tracker = self.tracker()
        workspace = tracker.snapshot()["suggestions"][0]
        project_id = tracker.change("/api/project", {
            "name": "Example", "status": "Prototype", "sessions": workspace["sessions"],
        })["savedProject"]

        def decide(**fields):
            result = tracker.change("/api/decision", {"id": project_id, **fields})
            return result["projects"][0]["decisions"][-1]

        older = decide(choice="Make Docker the default", rationale="Uniform runtime", source="Initial plan")
        current = decide(choice="Keep native install as default", rationale="Simpler first run",
                         source="Packaging decision", source_session=f"claude:{CLAUDE_ID}", supersedes=older["id"])
        with self.assertRaises(ValueError):
            decide(choice="Stale edit", rationale="Conflicting update", source="Other", supersedes=older["id"])

        frozen = tracker.change("/api/eval", {
            "id": project_id, "decision": current["id"], "name": "Packaging", "task": "Update setup commands",
        })["projects"][0]["evals"][0]
        latest = decide(choice="Bundle a native installer", rationale="Support unattended setup",
                        source="Packaging follow-up", supersedes=current["id"])
        project = tracker.change("/api/replay", {"id": project_id, "case": frozen["id"]})["projects"][0]
        self.assertIn(latest["choice"], project["kickoff"])
        self.assertNotIn(current["choice"], project["kickoff"])
        restored = self.tracker().snapshot()["projects"][0]
        self.assertEqual(len(restored["decisions"]), 3)
        result = restored["evals"][0]["last_result"]
        self.assertTrue(result["passed"])
        self.assertEqual(result["actual"], [current["id"]])
        self.assertIn(current["source"], result["brief"])
        self.assertIn(f"claude:{CLAUDE_ID}", result["brief"])
        self.assertNotIn(older["choice"], result["brief"])
        self.assertIn("Update setup commands", result["brief"])

        with patch("threadline.kickoff.render_kickoff", return_value=f"- Decision {older['id']}: {older['choice']}"):
            replayed = tracker.change("/api/replay", {"id": project_id, "case": frozen["id"]})
        failed = replayed["projects"][0]["evals"][0]["last_result"]
        self.assertFalse(failed["passed"])
        self.assertTrue(all(not assertion["passed"] for assertion in failed["assertions"]))

        changed_source = result["brief"].replace(current["source"], current["source"] + " (unverified)")
        with patch("threadline.kickoff.render_kickoff", return_value=changed_source):
            replayed = tracker.change("/api/replay", {"id": project_id, "case": frozen["id"]})
        failed = replayed["projects"][0]["evals"][0]["last_result"]
        self.assertFalse(failed["passed"])
        self.assertEqual([item["passed"] for item in failed["assertions"]], [True, False, True])

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
