import { useState } from "react";
import { api } from "./api";
import { resumeCommand } from "./continuation";
import { errorText, shortDate, sourceNames, type ApplyDashboardChange, type DashboardState,
  type OutboxRun, type Proposal, type ReviewAction } from "./model";
import { roadmapHref } from "./navigation";

const runLabels = { running: "Running", completed: "Completed", failed: "Failed", interrupted: "Interrupted" };

interface Props {
  data: DashboardState;
  runId?: string;
  onApply: ApplyDashboardChange;
  onCopy: (text: string, confirmation: string) => void;
}

export function Outbox({ data, runId, onApply, onCopy }: Props) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const runs = runId ? data.outbox.filter((run) => run.id === runId) : data.outbox;
  async function review(run: string, proposal: Proposal | "audit", action: ReviewAction) {
    setPending(run);
    setError("");
    try {
      await onApply(proposal === "audit" ? api.acceptAudit(run) : api.review(run, proposal, action));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending("");
    }
  }

  return <section className="panel workflow-panel" aria-labelledby="runs-heading">
    <h2 id="runs-heading">Session runs</h2>
    {runId && <a className="project-back" href="#/outbox">Show all runs</a>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {runs.length ? <ol className="outbox-list" aria-live="polite">
      {runs.map((run) => {
        const project = data.projects.find((item) => item.id === run.project);
        const pattern = data.patterns.find((item) => item.id === run.pattern);
        const item = project?.roadmap.find((milestone) => milestone.id === run.audit?.milestone)
          ?.items.find((item) => item.id === run.audit?.item);
        return <li key={run.id}>
          <div className="outbox-title">
            <h3>{project?.name ?? "Project"} · {sourceNames[run.provider]}</h3>
            <span className={"status " + (run.status === "completed" ? "completed" :
              run.status === "running" ? "progress" : "blocked")}>{runLabels[run.status]}</span>
          </div>
          <p className="muted">{pattern?.title ?? run.pattern} · Revision {run.pattern_revision} · {shortDate(run.started)}</p>
          <p>{run.task}</p>
          {run.error && <p className="form-error">{run.error}</p>}
          {run.result && <p>{run.result.summary}</p>}
          {run.usage && <p className="muted">{run.usage.input_tokens.toLocaleString()} input · {run.usage.output_tokens.toLocaleString()} output tokens</p>}
          {run.audit && <div className="outbox-proposal">
            <h4>Candidate audit</h4>
            <p><strong>Commit</strong> <code className="audit-commit">{run.audit.commit}</code></p>
            {run.result?.verdict && <p><strong>Verdict</strong> {run.result.verdict}</p>}
            {item && <a href={roadmapHref(run.project, run.audit.milestone, run.audit.item, "handoff")}>View handoff</a>}
            {run.review.audit === "accepted" && <p className="muted">Accepted</p>}
            {run.review.audit === "pending" && <div className="workflow-actions">
              {!project?.archived && item?.status !== "done" && item?.audit?.run === run.id
                ? <button type="button" className="button primary" disabled={Boolean(pending)}
                    onClick={() => void review(run.id, "audit", "accept")}>Accept audit</button>
                : <p className="muted">The handoff is closed or has changed.</p>}
            </div>}
          </div>}
          {run.session_id && !run.audit && <div className="workflow-actions">
            <button type="button" className="button secondary" onClick={() => onCopy(resumeCommand({
              source: run.provider, id: run.session_id!, cwd: run.workspace,
            }), "Resume command copied")}>Copy resume command</button>
          </div>}
          {(["checkpoint", "decision"] as const).map((kind) => {
            const proposal = run.result?.[kind];
            return proposal && <ProposalCard key={kind} kind={kind} proposal={proposal} state={run.review[kind]}
              busy={Boolean(pending)} onReview={(action) => void review(run.id, kind, action)} />;
          })}
        </li>;
      })}
    </ol> : <p className="muted">{runId ? "This run is unavailable." : data.runner.providers.length
      ? "Start a session from Agentic Patterns to see its result here."
      : "Session launch is disabled. The Outbox shows results when a host runner is enabled."}</p>}
  </section>;
}

function ProposalCard({ kind, proposal, state, busy, onReview }: {
  kind: Proposal;
  proposal: NonNullable<NonNullable<OutboxRun["result"]>[Proposal]>;
  state: OutboxRun["review"][Proposal];
  busy: boolean;
  onReview: (action: ReviewAction) => void;
}) {
  return <section className="outbox-proposal">
    <h4>{kind === "checkpoint" ? "Proposed checkpoint" : "Proposed decision"}</h4>
    {"summary" in proposal ? <>
      <p>{proposal.summary}</p><p><strong>Next action</strong> {proposal.next}</p>
    </> : <>
      <p><strong>{proposal.choice}</strong></p><p>{proposal.rationale}</p>
    </>}
    <p className="muted"><strong>Source</strong> {proposal.source}</p>
    {state === "pending" ? <div className="workflow-actions">
      <button type="button" className="button primary" disabled={busy} onClick={() => onReview("accept")}>Accept {kind}</button>
      <button type="button" className="button secondary" disabled={busy} onClick={() => onReview("dismiss")}>Dismiss {kind}</button>
    </div> : <p className="muted">{state === "accepted" ? "Accepted" : "Dismissed"}</p>}
  </section>;
}
