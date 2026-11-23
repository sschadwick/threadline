import json
import tempfile
import unittest
from pathlib import Path

from threadline.history import session
from threadline.runner import RunError
from threadline.server import Tracker

CODEX = "11111111-1111-4111-8111-111111111111"
CLAUDE = "22222222-2222-4222-8222-222222222222"


class ProgressRunner:
    def __init__(self):
        self.calls = 0
        self.quote = "Opened PR #42."

    def options(self):
        return {"providers": ["codex"], "workspaces": []}

    def draft(self, provider, prompt, schema):
        self.calls += 1
        source = json.loads(prompt.split("\n", 1)[1])["excerpts"][0]
        return {"summary": "Session reports an open PR.", "next": "Review PR #42",
                "until": "PR #42 merges", "status": "in progress", "blocker": "",
                "citations": [{"reference": source["reference"], "quote": self.quote}]}


class RoadmapTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.codex, self.claude = self.root / "codex", self.root / "claude"
        folder = self.claude / "projects" / "example"
        folder.mkdir(parents=True)
        (folder / f"{CLAUDE}.jsonl").write_text(json.dumps({
            "type": "user", "message": {"role": "user", "content": "Opened PR #42."},
        }) + "\n")
        self.rows = [session("claude", CLAUDE, "Open PR", str(self.root), 1),
                     session("codex", CODEX, "Review PR", str(self.root), 2)]
        self.keys = [row["key"] for row in self.rows]
        self.runner = ProgressRunner()
        self.store = self.root / "state.json"
        self.restore()
        self.project = self.tracker.change("/api/project", {
            "name": "Example", "status": "In progress", "next": "Legacy action", "sessions": self.keys,
        })["projects"][0]["id"]

    def restore(self):
        self.tracker = Tracker(self.store, self.codex, self.claude, runner=self.runner)
        self.tracker.rows = [row.copy() for row in self.rows]
        self.tracker.scanned = 1

    def state(self):
        return self.tracker.snapshot()["projects"][0]

    def change(self, action, milestone=None, item=None, **fields):
        context = {}
        if milestone:
            context = {"milestone": milestone["id"], "item": item["id"] if item else None,
                       "revision": (item or milestone)["revision"]}
        return self.tracker.change("/api/roadmap", {
            "project": self.project, "action": action, **context, **fields,
        })["projects"][0]

    def create(self, title="Deploy"):
        return self.change("save", title=title, outcome="Ship the release",
                           criteria="The production smoke check passes", next="Verify deployment")["roadmap"][-1]

    def add_item(self, milestone, title, **fields):
        return self.change("add item", milestone, title=title, outcome="Prepare the candidate",
                           status="todo", **fields)["roadmap"][0]

    def draft(self, milestone, item):
        return self.tracker.analyze_progress({"project": self.project, "milestone": milestone["id"],
            "item": item["id"], "revision": item["revision"], "sessions": self.keys[:1], "provider": "codex",
        })["projects"][0]

    def test_cross_session_review_handoff_and_signoff(self):
        self.assertEqual(self.state()["next_action"]["title"], "Legacy action")
        milestone = self.create()
        self.create("Measure adoption")
        milestone = self.change("activate", milestone)["roadmap"][0]
        with self.assertRaisesRegex(ValueError, "active milestone"):
            self.change("activate", self.state()["roadmap"][1])
        milestone = self.add_item(milestone, "Prepare PR")
        item = milestone["items"][0]
        drafted = self.draft(milestone, item)
        self.assertEqual(drafted["next_action"]["kind"], "review")
        self.assertEqual(drafted["roadmap"][0]["items"][0]["updates"], [])
        self.restore()
        milestone = self.state()["roadmap"][0]
        item = milestone["items"][0]
        reviewed = self.change("accept", milestone, item, review=item["review"]["id"], summary="PR opened",
                               status="in progress", next="Review PR #42", until="PR #42 merges")
        self.assertEqual(reviewed["next_action"]["title"], "Review PR #42")
        self.assertIn("Next action: Review PR #42", reviewed["kickoff"])
        self.assertIn("Opened PR #42.", reviewed["kickoff"])
        self.assertIn("claude --resume", reviewed["kickoff"])
        self.assertEqual(self.runner.calls, 1)
        milestone = reviewed["roadmap"][0]
        item = milestone["items"][0]
        merged = self.change("progress", milestone, item, summary="PR merged", status="done", session=self.keys[1])
        self.assertEqual(merged["next_action"]["title"], "Verify deployment")
        self.assertEqual(merged["roadmap"][0]["items"][0]["sessions"], self.keys)
        milestone = merged["roadmap"][0]
        with self.assertRaisesRegex(ValueError, "evidence"):
            self.change("complete", milestone)
        verified = self.change("progress", milestone, summary="Smoke check passed", completion=True,
                               url="https://example.test/runs/1", artifact_revision="abcd", environment="production")
        self.assertEqual(verified["next_action"]["kind"], "signoff")
        self.assertIn("https://example.test/runs/1", verified["kickoff"])
        completed = self.change("complete", verified["roadmap"][0])
        self.assertEqual(completed["next_action"]["title"], "Activate Measure adoption")
        self.assertEqual(completed["roadmap_attention"], [])

    def test_forged_citation_and_stale_draft_leave_store_unchanged(self):
        milestone = self.add_item(self.create(), "Prepare PR")
        item = milestone["items"][0]
        before = self.store.read_bytes()
        self.runner.quote = "Fabricated"
        with self.assertRaises(RunError):
            self.draft(milestone, item)
        self.assertEqual(self.store.read_bytes(), before)
        self.runner.quote = "Opened PR #42."
        self.draft(milestone, item)
        updated = self.change("progress", milestone, item, summary="An update from another tab")
        current = updated["roadmap"][0]["items"][0]
        self.assertTrue(current["review"]["stale"])
        before = self.store.read_bytes()
        with self.assertRaisesRegex(ValueError, "fresh progress proposal"):
            self.change("accept", updated["roadmap"][0], current, review=current["review"]["id"], summary="PR opened")
        with self.assertRaisesRegex(ValueError, "record changed"):
            self.change("save", milestone, item, title="Overwrite a changed record")
        self.assertEqual(self.store.read_bytes(), before)

    def test_dependencies_and_blockers_are_scoped_to_the_milestone(self):
        milestone = self.change("activate", self.create())["roadmap"][0]
        milestone = self.add_item(milestone, "Prepare PR")
        first = milestone["items"][0]
        milestone = self.add_item(milestone, "Deploy release", depends_on=first["id"], next="Deploy")
        second = milestone["items"][1]
        with self.assertRaisesRegex(ValueError, "cycle"):
            self.change("save", milestone, first, title=first["title"], outcome=first["outcome"],
                        status="todo", depends_on=second["id"])
        with self.assertRaisesRegex(ValueError, "dependency"):
            self.change("progress", milestone, second, summary="Deploy attempted", status="done")
        attention = self.state()["roadmap_attention"]
        self.assertEqual([(entry["kind"], entry["title"]) for entry in attention], [("blocked", "Waiting on Prepare PR")])
        self.change("progress", milestone, first, summary="PR merged", status="done")
        self.assertEqual(self.state()["roadmap_attention"], [])
