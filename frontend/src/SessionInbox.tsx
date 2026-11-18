import { useState } from "react";
import { ListPanel } from "./ListPanel";
import { SessionCard, type SessionActions } from "./SessionCard";
import { sourceNames, type DashboardState } from "./model";
import { sessionStatus, type SessionStatusFilter } from "./sessionStatus";
import { SessionStatusSelect } from "./SessionStatusFilter";

const filters = ["Unlinked", "Linked", "All sessions"];

interface Props extends SessionActions {
  data: DashboardState;
  initialFilter?: string;
}

export function SessionInbox({ data, initialFilter, onLink, onResume }: Props) {
  const [filter, setFilter] = useState(filters.includes(initialFilter ?? "") ? initialFilter! : "Unlinked");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(40);
  const [status, setStatus] = useState<SessionStatusFilter>("all");
  const query = search.trim().toLowerCase();
  const sessions = data.sessions.filter((session) =>
    (filter === "All sessions" || (filter === "Linked" ? session.project : !session.project)) &&
    (status === "all" || sessionStatus(session) === status) &&
    [session.title, session.cwd, sourceNames[session.source]].some((text) => text.toLowerCase().includes(query)),
  );

  return <div className="layout single">
    <ListPanel title="Local sessions" count={sessions.length} search={search} searchLabel="Search sessions" filters={filters}
      filter={filter} onSearch={(value) => { setSearch(value); setLimit(40); }}
      controls={<SessionStatusSelect value={status}
        onChange={(value) => { setStatus(value); setLimit(40); }} />}
      onFilter={(value) => { setFilter(value); setLimit(40); }}>
      {sessions.length === 0 ? <div className="empty">No sessions match these filters.</div> : <div className="inbox-list">
        {sessions.slice(0, limit).map((session) =>
          <SessionCard key={session.key} session={session} expanded
            projectName={data.projects.find((project) => project.id === session.project)?.name}
            onLink={onLink} onResume={onResume} />,
        )}
        {sessions.length > limit &&
          <button type="button" className="button secondary more" onClick={() => {
            setLimit(limit + 40);
            requestAnimationFrame(() => document.querySelector<HTMLElement>(
              '[data-resume="' + CSS.escape(sessions[limit].key) + '"]',
            )?.focus());
          }}>Show more sessions</button>}
      </div>}
    </ListPanel>
  </div>;
}
