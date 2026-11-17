import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { DecisionPanel } from "./DecisionPanel";
import { dateLabel, errorText, type ApplyDashboardChange, type Project, type ProjectStateChange, type Session } from "./model";
import { RevisitMark } from "./ProjectStatus";
import { SessionCard, type SessionActions } from "./SessionCard";

interface Props extends SessionActions {
  project: Project;
  sessions: Session[];
  statuses: string[];
  onEdit: (project: Project) => void;
  onCopy: (content: string, confirmation: string) => void;
  onKickoff: (project: string) => void;
  onApply: ApplyDashboardChange;
  onNotify: (message: string) => void;
}

export function ProjectDetails({ project, sessions, statuses, onEdit, onCopy, onKickoff, onApply, onNotify, onLink, onResume }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const displayed = showAll ? sessions : sessions.slice(0, 4);

  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    document.title = project.name + " · Threadline";
    return () => { document.title = "Threadline"; };
  }, [project.name]);

  async function changeProject(change: ProjectStateChange, message: string) {
    setError("");
    setSaving(true);
    try {
      await onApply(api.setProjectState(project.id, change));
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
        </div>
      </div>
      <div className="project-controls">
        <label>Status <select value={project.status} disabled={saving} onChange={(event) =>
          void changeProject({ status: event.target.value }, "Status updated")}>
          {statuses.map((status) => <option key={status}>{status}</option>)}
        </select></label>
        <button type="button" className="button secondary" id="edit" disabled={saving} onClick={() => onEdit(project)}>Edit details</button>
        <button type="button" className="button secondary" disabled={saving} onClick={() => void changeProject(
          { archived: !project.archived }, project.archived ? "Project restored" : "Project archived",
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
        <div className="project-actions">
          <button type="button" className="button secondary" id="copy-brief"
            onClick={() => onCopy(project.kickoff, "Continuation brief copied")}>
            Copy continuation brief
          </button>
          {!project.archived && <button type="button" className="button primary" onClick={() => onKickoff(project.id)}>
            Prepare kickoff
          </button>}
        </div>
        <DecisionPanel project={project} sessions={sessions} onApply={onApply} />
      </div>
      <section className="panel detail-body" aria-labelledby="linked-sessions-heading">
        <div className="session-title"><h2 id="linked-sessions-heading">Linked sessions</h2><span>{sessions.length}</span></div>
        {displayed.length ? displayed.map((session) =>
          <SessionCard key={session.key} session={session} onLink={onLink} onResume={onResume} />,
        ) : <p className="muted small">Find a conversation in the session inbox and link it here.</p>}
        {sessions.length > 4 && <button type="button" className="button text-button" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer sessions" : "Show all " + sessions.length + " sessions"}
        </button>}
      </section>
    </div>
  </article>;
}
