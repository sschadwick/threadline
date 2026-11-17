import { shortDate, sourceNames, type Session } from "./model";

export interface SessionActions {
  onLink: (session: Session) => void;
  onResume: (session: Session) => void;
}

interface Props extends SessionActions {
  session: Session;
  expanded?: boolean;
  projectName?: string;
}

export function SessionCard({ session, expanded, projectName, onLink, onResume }: Props) {
  return <div className="session-item">
    <div className="session-info">
      <strong title={session.title}>{session.title}</strong>
      <small>
        <span className="source-label"><i className={"source-dot " + session.source} />{sourceNames[session.source]}</span>
        {" · " + shortDate(session.updated)}
        {session.archived && " · Archived"}
        {projectName && " · " + projectName}
      </small>
      {expanded && session.cwd && <small className="cwd" title={session.cwd}>{session.cwd}</small>}
    </div>
    <button className="icon-button" type="button" aria-label={"Copy resume command for " + session.title}
      title="Copy resume command" data-resume={session.key} onClick={() => onResume(session)}>⧉</button>
    <button className={expanded ? "button secondary" : "icon-button"} type="button" title="Manage project link"
      aria-label={"Manage project link for " + session.title} data-link={session.key} onClick={() => onLink(session)}>
      {expanded ? (session.project ? "Change link" : "Link") : "↗"}
    </button>
  </div>;
}
