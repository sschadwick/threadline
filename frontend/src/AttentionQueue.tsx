import { useState } from "react";
import { api } from "./api";
import { errorText, sourceNames, type ApplyDashboardChange, type DashboardState, type OutboxRun, type Project,
  type Session } from "./model";
import { attentionHref, projectHref } from "./navigation";
import { SessionCard, type SessionActions } from "./SessionCard";
import { sessionStatus } from "./sessionStatus";

export function projectAttention(data: DashboardState) {
  return data.projects.flatMap((project) => {
    const sessions = data.sessions.filter((session) => session.project === project.id && sessionStatus(session) === "needs_input");
    const runs = data.outbox.filter((run) => run.project === project.id && (
      Object.values(run.review).includes("pending") || (needsAcknowledgement(run) && !run.acknowledged)
    ));
    return sessions.length || runs.length ? [{ project, sessions, runs }] : [];
  });
}

function needsAcknowledgement(run: OutboxRun) {
  return run.status === "failed" || run.status === "interrupted";
}

interface Props extends SessionActions {
  groups: { project: Project; sessions: Session[]; runs: OutboxRun[] }[];
  projectId?: string;
  onApply: ApplyDashboardChange;
}

export function AttentionQueue({ groups, projectId, onApply, onLink, onResume }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const visible = projectId ? groups.filter(({ project }) => project.id === projectId) : groups;

  async function acknowledge(runId: string) {
    setPending(true);
    setError("");
    try {
      await onApply(api.acknowledge(runId));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(false);
    }
  }

  return <div className="attention-queue">
    {projectId && <a className="project-back" href={attentionHref()}>Show all projects</a>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {visible.length ? visible.map(({ project, sessions, runs }) =>
      <section key={project.id} className="panel workflow-panel">
        <h2><a className="project-back" href={projectHref(project.id)}>{project.name}</a></h2>
        {sessions.map((session) => <SessionCard key={session.key} session={session} onLink={onLink} onResume={onResume} />)}
        {runs.length > 0 && <ul className="outbox-list">
          {runs.map((run) => <li key={run.id}>
            <div className="outbox-title">
              <h3>{run.task}</h3>
              <span className={"status " + (needsAcknowledgement(run) ? "blocked" : "progress")}>
                {run.status === "failed" ? "Failed" : run.status === "interrupted" ? "Interrupted" : "Ready for review"}
              </span>
            </div>
            <p className="muted">{sourceNames[run.provider]}{run.error && " · " + run.error}</p>
            <div className="workflow-actions">
              <a className="button secondary" href={"#/outbox?run=" + encodeURIComponent(run.id)}>View in Outbox</a>
              {needsAcknowledgement(run) && <button type="button" className="button secondary" disabled={pending}
                onClick={() => void acknowledge(run.id)}>Acknowledge</button>}
            </div>
          </li>)}
        </ul>}
      </section>,
    ) : <p className="panel empty">Nothing needs attention.</p>}
  </div>;
}
