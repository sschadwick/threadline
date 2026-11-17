import { useState } from "react";
import type { Session } from "./model";
import { SessionCard, type SessionActions } from "./SessionCard";
import { SessionStatusSelect } from "./SessionStatusFilter";
import { sessionStatus, type SessionStatusFilter } from "./sessionStatus";

interface Props extends SessionActions {
  sessions: Session[];
  pinned?: Session;
  saving: boolean;
  onPin: (key: string | null) => void;
}

export function LinkedSessions({ sessions, pinned, saving, onPin, onResume, onLink }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [status, setStatus] = useState<SessionStatusFilter>("all");
  const matching = sessions.filter((session) => status === "all" || sessionStatus(session) === status);
  if (pinned && matching.includes(pinned)) {
    matching.splice(matching.indexOf(pinned), 1);
    matching.unshift(pinned);
  }
  const displayed = showAll ? matching : matching.slice(0, 4);

  return <section className="panel detail-body" aria-labelledby="linked-sessions-heading">
    <div className="session-title">
      <h2 id="linked-sessions-heading">Linked sessions</h2>
      <span>{matching.length}</span>
      {sessions.length > 0 && <SessionStatusSelect value={status}
        onChange={(value) => { setStatus(value); setShowAll(false); }} />}
    </div>
    {displayed.length ? displayed.map((session) => <SessionCard key={session.key} session={session}
      pinned={session.key === pinned?.key} pinDisabled={saving}
      onPin={() => onPin(session.key === pinned?.key ? null : session.key)}
      onLink={onLink} onResume={onResume} />)
      : <p className="muted small">{sessions.length ? "No sessions match this status." :
        "Find a conversation in the session inbox and link it here."}</p>}
    {matching.length > 4 && <button type="button" className="button text-button" onClick={() => setShowAll(!showAll)}>
      {showAll ? "Show fewer sessions" : "Show all " + matching.length + " sessions"}
    </button>}
  </section>;
}
