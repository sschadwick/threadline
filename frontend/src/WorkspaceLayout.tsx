import type { ReactNode } from "react";
import type { DashboardState } from "./model";

export type View = "projects" | "revisit" | "inbox";

const views: Record<View, { label: string; title: string; description: string; symbol: string }> = {
  projects: {
    label: "Projects", title: "AI projects", symbol: "▤",
    description: "Pick up where you left off across Claude Code and Codex.",
  },
  revisit: {
    label: "Revisit", title: "Projects to revisit", symbol: "◷",
    description: "Open efforts with no recorded activity for at least 14 days.",
  },
  inbox: {
    label: "Session inbox", title: "Session inbox", symbol: "▱",
    description: "Find related conversations and bring them into a project.",
  },
};

interface Props {
  view: View;
  data?: DashboardState;
  refreshing: boolean;
  onNavigate: (view: View) => void;
  onRefresh: () => void;
  onNewProject: () => void;
  children: ReactNode;
}

export function WorkspaceLayout({ view, data, refreshing, onNavigate, onRefresh, onNewProject, children }: Props) {
  const active = views[view];
  const stale = data?.projects.filter((project) => project.revisit).length || 0;
  const scans = data && new Date(data.scanned * 1000).toLocaleTimeString([], {
    hour: "numeric", minute: "2-digit",
  });
  const notes = [
    data?.sources.claude.note && "Claude Code · " + data.sources.claude.note,
    data?.sources.codex.note && "Codex · " + data.sources.codex.note,
  ].filter(Boolean).join(" ");

  return <>
    <a className="skip" href="#main">Skip to projects</a>
    <aside className="sidebar" aria-label="Workspace">
      <div className="brand"><span className="mark" aria-hidden="true"><i /><i /><i /></span>Threadline</div>
      <nav aria-label="Views" className="nav">
        {(Object.keys(views) as View[]).map((key) =>
          <button key={key} type="button" data-view={key} aria-current={view === key ? "page" : undefined}
            onClick={() => onNavigate(key)}>
            <span aria-hidden="true">{views[key].symbol}</span> {views[key].label}
            {key === "revisit" && stale > 0 && <small>{stale.toLocaleString()}</small>}
          </button>,
        )}
      </nav>
      <div className="connections">
        <p>Session sources</p>
        <div><span className="source-dot claude" /> Claude Code <span>{data?.sources.claude.count.toLocaleString() ?? "—"}</span></div>
        <div><span className="source-dot codex" /> Codex <span>{data?.sources.codex.count.toLocaleString() ?? "—"}</span></div>
        <div className="local"><span /> Local workspace</div>
      </div>
    </aside>
    <main id="main" tabIndex={-1}>
      <header className="topbar">
        <span className="breadcrumb">Workspace <span aria-hidden="true">/</span> <strong>{active.label}</strong></span>
        <div className="sync">
          <span id="sync-time">{scans && "Scanned " + scans}</span>
          <button type="button" className="button secondary" id="refresh" disabled={refreshing} onClick={onRefresh}>
            <span aria-hidden="true">↻</span> Refresh
          </button>
        </div>
      </header>
      <div className="page">
        <div className="page-heading">
          <div><h1>{active.title}</h1><p>{active.description}</p></div>
          <button type="button" className="button primary" id="add" disabled={!data} onClick={onNewProject}>
            <span aria-hidden="true">＋</span> New project
          </button>
        </div>
        {data?.demo && <p id="demo-note" className="demo-note">Demo workspace · Changes last until you close Threadline.</p>}
        {notes && <div className="data-note">{notes}</div>}
        {children}
      </div>
    </main>
  </>;
}
