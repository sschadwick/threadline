import { useState } from "react";
import { ListPanel } from "./ListPanel";
import { projectHref } from "./navigation";
import { ProjectStatus, statusClass } from "./ProjectStatus";
import { shortDate, type DashboardState, type Project } from "./model";

function initials(name: string) {
  return (name.match(/[\p{L}\p{N}]+/gu) || [name]).slice(0, 2)
    .map((part) => [...part][0]).join("").toUpperCase();
}

interface Props {
  data: DashboardState;
  view: "projects" | "revisit" | "archive";
  initialFilter?: string;
}

export function ProjectRegister({ data, view, initialFilter }: Props) {
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState("recent");
  const [filter, setFilter] = useState(initialFilter || "All projects");
  const candidates = data.projects.filter((project) => project.archived === (view === "archive")
    && (view !== "revisit" || project.revisit_state !== null));
  const filters = view === "revisit" ? ["All projects", "Due", "Later"] : ["All projects",
    ...data.statuses.filter((status) => candidates.some((project) => project.status === status)),
  ];
  const activeFilter = filters.includes(filter) ? filter : "All projects";
  const query = search.trim().toLowerCase();
  const matches = candidates.filter((project) =>
    matchesFilter(project, activeFilter) &&
    [project.name, project.area, project.summary, project.next_action.title].some((value) => value.toLowerCase().includes(query)),
  );
  if (order === "oldest") matches.reverse();
  if (order === "name") matches.sort((a, b) => a.name.localeCompare(b.name));
  const noMatches = query || activeFilter !== "All projects" ? "No projects match these filters."
    : { projects: "Create a project or start from a session in the inbox.",
      revisit: "No projects to revisit.", archive: "No archived projects." }[view];

  return <ListPanel title={{ projects: "Project register", revisit: "Revisit queue", archive: "Archive" }[view]} count={matches.length}
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
      {matches.map((project) => <a href={projectHref(project.id)} key={project.id} data-project={project.id} className="project-row">
        <span className="project-cell">
          <span className={"tile " + statusClass[project.status]} aria-hidden="true">{initials(project.name)}</span>
          <span><strong>{project.name}</strong>
            <small>{project.area || "General"} · {project.sessions.length} {project.sessions.length === 1 ? "session" : "sessions"}</small>
            {!project.archived && <small className="roadmap-register-next">Next · {project.next_action.title}</small>}
          </span>
        </span>
        <span><ProjectStatus project={project} /></span>
        <span className="row-date">{shortDate(project.updated)}</span>
        <span className="arrow" aria-hidden="true">›</span>
      </a>)}
    </>}
  </ListPanel>;
}

function matchesFilter(project: Project, filter: string) {
  if (filter === "Due") return project.revisit;
  if (filter === "Later") return project.revisit_state === "later";
  return filter === "All projects" || project.status === filter;
}
