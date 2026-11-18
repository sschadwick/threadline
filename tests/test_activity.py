import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from threadline.activity import claude_activity, read_activity
from threadline.history import session


IDLE = "11111111-1111-4111-8111-111111111111"
BLOCKED = "22222222-2222-4222-8222-222222222222"
SAVED = "33333333-3333-4333-8333-333333333333"


class ActivityTest(unittest.TestCase):
    def test_claude_waiting_state_takes_precedence_over_idle(self):
        active = [{"sessionId": IDLE, "status": "idle"},
                  {"sessionId": BLOCKED, "status": "idle", "state": "blocked"},
                  {"sessionId": SAVED, "state": "done"}]
        with patch("threadline.activity.subprocess.run", return_value=SimpleNamespace(stdout=json.dumps(active))):
            self.assertEqual(claude_activity(Path("/history")), {IDLE: "idle", BLOCKED: "needs_input", SAVED: "saved"})

    def test_unavailable_runtime_preserves_archived_history(self):
        rows = [session("claude", IDLE), session("claude", SAVED), session("codex", BLOCKED, archived=True)]
        sources = {"claude": {}, "codex": {}}
        with patch("threadline.activity.claude_activity", return_value={IDLE: "idle"}):
            read_activity(rows, sources, Path("/history"), None)
        self.assertEqual([row["activity"] for row in rows], ["idle", "saved", "unknown"])
        self.assertTrue(rows[2]["archived"])
