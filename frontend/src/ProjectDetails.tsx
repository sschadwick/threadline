import { useState } from "react";
import { DecisionPanel } from "./DecisionPanel";
import { dateLabel, type ApplyDashboardChange, type Project, type Session } from "./model";
import { SessionCard, type SessionActions } from "./SessionCard";

export const statusClass: Record<string, string> = {
  "In progress": "progress", Prototype: "prototype", Planned: "planned",
  Blocked: "blocked", Parked: "parked", Completed: "completed",
};

export function ProjectStatus({ project }: { project: Project }) {
  const revisitLabel = project.revisit_state && { later: "Revisit later", due: "Revisit due", inactive: "Revisit" }[project.revisit_state];
  return <>
    <span className={"status " + statusClass[project.status]}><i />{project.status}</span>
    {project.in_production && <span className="production-mark">In production</span>}
    {revisitLabel && <span className="revisit-mark">{revisitLabel}</span>}
  </>;
}

interface Props extends SessionActions {
  project: Project;
  sessions: Session[];
  onEdit: (project: Project) => void;
  onCopy: (content: string, confirmation: string) => void;
  onKickoff: (project: string) => void;
  onApply: ApplyDashboardChange;
}

export function ProjectDetails({ project, sessions, onEdit, onCopy, onKickoff, onApply, onLink, onResume }: Props) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? sessions : sessions.slice(0, 4);

  return <>
    <div className="detail-head">
      <span>PROJECT DETAILS</span>
      <button type="button" className="button secondary" id="edit" onClick={() => onEdit(project)}>Edit</button>
    </div>
    <div className="detail-body">
      <h2 id="detail-heading" tabIndex={-1}>{project.name}</h2>
      <div className="detail-meta">
        <ProjectStatus project={project} /><span>{project.area || "General"}</span>
        {project.revisit_on && <span>Follow-up {dateLabel(project.revisit_on)}</span>}
      </div>
      <section className="checkpoint">
        <h3>Last checkpoint</h3>
        <p>{project.summary || "No checkpoint recorded."}</p>
        <p className="evidence">{project.evidence && project.evidence + " · "}{dateLabel(project.checkpoint)}</p>
      </section>
      <section className="next">
        <h3><span aria-hidden="true">↳</span> Next action</h3>
        <p>{project.next || "No next action recorded."}</p>
      </section>
      <button type="button" className="button copy-brief" id="copy-brief"
        onClick={() => onCopy(project.kickoff, "Continuation brief copied")}>
        <span aria-hidden="true">⧉</span> Copy continuation brief
      </button>
      <button type="button" className="button secondary copy-brief" onClick={() => onKickoff(project.id)}>
        Prepare kickoff
      </button>
      <DecisionPanel project={project} sessions={sessions} onApply={onApply} />
      <div className="session-title"><h3>Linked sessions</h3><span>{sessions.length}</span></div>
      {displayed.length ? displayed.map((session) =>
        <SessionCard key={session.key} session={session} onLink={onLink} onResume={onResume} />,
      ) : <p className="muted small">Find a conversation in the session inbox and link it here.</p>}
      {sessions.length > 4 && <button type="button" className="button text-button" onClick={() => setShowAll(!showAll)}>
        {showAll ? "Show fewer sessions" : "Show all " + sessions.length + " sessions"}
      </button>}
    </div>
  </>;
}
