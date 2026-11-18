import { useState } from "react";
import { api } from "./api";
import { ListPanel } from "./ListPanel";
import { errorText, shortDate, sourceNames, type ApplyDashboardChange, type DashboardState,
  type ProjectContext, type ProjectSuggestion, type Session } from "./model";

export function SuggestedProjects({ data, onTrack, onApply }: {
  data: DashboardState; onTrack: (context: ProjectContext) => void; onApply: ApplyDashboardChange;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Suggested");
  const query = search.trim().toLowerCase();
  const sessions = new Map(data.sessions.map((session) => [session.key, session]));
  const suggestions = data.suggestions.filter((group) => group.dismissed === (filter === "Dismissed") &&
    [group.name, group.workspace, ...group.sessions.map((key) => sessions.get(key)?.title ?? "")]
      .some((text) => text.toLowerCase().includes(query)));

  return <div className="layout single">
    <ListPanel title="Projects to review" count={suggestions.length} search={search} searchLabel="Search suggestions"
      filters={["Suggested", "Dismissed"]} filter={filter} onSearch={setSearch} onFilter={setFilter}>
      {suggestions.length ? <div className="suggestions-list">
        {suggestions.map((group) => <Suggestion key={group.id} group={group}
          sessions={group.sessions.flatMap((key) => sessions.has(key) ? [sessions.get(key)!] : [])}
          onTrack={onTrack} onApply={onApply} />)}
      </div> : <p className="empty">{query ? "No suggestions match your search." : filter === "Dismissed"
        ? "No dismissed suggestions." : "No suggested projects. Refresh after working in a new project, or create one from the session inbox."}</p>}
    </ListPanel>
  </div>;
}

function Suggestion({ group, sessions, onTrack, onApply }: {
  group: ProjectSuggestion; sessions: Session[]; onTrack: (context: ProjectContext) => void;
  onApply: ApplyDashboardChange;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function review() {
    setBusy(true);
    setError("");
    try {
      await onApply(api.reviewSuggestion(group.id, !group.dismissed));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return <article className="suggestion-item" aria-label={group.name}>
    <h3>{group.name}</h3>
    <p className="muted">{group.reason} · {group.sources.map((source) => sourceNames[source]).join(" + ")} · {shortDate(group.updated)}</p>
    <p className="cwd">{group.workspace}</p>
    <details>
      <summary>Review {sessions.length} {sessions.length === 1 ? "session" : "sessions"}</summary>
      <ul>{sessions.map((session) => <li key={session.key}>
        <strong>{session.title}</strong>
        <small>{sourceNames[session.source]} · {shortDate(session.updated)}</small>
        <small className="cwd">{session.cwd}</small>
      </li>)}</ul>
    </details>
    <div className="workflow-actions">
      {!group.dismissed && <button type="button" className="button primary" disabled={busy}
        onClick={() => onTrack({ name: group.name, suggestion: group.id, sessions: group.sessions,
          label: "Review the project name and select the sessions to link before tracking." })}>Track project</button>}
      <button type="button" className="button secondary" disabled={busy} onClick={() => void review()}>
        {group.dismissed ? "Restore suggestion" : "Dismiss"}
      </button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </article>;
}
