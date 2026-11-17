# Threadline feature specification

## React dashboard

Build the dashboard with React, TypeScript, and Vite. Keep the Python HTTP API and project store as the source of truth. Node builds the static frontend. The native Python archive and the optional Alpine image both include the built assets.

Organize the frontend around what users see and do.

- `ProjectRegister`, `ProjectDetails`, and `ProjectEditor` cover the main dashboard and project editing.
- `SessionInbox` handles discovering, linking, and unlinking sessions. `RevisitView` handles follow-ups.
- One API client handles HTTP requests. One dashboard hook owns loading, refresh, and persisted edits. Form drafts live inside their editors. Keep continuation-brief formatting as a plain function.

Port the existing screens first. Exercise the demo and a saved register to verify that project edits, session links, filters, and continuation briefs carry over. Then add project labels and reminders.

## Project labels and reminders

Keep the existing work status. Add an editable **In production** badge. A project can be in production while active development continues or while work is parked. The badge records a user-confirmed deployment state. The checkpoint and its evidence can record what was verified.

**Revisit later** is an explicit follow-up with an optional date. An undated follow-up appears under **Later**. A dated follow-up appears under **Due** on or after that date. The inactivity rule continues to surface open projects after 14 days. Parking a project without a follow-up removes it from inactivity reminders.

Existing records load with an unset production badge and follow-up. Saving the new fields preserves each project's other details and session links.

## Decision history and evals proposal

Add a **Decisions** panel to each project. A decision records the choice, its rationale, the session or artifact that supports it, and who approved it. Users can record a decision directly or accept a draft from the Outbox. A change creates a new revision that links to the decision it supersedes. The timeline displays both revisions and identifies which one applies now.

Show the applicable accepted decisions in the kickoff preview with links to their evidence. Keep open questions visible as questions. A later session can propose a change through the Outbox for the user to review.

### Turn a decision into an eval

Add **Save as eval** to a decision and **Evals** to the project. The case editor lets the user select a checkpoint and decision snapshot, enter a task, and define what the kickoff should carry forward. Save the expected results as a versioned case. Each evaluation run records the case revision, pattern revision, and result.

**Replay kickoff** checks that the rendered brief and its source references match the expected decision revisions. The result shows pass or fail per assertion, with the expected revision, the actual revision, and the rendered excerpt. Start with a case where an older session makes Docker the default and a later accepted decision makes Docker optional. The kickoff should show the active decision and link to its source.

Once a runner is available, add **Run against a pattern** to test how an agent acts on the brief. Use the same frozen case to compare kickoff patterns. Check structured outputs where the expected action is explicit. Let users grade interpretation or tradeoffs against a saved rubric. Save the actual model settings and evidence for each result. Human-reviewed expectations stay fixed during each comparison.

AI zoo references at the pinned revision include `precedent-log.md` for approved decisions, `evidence-bounded-session-checkpoints.md` for source references, and `golden-set-model-regression.md` for replaying fixed cases.

## Agentic Patterns proposal

Add **Agentic Patterns** to the sidebar. Each entry describes when to use the pattern, the role assignments, the expected evidence, and the stopping condition. Record a stable ID, a revision, and the source in the curated AI zoo. Bundle the selected definitions with Threadline so a kickoff uses the reviewed version.

| Starter entry | What the kickoff asks for |
| --- | --- |
| Opus orchestrator, Haiku workers | Opus breaks down an ambiguous task and integrates the results. Haiku workers take narrowly scoped assignments with explicit deliverables. |
| Haiku orchestrator, Opus specialists | Haiku follows a known checklist and assigns a bounded question to Opus when an explicit escalation condition is met. |
| Producer and independent auditor | A producer creates the artifact. Approved deterministic checks run against its exact revision. A separate, read-only reviewer evaluates that revision against the same acceptance criteria. |
| MOLT Sinai | Run a consequential change through intake, plan review, implementation, independent review, and a final check of the review evidence. |

Model assignments are presets attached to roles. Claude Code supports explicit subagent model selection. Show the model and role settings the selected runner can support. Surface a model substitution or an unverified assignment in the result. [Claude Code subagent model selection](https://code.claude.com/docs/en/sub-agents#choose-a-model)

### Kick off a project with a pattern

1. Choose **Use in project** on a pattern card and select a project. A project's **Start new session** action can also open the pattern picker.
2. Preview an editable kickoff with the saved checkpoint, applicable accepted decisions, workspace, task objective, acceptance criteria, and selected role assignments. Show the runner and its permission mode before launch.
3. **Copy kickoff** copies the brief for a fresh manual session. **Start session** queues the reviewed kickoff for an enrolled runner that supports the selected roles and permissions.
4. Record the project, checkpoint and decision revisions, pattern revision, requested model settings, and new session ID on the run. Show the outcome and any proposed checkpoint or decision in the Outbox for review.

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

Start with the curated entries and a project-specific **Copy kickoff** flow. For MOLT Sinai, start with a brief for one case and record each stage as the work proceeds. Verify that the same project checkpoint, task, and pattern revision produce the same kickoff text. Add runner dispatch after that flow is usable. Replaying a launch event should create at most one new session. A runner with unverified role support can offer the copy path and explain which capability is unavailable.

AI zoo references at `b7381160ea78aba37cc78e053faa9e5fd2e23d64` include `supervision-ladder.md` for escalation, `who-can-say-no.md` for independent checks, and `lane-ownership-review-binding.md` for review provenance. The `molt-sinai.md` evaluation also covers plan review, test integrity, bounded rework, and readiness checks.
