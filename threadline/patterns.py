"""Versioned kickoff patterns adapted from the AI zoo."""

import hashlib
import json

from .kickoff import active_decisions, render_kickoff, required_text


PATTERNS = (
    {
        "id": "opus-haiku", "revision": 1, "title": "Opus orchestrator, Haiku workers",
        "summary": "Use when the work needs careful decomposition and has narrowly scoped parts.",
        "roles": ["Opus · Define scope, assign tasks, and integrate evidence.",
                  "Haiku · Complete one bounded assignment per worker."],
        "steps": ["Agree on acceptance checks before dividing the work.",
                  "Assign each worker a deliverable and a disjoint scope.",
                  "Review each result against its assignment before integrating."],
        "stop": "Report the verified result or the question that blocks integration.",
    },
    {
        "id": "haiku-opus", "revision": 1, "title": "Haiku orchestrator, Opus specialists",
        "summary": "Use for a known checklist with occasional difficult judgments.",
        "roles": ["Haiku · Follow the checklist and record the result of each step.",
                  "Opus · Resolve one explicitly escalated question."],
        "steps": ["State the escalation conditions before beginning.",
                  "Escalate a failed check or unresolved ambiguity with the relevant evidence.",
                  "Record the specialist's answer and resume only when it resolves the blocker."],
        "stop": "Report checklist results and any unresolved escalation.",
    },
    {
        "id": "producer-auditor", "revision": 1, "title": "Producer and independent auditor",
        "summary": "Use when an artifact needs independent review against agreed checks.",
        "roles": ["Producer · Create the candidate and report its revision.",
                  "Auditor · Review in a separate read-only session."],
        "steps": ["Agree on verification criteria before producing the candidate.",
                  "Run the approved checks against the exact candidate revision.",
                  "Give an independent auditor the artifact, revision, criteria, and check results.",
                  "Repeat checks and review whenever the candidate revision changes."],
        "stop": "Hand the verified revision and audit evidence to a human for acceptance.",
    },
    {
        "id": "molt-sinai", "revision": 1, "title": "MOLT Sinai",
        "summary": "Use for consequential changes that need review before and after implementation.",
        "roles": ["Planner · Triage, capture a baseline, and propose a scoped plan.",
                  "Implementer · Execute the approved plan and record verification.",
                  "Reviewer · Review the plan and candidate in separate contexts."],
        "steps": ["Open one case and record the baseline, scope, and acceptance checks.",
                  "Get independent approval of the exact plan before implementation.",
                  "Implement the approved plan and record the candidate revision and check results.",
                  "Get independent review of that candidate. Return material plan changes to plan review.",
                  "Verify the reviewed and candidate revisions match, then surface evidence for human acceptance."],
        "stop": "Pause for human review after readiness verification or when a blocker survives rework.",
        "source": "https://www.cockroachlabs.com/blog/experiment-running-hospital-code/",
    },
)


def checkpoint_fields(project):
    return {field: project[field] for field in ("checkpoint", "summary", "next", "evidence", "status")}


def preview_kickoff(project, sessions, data, runner_options):
    pattern = next((item for item in PATTERNS if item["id"] == data.get("pattern")), None)
    if pattern is None:
        raise ValueError("Choose a kickoff pattern.")
    workspace = data.get("workspace", "")
    known_workspaces = {row["workspace"] for row in sessions} | set(project["roots"])
    if not isinstance(workspace, str) or (workspace and workspace not in known_workspaces
                                          and workspace not in runner_options["workspaces"]):
        raise ValueError("Choose a known workspace.")
    task = required_text(data, "task", 1000)
    criteria = required_text(data, "criteria", 1600)
    decisions = project.get("decisions", [])
    brief = render_kickoff(project, sessions, decisions, task)
    roles = "\n".join(f"- {role}" for role in pattern["roles"])
    steps = "\n".join(f"{number}. {step}" for number, step in enumerate(pattern["steps"], 1))
    brief += (
        f"\n\nPattern: {pattern['title']} (revision {pattern['revision']})"
        + (f"\nWorkspace: {workspace}" if workspace else "")
        + f"\n\nAcceptance criteria:\n{criteria}\n\nRoles:\n{roles}\n\nWorkflow:\n{steps}"
          f"\n\nStop when: {pattern['stop']}"
    )
    provider = data.get("provider", "")
    if not isinstance(provider, str) or (provider and provider not in runner_options["providers"]):
        raise ValueError("Choose a configured runner or copy the kickoff.")
    if provider:
        if workspace not in runner_options["workspaces"]:
            raise ValueError("Choose an enrolled workspace for this runner.")
        brief += (
            "\n\nThis launch starts one read-only session. Begin with the first applicable stage."
            " Treat the role settings as a plan and report any handoffs needed for the later stages."
            " Return an evidence-backed summary and optional proposed checkpoint and decision for human review."
            " Use null when there is no proposal."
        )
    preview = {
        "project": project["id"],
        "pattern": pattern["id"],
        "pattern_revision": pattern["revision"],
        "provider": provider,
        "workspace": workspace,
        "task": task,
        "brief": brief,
        "checkpoint": checkpoint_fields(project),
        "decision_revisions": [item["id"] for item in active_decisions(decisions)],
    }
    digest = hashlib.sha256(json.dumps(preview, sort_keys=True).encode()).hexdigest()
    return {**preview, "digest": digest}
