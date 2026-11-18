import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ContinueProject } from "./ContinueProject";
import { DecisionPanel } from "./DecisionPanel";
import { LinkedSessions } from "./LinkedSessions";
import { SessionAnalysis } from "./SessionAnalysis";
import type { SessionSource } from "./model";
import { dateLabel, errorText, type ApplyDashboardChange, type DashboardState, type Project, type Session } from "./model";
import { attentionHref } from "./navigation";
import { RevisitMark } from "./ProjectStatus";
import type { SessionActions } from "./SessionCard";

interface Props extends SessionActions {
  project: Project;
  sessions: Session[];
  statuses: string[];
  providers: SessionSource[];
  needsAttention: number;
  onEdit: (project: Project) => void;
  onCopy: (content: string, confirmation: string) => void;
  onKickoff: (project: string) => void;
  onApply: ApplyDashboardChange;
  onNotify: (message: string) => void;
}

export function ProjectDetails({ project, sessions, statuses, providers, needsAttention,
  onEdit, onCopy, onKickoff, onApply, onNotify, onLink, onResume }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const pinned = sessions.find((session) => session.key === project.continuation_session);

  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    document.title = project.name + " · Threadline";
    return () => { document.title = "Threadline"; };
  }, [project.name]);

  async function changeProject(request: Promise<DashboardState>, message: string) {
    setError("");
    setSaving(true);
    try {
      await onApply(request);
      onNotify(message);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving(false);
    }
  }

  return <article id="detail" aria-labelledby="detail-heading">
    <a className="project-back" href={project.archived ? "#/archive" : "#/projects"}>
      <span aria-hidden="true">←</span> {project.archived ? "Back to archive" : "Back to projects"}
    </a>
    <header className="project-heading">
      <div>
        <h1 id="detail-heading" ref={heading} tabIndex={-1}>{project.name}</h1>
        <div className="detail-meta">
          <span>{project.area || "General"}</span>
          {project.archived && <strong>Archived project</strong>}
          <RevisitMark project={project} />
          {!project.archived && project.revisit_on && <span>Follow-up {dateLabel(project.revisit_on)}</span>}
          {needsAttention > 0 && <a href={attentionHref(project.id)}>Needs attention ({needsAttention})</a>}
        </div>
      </div>
      <div className="project-controls">
        <label>Status <select value={project.status} disabled={saving} onChange={(event) =>
          void changeProject(api.setProjectState(project.id, { status: event.target.value }), "Status updated")}>
          {statuses.map((status) => <option key={status}>{status}</option>)}
        </select></label>
        <button type="button" className="button secondary" id="edit" disabled={saving} onClick={() => onEdit(project)}>Edit details</button>
        <button type="button" className="button secondary" disabled={saving} onClick={() => void changeProject(
          api.setProjectState(project.id, { archived: !project.archived }), project.archived ? "Project restored" : "Project archived",
        )}>{project.archived ? "Restore project" : "Archive project"}</button>
      </div>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="layout project-content">
      <div className="panel detail-body">
        <section className="checkpoint">
          <h2>Last checkpoint</h2>
          <p>{project.summary || "No checkpoint recorded."}</p>
          <p className="evidence">{project.evidence && project.evidence + " · "}{dateLabel(project.checkpoint)}</p>
        </section>
        <section className="next">
          <h2>Next action</h2>
          <p>{project.next || "No next action recorded."}</p>
        </section>
        <ContinueProject project={project} pinned={pinned} onCopy={onCopy} onResume={onResume} onKickoff={onKickoff} />
        <SessionAnalysis project={project} sessions={sessions} providers={providers} onApply={onApply} />
        <DecisionPanel project={project} sessions={sessions} onApply={onApply} />
      </div>
      <LinkedSessions sessions={sessions} pinned={pinned} saving={saving} onPin={(key) => void changeProject(
        api.setContinuation(project.id, key), key ? "Continuation session pinned" : "Continuation session unpinned",
      )} onLink={onLink} onResume={onResume} />
    </div>
  </article>;
}
