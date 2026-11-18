import { useState } from "react";
import { api } from "./api";
import { errorText, sourceNames, type ApplyDashboardChange, type Project, type Session,
  type SessionEvidence, type SessionSource } from "./model";
import { SessionProposals } from "./SessionProposals";

export function SessionAnalysis({ project, sessions, providers, onApply }: {
  project: Project; sessions: Session[]; providers: SessionSource[]; onApply: ApplyDashboardChange;
}) {
  const [selected, setSelected] = useState(sessions.slice(0, 6).map((session) => session.key));
  const [provider, setProvider] = useState<SessionSource>(providers.includes("codex") ? "codex" : providers[0] ?? "codex");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [evidence, setEvidence] = useState<SessionEvidence>();
  const valid = selected.filter((key) => sessions.some((session) => session.key === key));

  async function run(action: "preview" | "analyze") {
    if (busy) return;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      if (action === "preview") setEvidence(await api.sessionEvidence(project.id, valid));
      else await onApply(api.analyzeSessions(project.id, provider, valid));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy("");
    }
  }

  return <section className="session-analysis decision-panel" aria-labelledby="session-analysis-heading">
    <div className="section-heading"><h2 id="session-analysis-heading">Decisions and evals from sessions</h2></div>
    <p className="muted small">Analyze selected session dialogue to propose decisions and kickoff evals. Review before saving.</p>
    {!project.archived && sessions.length > 0 && <>
      <details className="analysis-selection"><summary>Choose sessions ({valid.length}/6)</summary>
        <fieldset disabled={Boolean(busy)}><legend>Linked sessions to analyze</legend>
          {sessions.map((session) => <label key={session.key}>
            <input type="checkbox" checked={valid.includes(session.key)}
              disabled={!valid.includes(session.key) && valid.length >= 6}
              onChange={(event) => {
                setSelected(event.target.checked ? [...valid, session.key] : valid.filter((key) => key !== session.key));
                setEvidence(undefined);
              }} />
            <span>{session.title}<small>{sourceNames[session.source]}</small></span>
          </label>)}
        </fieldset>
      </details>
      <div className="workflow-actions">
        {providers.length > 0 && <label>Provider <select aria-label="Session analysis provider" value={provider} disabled={Boolean(busy)}
          onChange={(event) => setProvider(event.target.value as SessionSource)}>
          {providers.map((item) => <option key={item} value={item}>{sourceNames[item]}</option>)}
        </select></label>}
        <button className="button secondary" type="button" disabled={Boolean(busy) || !valid.length}
          onClick={() => void run("preview")}>Preview excerpts</button>
        <button className="button primary" type="button" disabled={Boolean(busy) || !valid.length || !providers.length}
          onClick={() => void run("analyze")}>{busy === "analyze" ? "Analyzing…" : "Analyze sessions"}</button>
      </div>
      <p className="muted small">Only Analyze sessions uses model tokens. It sends sampled user/assistant messages to the chosen provider, up to 48,000 characters from six sessions. Tool outputs and common credential patterns are excluded or redacted; review excerpts for sensitive content.</p>
      {!providers.length && <p className="muted small">Enable a Codex or Claude Code runner to analyze sessions.</p>}
    </>}
    {!sessions.length && <p className="muted small">Link sessions to this project to analyze their decisions.</p>}
    {project.archived && <p className="muted small">Restore the project before analyzing or applying proposals.</p>}
    {evidence && <details className="analysis-evidence" open><summary>Excerpts to review · no model call</summary>
      {evidence.coverage.map((item) => <p key={item.session} className="muted small">{item.title}: {item.excerpts} excerpts. {item.note}</p>)}
      {evidence.excerpts.map((item) => <blockquote key={item.reference}><small>{item.role} · {item.reference}</small><p>{item.text}</p></blockquote>)}
    </details>}
    <p role="status" className="small">{busy === "preview" ? "Reading local session excerpts…" : busy === "analyze" ? "Analyzing selected dialogue…" : notice}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {project.session_review && <SessionProposals key={project.session_review.id} project={project}
      review={project.session_review} disabled={Boolean(busy) || project.archived} onApply={onApply}
      onSaved={() => setNotice("Selected decisions and evals saved. Evals have not been run.")} />}
  </section>;
}
