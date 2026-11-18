"""Fictional projects and sessions. Demo mode never scans the real history stores."""

from datetime import date, datetime, timedelta
from uuid import NAMESPACE_URL, uuid5

from .history import session


PROJECTS = (
    ("drift", "Drift Monitor", "Model evaluation", "In progress", 0,
     "The replay harness scores schema validity and citation accuracy against 24 labeled outputs. A nightly run produced the first report.",
     "Review the four citation misses and add a held-out set for the next run.",
     "Synthetic evaluation run 018"),
    ("lighthouse", "Lighthouse Triage", "Incident response", "Prototype", 4,
     "A read-only incident assistant can connect rollout events to container logs in three synthetic startup failures.",
     "Add a clean-start control and a case with delayed logs before comparing retrieval strategies.",
     "Synthetic startup replay"),
    ("relay", "Relay Mapper", "Agent tooling", "Blocked", 18,
     "The change planner can generate a reviewable dependency upgrade across sample repositories. Two fixtures resolve the same package from different registries.",
     "Write the registry precedence rule and add fixtures for both resolutions.",
     "Sample registry fixture"),
    ("fieldnotes", "Fieldnotes Search", "Retrieval", "Prototype", 23,
     "BM25 and vector search both run over the same fiction corpus. Results are ready for a side-by-side review.",
     "Label 15 queries with answer spans and rerun both indexes against the frozen corpus.",
     "Fiction corpus search report"),
    ("switchyard", "Switchyard Rules", "Review automation", "Planned", 27,
     "The first draft covers a schema for review comments and a policy for abstaining when the diff is incomplete.",
     "Turn the proposed comment schema into three replay fixtures.",
     "Review contract draft"),
    ("buoy", "Buoy Reports", "Developer tooling", "Completed", 32,
     "The sample build exports an HTML summary and a JSON report from the same evaluation run.",
     "No follow-up scheduled.",
     "Synthetic release checklist"),
)

SESSIONS = (
    ("drift", "claude", "Inspect the citation misses from the overnight run", 0),
    ("drift", "codex", "Add schema and citation scorers to the replay harness", 1),
    ("drift", "claude", "Write the evaluation rubric for labeled answers", 3),
    ("drift", "codex", "Generate sample outputs for the first replay", 6),
    ("lighthouse", "codex", "Tie rollout events to container startup logs", 4),
    ("lighthouse", "claude", "Draft the startup failure replay fixtures", 6),
    ("lighthouse", "codex", "Add evidence citations to the incident timeline", 8),
    ("relay", "claude", "Compare registry precedence in the upgrade fixtures", 18),
    ("relay", "codex", "Build a sample dependency project matrix", 19),
    ("fieldnotes", "claude", "Review search results for the fiction corpus", 23),
    ("fieldnotes", "codex", "Run BM25 and vector retrieval against the same corpus", 25),
    ("switchyard", "codex", "Sketch a schema for review comments", 27),
    ("buoy", "claude", "Verify HTML and JSON reports against the same run", 32),
    ("buoy", "codex", "Add an HTML report beside the JSON output", 34),
    ("pocket-index", "claude", "Sketch an index for short technical notes", 1),
    ("pocket-index", "codex", "Add fixture generation for the Pocket Index", 2),
    ("range-check", "codex", "Compare boundary cases for tool arguments", 2),
    ("range-check", "claude", "Review validation coverage for tool schemas", 5),
    ("papertrail", "claude", "Evaluate a compressed trace format", 3),
)


def demo_content(today=None):
    today = today or date.today()

    def day(ago):
        return today - timedelta(days=ago)

    projects = [
        dict(id=identity, name=name, area=area, status=status, summary=summary, next=next_action,
             evidence=evidence, checkpoint=day(age).isoformat(), aliases=[], roots=[f"/workspace/{identity}"],
             sessions=[])
        for identity, name, area, status, age, summary, next_action, evidence in PROJECTS
    ]
    rows = []
    for workspace, source, label, age in SESSIONS:
        cwd = f"/workspace/{workspace}"
        identity = str(uuid5(NAMESPACE_URL, "threadline.example/" + label))
        when = int(datetime.combine(day(age), datetime.min.time()).timestamp())
        row = session(source, identity, label, cwd, when, age >= 18)
        row["workspace"] = cwd
        row["activity"] = {0: "needs_input", 1: "working", 3: "idle"}.get(age, "saved")
        rows.append(row)
    rows.sort(key=lambda row: row["updated"], reverse=True)
    return projects, rows
