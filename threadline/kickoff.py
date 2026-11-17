"""Project decisions and deterministic kickoff replays."""

import shlex
from datetime import date, datetime, timezone
from uuid import uuid4

SOURCE_NAMES = {"claude": "Claude Code", "codex": "Codex"}


def revisit_state(project, updated, scanned):
    if project.get("revisit_later"):
        reminder = project.get("revisit_on")
        return "due" if reminder and reminder <= date.fromtimestamp(scanned).isoformat() else "later"
    if project["status"] not in ("Completed", "Parked") and scanned - updated >= 14 * 86400:
        return "inactive"
    return None


def update_project_labels(project, data):
    production = data.get("in_production", project.get("in_production", False))
    later = data.get("revisit_later", project.get("revisit_later", False))
    reminder = data.get("revisit_on", project.get("revisit_on"))
    if not isinstance(production, bool) or not isinstance(later, bool):
        raise ValueError("Choose valid project labels.")
    if reminder is not None and (
        not isinstance(reminder, str) or date.fromisoformat(reminder).isoformat() != reminder
    ):
        raise ValueError("Enter a valid revisit date.")
    project.update(in_production=production, revisit_later=later, revisit_on=reminder if later else None)


def active_decisions(decisions):
    superseded = {decision["supersedes"] for decision in decisions}
    return [decision for decision in decisions if decision["id"] not in superseded]


def required_text(data, field, limit):
    value = data.get(field)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"Enter {field.replace('_', ' ')} up to {limit} characters.")
    return value.strip()


def new_decision(data, decisions, sessions):
    supersedes = data.get("supersedes")
    if supersedes is not None and not any(item["id"] == supersedes for item in active_decisions(decisions)):
        raise ValueError("That decision has already been superseded. Refresh and select the active revision.")
    source_session = data.get("source_session")
    if source_session is not None and (
        not isinstance(source_session, str) or source_session not in sessions
    ):
        raise ValueError("Choose a session linked to this project.")
    source = data.get("source", "")
    if not isinstance(source, str) or len(source) > 500:
        raise ValueError("Evidence must be at most 500 characters.")
    source = source.strip()
    if source_session:
        session = sessions[source_session]
        reference = f"{SOURCE_NAMES[session['source']]} · {session['title']} ({source_session})"
        source = f"{source} · {reference}" if source else reference
    if not source:
        raise ValueError("Enter evidence or choose a linked session.")
    return {
        "id": uuid4().hex,
        "choice": required_text(data, "choice", 600),
        "rationale": required_text(data, "rationale", 1600),
        "source": source,
        "source_session": source_session,
        "supersedes": supersedes,
        "accepted_on": date.today().isoformat(),
    }


def render_kickoff(project, sessions, decisions, task=""):
    applied = active_decisions(decisions)
    lines = [
        f"Continue {project['name']}.",
        f"Recorded stage: {project['status']}.",
        f"Checkpoint ({project['checkpoint']}): {project['summary'] or 'Unrecorded'}",
    ]
    if project["evidence"]:
        lines.append(f"Evidence: {project['evidence']}")
    lines.append(f"Next action: {project['next'] or 'Confirm the next concrete milestone.'}")
    if task:
        lines.append(f"Task: {task}")
    if applied:
        decision_lines = [
            f"- Decision {item['id']}: {item['choice']}\n  Rationale: {item['rationale']}\n  Source: {item['source']}"
            for item in applied
        ]
        lines.append("Accepted decisions:\n" + "\n".join(decision_lines))
    recent = []
    for session in sessions[:4]:
        command = ("codex resume " if session["source"] == "codex" else "claude --resume ") + session["id"]
        if session["cwd"]:
            command = f"cd {shlex.quote(session['cwd'])} && {command}"
        when = date.fromtimestamp(session["updated"]).isoformat() if session["updated"] else "Unknown date"
        recent.append(f"- {SOURCE_NAMES[session['source']]} · {session['title']} · {when}\n  {command}")
    if recent:
        lines.append("Related sessions:\n" + "\n".join(recent))
    lines.append("Verify the checkpoint against current files and session evidence before acting.")
    return "\n\n".join(lines)


def new_eval(data, project, sessions, decisions):
    expected = next((item for item in active_decisions(decisions) if item["id"] == data.get("decision")), None)
    if expected is None:
        raise ValueError("Choose an active decision to save as an eval.")
    return {
        "id": uuid4().hex,
        "name": required_text(data, "name", 100),
        "task": required_text(data, "task", 1000),
        "expected_decision": expected["id"],
        "project": {key: project[key] for key in ("name", "status", "checkpoint", "summary", "evidence", "next")},
        "sessions": list(sessions[:4]),
        "decisions": list(decisions),
        "results": [],
    }


def replay(case):
    brief = render_kickoff(case["project"], case["sessions"], case["decisions"], case["task"])
    expected = next(item for item in case["decisions"] if item["id"] == case["expected_decision"])
    actual = list(dict.fromkeys(line.removeprefix("- Decision ").partition(": ")[0] for line in brief.splitlines()
                                if line.startswith("- Decision ")))
    retired = {item["supersedes"] for item in case["decisions"]}
    expected_block = (f"- Decision {expected['id']}: {expected['choice']}\n"
                      f"  Rationale: {expected['rationale']}\n  Source: {expected['source']}")
    assertions = [
        {"name": "Expected revision appears", "passed": expected["id"] in actual},
        {"name": "Expected evidence appears with the revision", "passed": f"\n{expected_block}\n" in f"\n{brief}\n"},
        {"name": "Superseded revisions are excluded", "passed": not retired.intersection(actual)},
    ]
    return {
        "evaluated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "passed": all(assertion["passed"] for assertion in assertions),
        "expected": expected["id"],
        "actual": actual,
        "assertions": assertions,
        "brief": brief,
    }


def eval_summary(case):
    return {
        "id": case["id"], "name": case["name"], "task": case["task"],
        "expected_decision": case["expected_decision"],
        "runs": len(case["results"]),
        "last_result": case["results"][-1] if case["results"] else None,
    }
