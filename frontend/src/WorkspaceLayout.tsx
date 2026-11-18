import type { ReactNode } from "react";
import type { DashboardState } from "./model";
import { views, type View } from "./navigation";

const pages: Record<View, { label: string; title: string; description: string; symbol: string }> = {
  projects: {
    label: "Projects", title: "AI projects", symbol: "▤",
    description: "Pick up where you left off across Claude Code and Codex.",
  },
  attention: {
    label: "Needs attention", title: "Needs attention", symbol: "!",
    description: "Sessions waiting for input, run failures, and proposals ready for review.",
  },
  revisit: {
    label: "Revisit", title: "Projects to revisit", symbol: "◷",
    description: "Scheduled follow-ups and open projects with 14 days of inactivity.",
  },
  archive: {
    label: "Archive", title: "Archived projects", symbol: "▣",
    description: "Open an archived project to see its history or restore it.",
  },
  inbox: {
    label: "Session inbox", title: "Session inbox", symbol: "▱",
    description: "Find related conversations and bring them into a project.",
  },
  patterns: {
    label: "Agentic Patterns", title: "Agentic Patterns", symbol: "◇",
    description: "Choose a workflow and prepare a kickoff for a project.",
  },
  outbox: {
    label: "Outbox", title: "Outbox", symbol: "⇥",
    description: "Review session results and proposals before they update a project.",
  },
};

interface Props {
  view: View;
  projectPage: boolean;
  attentionCount: number;
  data?: DashboardState;
  refreshing: boolean;
  onNavigate: (view: View) => void;
  onRefresh: () => void;
  onNewProject: () => void;
  children: ReactNode;
}

export function WorkspaceLayout({ view, projectPage, attentionCount, data, refreshing,
  onNavigate, onRefresh, onNewProject, children }: Props) {
  const active = pages[view];
  const stale = data?.projects.filter((project) => project.revisit).length || 0;
  const pending = data?.outbox.filter((run) => Object.values(run.review).includes("pending")).length || 0;
  const scans = data && new Date(data.scanned * 1000).toLocaleTimeString([], {
    hour: "numeric", minute: "2-digit",
  });
  const notes = [
    data?.sources.claude.note && "Claude Code · " + data.sources.claude.note,
    data?.sources.codex.note && "Codex · " + data.sources.codex.note,
  ].filter(Boolean).join(" ");

  return <>
    <a className="skip" href="#main" onClick={(event) => {
      event.preventDefault();
      document.getElementById("main")?.focus();
    }}>Skip to content</a>
    <aside className="sidebar" aria-label="Workspace">
      <div className="brand"><span className="mark" aria-hidden="true"><i /><i /><i /></span>Threadline</div>
      <nav aria-label="Views" className="nav">
        {views.map((key) =>
          <button key={key} type="button" data-view={key} aria-current={view === key ? "page" : undefined}
            onClick={() => onNavigate(key)}>
            <span aria-hidden="true">{pages[key].symbol}</span> {pages[key].label}
            {key === "revisit" && stale > 0 && <small>{stale.toLocaleString()}</small>}
            {key === "attention" && attentionCount > 0 && <small>{attentionCount.toLocaleString()}</small>}
            {key === "outbox" && pending > 0 && <small>{pending.toLocaleString()}</small>}
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
        {!projectPage && <div className="page-heading">
          <div><h1>{active.title}</h1><p>{active.description}</p></div>
          {(view === "projects" || view === "revisit" || view === "inbox") && <button type="button" className="button primary" id="add" disabled={!data} onClick={onNewProject}>
            <span aria-hidden="true">＋</span> New project
          </button>}
        </div>}
        {data?.demo && <p id="demo-note" className="demo-note">Demo workspace · Changes last until you close Threadline.</p>}
        {notes && <div className="data-note">{notes}</div>}
        {children}
      </div>
    </main>
  </>;
}
