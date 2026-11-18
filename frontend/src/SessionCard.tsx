import { shortDate, sourceNames, type Session } from "./model";
import { sessionStatus, sessionStatusLabels } from "./sessionStatus";

export interface SessionActions {
  onLink: (session: Session) => void;
  onResume: (session: Session) => void;
}

interface Props extends SessionActions {
  session: Session;
  expanded?: boolean;
  projectName?: string;
  pinned?: boolean;
  pinDisabled?: boolean;
  onPin?: () => void;
}

export function SessionCard({ session, expanded, projectName, pinned, pinDisabled, onPin, onLink, onResume }: Props) {
  const status = sessionStatus(session);
  return <div className="session-item">
    <div className="session-info">
      <strong title={session.title}>{session.title}</strong>
      <small>
        <span className="source-label"><i className={"source-dot " + session.source} />{sourceNames[session.source]}</span>
        {" · " + shortDate(session.updated) + " · "}
        <span className={"session-state " + status}>{sessionStatusLabels[status]}</span>
        {projectName && " · " + projectName}
      </small>
      {expanded && session.cwd && <small className="cwd" title={session.cwd}>{session.cwd}</small>}
    </div>
    {onPin && <button type="button" className="icon-button" aria-pressed={pinned}
      aria-label={(pinned ? "Unpin " : "Pin ") + session.title} title={pinned ? "Unpin session" : "Pin for continuation"}
      disabled={pinDisabled} onClick={onPin}>{pinned ? "★" : "☆"}</button>}
    <button className="icon-button" type="button" aria-label={"Copy resume command for " + session.title}
      title="Copy resume command" data-resume={session.key} onClick={() => onResume(session)}>⧉</button>
    <button className={expanded ? "button secondary" : "icon-button"} type="button" title="Manage project link"
      aria-label={"Manage project link for " + session.title} data-link={session.key} onClick={() => onLink(session)}>
      {expanded ? (session.project ? "Change link" : "Link") : "↗"}
    </button>
  </div>;
}
