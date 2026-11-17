import type { DashboardState } from "./model";
import type { View } from "./WorkspaceLayout";

export function ProjectMetrics({ data, onNavigate }: { data: DashboardState; onNavigate: (view: View, filter?: string) => void }) {
  const inProgress = data.projects.filter((project) => project.status === "In progress").length;
  const toRevisit = data.projects.filter((project) => project.revisit).length;
  const linked = data.sessions.filter((session) => session.project).length;
  return <div className="overview" aria-label="Project summary">
    <Metric symbol="▤" label="Tracked projects" count={data.projects.length} onClick={() => onNavigate("projects")} />
    <Metric symbol="◐" label="In progress" count={inProgress} disabled={!inProgress} onClick={() => onNavigate("projects", "In progress")} />
    <Metric symbol="◷" label="To revisit" count={toRevisit} onClick={() => onNavigate("revisit")} />
    <Metric symbol="⌁" label="Linked sessions" count={linked} onClick={() => onNavigate("inbox", "Linked")} />
  </div>;
}

function Metric({ symbol, label, count, disabled, onClick }: {
  symbol: string; label: string; count: number; disabled?: boolean; onClick: () => void;
}) {
  return <button className="metric" type="button" disabled={disabled} onClick={onClick}>
    <span><i aria-hidden="true">{symbol}</i>{label}</span><strong>{count.toLocaleString()}</strong>
  </button>;
}
