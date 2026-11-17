# Threadline feature specification

## React dashboard

Build the dashboard with React, TypeScript, and Vite. Keep the Python HTTP API and project store as the source of truth. Node builds the static frontend. The native Python archive and the optional Alpine image both include the built assets.

Organize the frontend around what users see and do.

- `ProjectRegister`, `ProjectDetails`, and `ProjectEditor` cover the main dashboard and project editing.
- `SessionInbox` shows session metadata and opens the link editor. The project register also supports a Revisit view.
- One API client handles HTTP requests. One dashboard hook owns loading, refresh, and persisted edits. Form drafts live inside their editors. Keep continuation-brief formatting as a plain function.

Port the existing screens first. Exercise the demo and a saved register to verify that project edits, session links, filters, and continuation briefs carry over. Then add project labels and reminders.

## Project pages, status, and reminders

Each project opens on a dedicated page with a bookmarkable URL. Change its status from the page header. **In production** is a status alongside **In progress**, **Planned**, and the other project stages. Projects with a legacy production badge migrate to **In production** when loaded.

**Archive project** moves the project out of active views and the Revisit queue. The Archive view preserves access to its checkpoint, decisions, and sessions. **Restore project** returns it to the register with its previous status.

**Revisit later** is an explicit follow-up with an optional date. Undated and future follow-ups appear under **Later**. Dated follow-ups move to **Due** on their reminder date. Open projects without a follow-up appear under **Due** after 14 days of inactivity. Parking a project suppresses its inactivity reminder.

Status and archive actions keep the checkpoint date and session links intact.

## Decision history and kickoff evals

Use **Decisions** to record a choice, its rationale, and its source. A change creates a new revision linked to the decision it supersedes. The timeline retains both revisions and shows which one applies now. The copied continuation brief includes the active revisions and their evidence.

The Outbox holds proposed decisions and checkpoints for manual acceptance or dismissal.

Manual launches are the first inbox event. The worker records each outcome in the Outbox, where it can wait for human review across restarts. [Building always-on agents](https://claude.com/resources/articles/building-always-on-agents)

### Turn a decision into an eval

Choose **Save as eval** on an active decision and enter a kickoff task. The case freezes the current checkpoint, recent linked sessions, decision history, and expected decision. Each replay saves its result under that case.

**Replay kickoff** uses the continuation brief formatter and checks that the rendered text includes the expected decision and its source and excludes superseded revisions. The result shows pass or fail per assertion, the expected and rendered revision IDs, and the full brief.

Once a runner is available, add **Run against a pattern** to test how an agent acts on the brief. Use the same frozen case to compare kickoff patterns. Check structured outputs where the expected action is explicit. Let users grade interpretation or tradeoffs against a saved rubric. Save the actual model settings and evidence for each result. Human-reviewed expectations stay fixed during each comparison.

AI zoo references at the pinned revision include `precedent-log.md` for approved decisions, `evidence-bounded-session-checkpoints.md` for source references, and `golden-set-model-regression.md` for replaying fixed cases.

## Agentic Patterns

The **Agentic Patterns** catalog describes when to use each workflow, its role assignments, expected evidence, and stopping condition. Built-in definitions have stable IDs and revisions.

| Starter entry | What the kickoff asks for |
| --- | --- |
| Opus orchestrator, Haiku workers | Opus breaks down an ambiguous task and integrates the results. Haiku workers take narrowly scoped assignments with explicit deliverables. |
| Haiku orchestrator, Opus specialists | Haiku follows a known checklist and assigns a bounded question to Opus when an explicit escalation condition is met. |
| Producer and independent auditor | A producer creates the artifact. Approved deterministic checks run against its exact revision. A separate, read-only reviewer evaluates that revision against the same acceptance criteria. |
| MOLT Sinai | Run a consequential change through intake, plan review, implementation, independent review, and a final check of the review evidence. |

The model assignments describe intended roles in the brief. A host launch uses the configured CLI model for one read-only session. Explicit subagent routing is a future capability.

### Kick off a project with a pattern

1. Choose a pattern and a project, or select **Prepare kickoff** from a project.
2. Enter the task and acceptance criteria. Preview a brief with the saved checkpoint, active decision revisions, workspace, and roles. For a host launch, choose the provider and an enrolled workspace.
3. **Copy kickoff** copies the brief for a fresh manual session. **Start session** launches the reviewed brief. The host processes one launch at a time, and retrying the same submission returns the same run.
4. The run stores the brief, project, checkpoint, decision revisions, pattern revision, provider, workspace, and session ID when the CLI returns it. The Outbox shows the result and any proposed checkpoint or decision for manual review.

A producer receives the approved checks and can report evidence from its own work. The runner owns the check definitions and results. Independent review runs in its own context with read-only artifact access. Record which revision each check or review covered. A new revision requires a fresh check. Human acceptance closes the work.

### MOLT Sinai

Use this workflow for work that benefits from review before implementation and can span sessions. The kickoff opens one case in the selected project. The case record carries the task, approved plan, test and review evidence, and next decision across those sessions. Cockroach Labs runs its original workflow through issue labels and GitHub Actions. Threadline can use its inbox, case record, and Outbox to carry the same handoffs. [Cockroach Labs' MOLT Sinai write-up](https://www.cockroachlabs.com/blog/experiment-running-hospital-code/)

| Stage | Evidence required to advance |
| --- | --- |
| Triage and plan | Record the reproduction or baseline, scope, target revision, acceptance checks, and risks. Break large work into cases with explicit dependencies. |
| Plan review | A separate reviewer records approval against that plan revision. A material scope change returns to this stage. |
| Implement | Record the candidate revision and results from the approved checks. For a bug fix, show that the new regression test detects the original failure when feasible. |
| Review | A separate reviewer audits the exact candidate revision and records any blockers. Rework returns to implementation. When the rework limit is reached, post the evidence and question in the Outbox for a human decision. |
| Verify readiness | Check that the reviewed revision matches the candidate, required checks passed, and blockers are resolved. Surface the evidence for human acceptance and any merge decision. |

An escalation handoff carries the current revision, attempts, evidence, and open decision. The receiving session restates the goal and next step. Human-approved precedents can carry decisions across later cases when the same situation recurs.

### First release

The first release offers a MOLT Sinai brief and an optional initial read-only session. Later stages run through separate sessions with human review. Tracking stage transitions and enforcing independent review in the app are future work.

AI zoo references at `b7381160ea78aba37cc78e053faa9e5fd2e23d64` include `supervision-ladder.md` for escalation, `who-can-say-no.md` for independent checks, and `lane-ownership-review-binding.md` for review provenance. The `molt-sinai.md` evaluation also covers plan review, test integrity, bounded rework, and readiness checks.
