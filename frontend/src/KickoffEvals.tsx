import { useState } from "react";
import { api } from "./api";
import { errorText, type ApplyDashboardChange, type KickoffEval, type Project } from "./model";

export function KickoffEvals({ project, onApply }: { project: Project; onApply: ApplyDashboardChange }) {
  const [replaying, setReplaying] = useState<string>();
  const [error, setError] = useState("");

  async function replay(evalId: string) {
    setReplaying(evalId);
    setError("");
    try {
      await onApply(api.replay(project.id, evalId));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setReplaying(undefined);
    }
  }

  return <section className="decision-panel" aria-labelledby="evals-heading">
    <div className="section-heading"><h2 id="evals-heading">Evals</h2></div>
    {project.evals.length ? <ul className="decision-list">
      {project.evals.map((item) => <li key={item.id}>
        <h3>{item.name}</h3>
        <p>{item.task}</p>
        <div className="decision-actions">
          <button className="button secondary" type="button" disabled={Boolean(replaying)}
            onClick={() => void replay(item.id)}>{replaying === item.id ? "Replaying…" : "Replay kickoff"}</button>
          {item.runs > 0 && <span className="muted">{item.runs} {item.runs === 1 ? "run" : "runs"}</span>}
        </div>
        <div aria-live="polite">{item.last_result && <EvalResult result={item.last_result} />}</div>
      </li>)}
    </ul> : <p className="muted small">Save an active decision as an eval to check what a kickoff carries forward.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

function EvalResult({ result }: { result: NonNullable<KickoffEval["last_result"]> }) {
  return <div className="eval-result">
    <strong className={result.passed ? "eval-pass" : "eval-fail"}>{result.passed ? "Passed" : "Failed"}</strong>
    <ul>{result.assertions.map((assertion) =>
      <li key={assertion.name}>{assertion.passed ? "Pass" : "Fail"} · {assertion.name}</li>,
    )}</ul>
    <details>
      <summary>Revisions and rendered brief</summary>
      <p>Expected <code>{result.expected}</code></p>
      <p>Actual {result.actual.length ? result.actual.map((id) => <code key={id}>{id} </code>) : "None"}</p>
      <pre>{result.brief}</pre>
    </details>
  </div>;
}
