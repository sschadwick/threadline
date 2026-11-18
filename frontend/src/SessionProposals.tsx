import { useState } from "react";
import { api } from "./api";
import { errorText, type ApplyDashboardChange, type Project, type SessionReview } from "./model";
import { SessionCitations } from "./SessionCitations";

export function SessionProposals({ project, review, disabled, onApply, onSaved }: {
  project: Project; review: SessionReview; disabled: boolean; onApply: ApplyDashboardChange; onSaved: () => void;
}) {
  const [decisions, setDecisions] = useState<string[]>([]);
  const [evals, setEvals] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choices = new Map([...project.decisions, ...review.decisions].map((item) => [item.id, item.choice]));
  const blocked = disabled || busy;

  async function apply(dismiss = false) {
    setBusy(true);
    setError("");
    try {
      await onApply(dismiss ? api.dismissSessionReview(project.id, review.id)
        : api.applySessionReview(project.id, review.id, decisions, evals));
      if (!dismiss) onSaved();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <div className="session-proposals">
    <h3>Review agent proposals</h3>
    <p className="muted small">Proposals are saved as drafts across restarts. Only selected items enter Decisions and Evals.</p>
    {review.stale && <p className="form-error" role="alert">The project or its linked sessions changed. Analyze again before applying these proposals.</p>}
    {review.notes && <p className="small">{review.notes}</p>}
    <details><summary>Session coverage</summary>
      {review.coverage.map((item) => <p className="muted small" key={item.session}>{item.title}: {item.excerpts} excerpts. {item.note}</p>)}
    </details>
    {review.decisions.length + review.evals.length > 0 ? <>
      <button className="button secondary" type="button" disabled={blocked || review.stale} onClick={() => {
        setDecisions(review.decisions.map((item) => item.id));
        setEvals(review.evals.map((item) => item.id));
      }}>Select all proposals</button>
      <ul className="decision-list">
        {review.decisions.map((item) => <li key={item.id}>
          <label className="proposal-choice"><input type="checkbox" checked={decisions.includes(item.id)} disabled={blocked || review.stale}
            onChange={(event) => {
              setDecisions(event.target.checked ? [...decisions, item.id] : decisions.filter((id) => id !== item.id));
              if (!event.target.checked) setEvals(evals.filter((id) => review.evals.find((entry) => entry.id === id)?.decision !== item.id));
            }} /><span><strong>Decision</strong> · {item.choice}</span></label>
          <p>{item.rationale}</p>
          {item.supersedes && <p className="muted">Supersedes: {choices.get(item.supersedes)}</p>}
          <SessionCitations citations={item.citations} />
        </li>)}
        {review.evals.map((item) => <li key={item.id}>
          <label className="proposal-choice"><input type="checkbox" checked={evals.includes(item.id)} disabled={blocked || review.stale}
            onChange={(event) => {
              setEvals(event.target.checked ? [...evals, item.id] : evals.filter((id) => id !== item.id));
              if (event.target.checked && review.decisions.some((decision) => decision.id === item.decision)) {
                setDecisions([...new Set([...decisions, item.decision])]);
              }
            }} /><span><strong>Eval · not run</strong> · {item.name}</span></label>
          <p>{item.task}</p><p className="muted">Expected decision: {choices.get(item.decision)}</p>
        </li>)}
      </ul>
    </> : <p className="muted small">No new supported proposals were found in the sampled dialogue.</p>}
    <div className="workflow-actions">
      <button className="button primary" type="button" disabled={blocked || review.stale || !decisions.length && !evals.length}
        onClick={() => void apply()}>Save selected proposals ({decisions.length + evals.length})</button>
      <button className="button secondary" type="button" disabled={blocked} onClick={() => void apply(true)}>Dismiss proposals</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
