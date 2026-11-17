import { useState } from "react";
import { ListPanel } from "./ListPanel";
import { ProjectDetails, ProjectStatus, statusClass } from "./ProjectDetails";
import type { SessionActions } from "./SessionCard";
import { shortDate, type ApplyDashboardChange, type DashboardState, type Project } from "./model";

function initials(name: string) {
  return (name.match(/[\p{L}\p{N}]+/gu) || [name]).slice(0, 2)
    .map((part) => [...part][0]).join("").toUpperCase();
}

interface Props extends SessionActions {
  data: DashboardState;
  revisit?: boolean;
  initialFilter?: string;
  initialProject?: string;
  onEdit: (project: Project) => void;
  onCopy: (content: string, confirmation: string) => void;
  onKickoff: (project: string) => void;
  onApply: ApplyDashboardChange;
}

export function ProjectRegister({ data, revisit, initialFilter, initialProject, onEdit, onCopy, onKickoff, onApply, onLink, onResume }: Props) {
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState("recent");
  const [filter, setFilter] = useState(initialFilter || "All projects");
  const [selectedId, setSelectedId] = useState(initialProject);
  const candidates = revisit ? data.projects.filter((project) => project.revisit_state !== null) : data.projects;
  const filters = revisit ? ["All projects", "Due", "Later"] : ["All projects",
    ...(candidates.some((project) => project.in_production) ? ["In production"] : []),
    ...data.statuses.filter((status) => candidates.some((project) => project.status === status)),
  ];
  const activeFilter = filters.includes(filter) ? filter : "All projects";
  const query = search.trim().toLowerCase();
  const matches = candidates.filter((project) =>
    matchesFilter(project, activeFilter) &&
    [project.name, project.area, project.summary, project.next].some((value) => value.toLowerCase().includes(query)),
  );
  if (order === "oldest") matches.reverse();
  if (order === "name") matches.sort((a, b) => a.name.localeCompare(b.name));
  const selected = matches.find((project) => project.id === selectedId) ?? matches[0];
  const sessionsByKey = new Map(data.sessions.map((session) => [session.key, session]));
  const selectedSessions = (selected?.sessions ?? []).flatMap((key) => {
    const session = sessionsByKey.get(key);
    return session ? [session] : [];
  });
  const noMatches = query || activeFilter !== "All projects" ? "No projects match these filters."
    : revisit ? "No projects to revisit." : "Create a project or start from a session in the inbox.";

  return <>
    <div className="layout">
      <ListPanel title={revisit ? "Revisit queue" : "Project register"} count={matches.length}
        search={search} searchLabel="Search projects" filters={filters} filter={activeFilter}
        onSearch={setSearch} onFilter={setFilter} controls={
          <select id="sort" aria-label="Project order" value={order} onChange={(event) => setOrder(event.target.value)}>
            <option value="recent">Last active</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
          </select>
        }>
        {matches.length === 0 ? <div className="empty">{noMatches}</div> : <>
          <div className="table-head"><span>Project</span><span>Status</span><span>Last active</span><span /></div>
          {matches.map((project) => <button type="button" key={project.id} data-project={project.id}
            className="project-row" aria-pressed={selected?.id === project.id} onClick={() => {
              setSelectedId(project.id);
              if (window.matchMedia("(max-width: 1030px)").matches) {
                requestAnimationFrame(() => document.getElementById("detail-heading")?.focus());
              }
            }}>
            <span className="project-cell">
              <span className={"tile " + statusClass[project.status]} aria-hidden="true">{initials(project.name)}</span>
              <span><strong>{project.name}</strong>
                <small>{project.area || "General"} · {project.sessions.length} {project.sessions.length === 1 ? "session" : "sessions"}</small>
              </span>
            </span>
            <span><ProjectStatus project={project} /></span>
            <span className="row-date">{shortDate(project.updated)}</span>
            <span className="arrow" aria-hidden="true">›</span>
          </button>)}
        </>}
      </ListPanel>
      <aside id="detail" className="panel detail" aria-label="Project details">
        {selected ? <ProjectDetails key={selected.id} project={selected} sessions={selectedSessions}
          onEdit={onEdit} onCopy={onCopy} onKickoff={onKickoff} onApply={onApply} onLink={onLink} onResume={onResume} /> :
          <div className="empty">Select a project to view its checkpoint.</div>}
      </aside>
    </div>
  </>;
}

function matchesFilter(project: Project, filter: string) {
  if (filter === "Due") return project.revisit;
  if (filter === "Later") return project.revisit_state === "later";
  if (filter === "In production") return project.in_production;
  return filter === "All projects" || project.status === filter;
}
