import type { Project } from "./model";

export const statusClass: Record<string, string> = {
  "In progress": "progress", "In production": "production", Prototype: "prototype",
  Planned: "planned", Blocked: "blocked", Parked: "parked", Completed: "completed",
};

export function ProjectStatus({ project }: { project: Project }) {
  return <>
    <span className={"status " + statusClass[project.status]}><i />{project.status}</span>
    <RevisitMark project={project} />
  </>;
}

export function RevisitMark({ project }: { project: Project }) {
  const label = project.revisit_state && { later: "Revisit later", due: "Revisit due", inactive: "Revisit" }[project.revisit_state];
  return label && <span className="revisit-mark">{label}</span>;
}
