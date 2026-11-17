import { useState } from "react";
import { ListPanel } from "./ListPanel";
import { SessionCard, type SessionActions } from "./SessionCard";
import { sourceNames, type DashboardState, type ProjectContext } from "./model";

const filters = ["Unlinked", "Linked", "All sessions", "Workspaces"];

interface Props extends SessionActions {
  data: DashboardState;
  initialFilter?: string;
  onTrack: (context: ProjectContext) => void;
}

export function SessionInbox({ data, initialFilter, onTrack, onLink, onResume }: Props) {
  const [filter, setFilter] = useState(initialFilter || "Unlinked");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(40);
  const query = search.trim().toLowerCase();
  const workspaces = data.suggestions.filter((group) => group.workspace.toLowerCase().includes(query));
  const sessions = data.sessions.filter((session) =>
    (filter === "All sessions" || (filter === "Linked" ? session.project : !session.project)) &&
    [session.title, session.cwd, sourceNames[session.source]].some((text) => text.toLowerCase().includes(query)),
  );
  const browsingWorkspaces = filter === "Workspaces";
  const count = browsingWorkspaces ? workspaces.length : sessions.length;
  const emptyMessage = browsingWorkspaces
    ? "No matching workspaces with at least two unlinked sessions."
    : "No sessions match these filters.";

  return <div className="layout single">
    <ListPanel title="Local sessions" count={count} search={search} searchLabel="Search sessions" filters={filters}
      filter={filter} onSearch={(value) => { setSearch(value); setLimit(40); }}
      onFilter={(value) => { setFilter(value); setLimit(40); }}>
      {count === 0 ? <div className="empty">{emptyMessage}</div> : <div className="inbox-list">
        {browsingWorkspaces ? workspaces.map((group) =>
          <div className="session-item" key={group.workspace}>
            <div className="session-info">
              <strong>{group.name}</strong>
              <small>{group.sessions.length} sessions · {group.sources.map((source) => sourceNames[source]).join(" + ")}</small>
              <small className="cwd">{group.workspace}</small>
            </div>
            <button className="button secondary" type="button" data-workspace={group.workspace}
              onClick={() => onTrack({ ...group, label: "Link " + group.sessions.length + " sessions from " + group.name })}>
              Track workspace
            </button>
          </div>,
        ) : sessions.slice(0, limit).map((session) =>
          <SessionCard key={session.key} session={session} expanded
            projectName={data.projects.find((project) => project.id === session.project)?.name}
            onLink={onLink} onResume={onResume} />,
        )}
        {!browsingWorkspaces && sessions.length > limit &&
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
