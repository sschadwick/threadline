import { useState, type FormEvent } from "react";
import { api } from "./api";
import { dateLabel, errorText, sourceNames, type ApplyDashboardChange, type ProgressReview, type RoadmapTarget,
  type Session, type SessionEvidence, type SessionSource } from "./model";
import { SessionCitations } from "./SessionCitations";

export function ProgressHistory({ target, sessions, onResume }: {
  target: RoadmapTarget; sessions: Session[]; onResume: (session: Session) => void;
}) {
  return <>
    {target.sessions.map((key) => {
      const session = sessions.find((row) => row.key === key);
      return session ? <div key={key} className="roadmap-session">
        <button type="button" className="button secondary" onClick={() => onResume(session)}>Copy resume command</button>
        <span>{session.title} · {sourceNames[session.source]}</span>
      </div> : <p className="small muted" key={key}>Session unavailable · {key}</p>;
    })}
    {target.updates.length > 0 && <details className="roadmap-history" open>
      <summary>Progress history ({target.updates.length})</summary>
      <ol className="outbox-list">
        {[...target.updates].reverse().map((update) => <li key={update.id}>
          <p>{update.summary}</p>
          <p className="small muted">{dateLabel(update.date)} · {update.source}
            {update.completion_criteria && " · Completion evidence"}</p>
          {update.changes.status && <p className="small">Status: {update.changes.status}{update.changes.blocker && " · " + update.changes.blocker}</p>}
          {update.changes.next !== undefined && <p className="small">Next: {update.changes.next || "Cleared"}</p>}
          {update.session && <p className="small">{sessions.find((row) => row.key === update.session)?.title ?? update.session}</p>}
          {update.artifact && <p className="small">
            <a href={update.artifact.url} target="_blank" rel="noreferrer">{update.artifact.label || update.artifact.url}</a>
            {update.artifact.revision && <> · <code>{update.artifact.revision}</code></>}
            {update.artifact.environment && " · " + update.artifact.environment}
          </p>}
          {!!update.citations.length && <SessionCitations citations={update.citations} />}
        </li>)}
      </ol>
    </details>}
  </>;
}

export function ProgressEditor({ target, review, sessions, onSave, onClose }: {
  target: RoadmapTarget; review?: ProgressReview; sessions: Session[];
  onSave: (values: object) => Promise<unknown>; onClose?: () => void;
}) {
  const [next, setNext] = useState(Boolean(review?.next));
  const [status, setStatus] = useState(review?.status ?? "");
  const [applyStatus, setApplyStatus] = useState(Boolean(review?.status));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      await onSave({ ...values, session: values.session || null, completion: values.completion === "on" });
      onClose?.();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <form className="roadmap-form" onSubmit={save}>
    <fieldset disabled={busy || review?.stale}>
      <legend>{review ? "Accept progress" : "Record progress"}</legend>
      <label>What changed? <textarea name="summary" required maxLength={1600} defaultValue={review?.summary} /></label>
      <label className="roadmap-check"><input type="checkbox" checked={next} onChange={(event) => setNext(event.target.checked)} /> Update next action</label>
      {next && <>
        <label>Next action <textarea name="next" maxLength={800} defaultValue={review?.next || target.next} /></label>
        <label>Replace this action when <input name="until" maxLength={800} defaultValue={review?.until || target.until} /></label>
      </>}
      {"depends_on" in target && <>
        <label className="roadmap-check"><input type="checkbox" checked={applyStatus}
          onChange={(event) => setApplyStatus(event.target.checked)} /> Update status</label>
        {applyStatus && <>
          <label>Status <select name="status" value={status || target.status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="todo">To do</option><option value="in progress">In progress</option>
            <option value="blocked">Blocked</option><option value="done">Done</option>
          </select></label>
          {(status || target.status) === "blocked" && <label>What will unblock this?
            <textarea name="blocker" required maxLength={800} defaultValue={review?.blocker || target.blocker} />
          </label>}
        </>}
      </>}
      {sessions.length > 0 && <label>Session evidence <select name="session">
        <option value="">None</option>
        {sessions.map((session) => <option key={session.key} value={session.key}>{session.title}</option>)}
      </select></label>}
      <details className="analysis-selection"><summary>Add artifact evidence</summary>
        <label>URL <input name="url" type="url" maxLength={2000} /></label>
        <label>Label <input name="label" maxLength={120} /></label>
        <label>Revision <input name="artifact_revision" maxLength={120} /></label>
        <label>Environment <input name="environment" maxLength={120} /></label>
      </details>
      {"criteria" in target && <label className="roadmap-check">
        <input type="checkbox" name="completion" /> This evidence meets the milestone’s success criteria
      </label>}
      <div className="workflow-actions">
        <button type="submit" className="button primary">{busy ? "Saving…" : review ? "Accept update" : "Save update"}</button>
        {onClose && <button type="button" className="button secondary" onClick={onClose}>Cancel</button>}
      </div>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

export function DraftProgress({ project, location, sessions, providers, onApply }: {
  project: string; location: object; sessions: Session[]; providers: SessionSource[]; onApply: ApplyDashboardChange;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [provider, setProvider] = useState(providers[0]);
  const [evidence, setEvidence] = useState<SessionEvidence>();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const valid = selected.filter((key) => sessions.some((session) => session.key === key));
  const choice = providers.includes(provider) ? provider : providers[0];

  async function run(action: "preview" | "analyze") {
    setBusy(action);
    setError("");
    setMessage("");
    try {
      if (action === "preview") setEvidence(await api.sessionEvidence(project, valid));
      else {
        const result = await onApply(api.analyzeProgress(project, { ...location, sessions: valid, provider: choice }));
        setMessage(result.progressNotice ?? "Draft ready for review.");
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy("");
    }
  }

  return <details className="analysis-selection roadmap-draft">
    <summary>Draft progress from sessions</summary>
    {sessions.length ? <fieldset disabled={Boolean(busy)}>
      <legend>Choose up to six linked sessions</legend>
      {sessions.map((session) => <label key={session.key} className="roadmap-check">
        <input type="checkbox" checked={valid.includes(session.key)} disabled={!valid.includes(session.key) && valid.length >= 6}
          onChange={(event) => {
            setSelected(event.target.checked ? [...valid, session.key] : valid.filter((key) => key !== session.key));
            setEvidence(undefined);
          }} />
        <span>{session.title} · {sourceNames[session.source]}</span>
      </label>)}
      {providers.length > 0 && <label>Provider <select value={choice} onChange={(event) => setProvider(event.target.value as SessionSource)}>
        {providers.map((name) => <option key={name} value={name}>{sourceNames[name]}</option>)}
      </select></label>}
      <p className="small muted">Preview reads local excerpts. Draft sends the sampled dialogue to the selected provider.</p>
      <div className="workflow-actions">
        <button type="button" className="button secondary" disabled={!valid.length}
          onClick={() => void run("preview")}>Preview excerpts</button>
        <button type="button" className="button primary" disabled={!valid.length || !choice}
          onClick={() => void run("analyze")}>Draft update</button>
      </div>
      {!choice && <p className="small muted">Enable a provider to draft progress.</p>}
    </fieldset> : <p className="small muted">Link sessions to this project to draft progress.</p>}
    {evidence && <details className="analysis-evidence" open><summary>Sampled excerpts</summary>
      {evidence.coverage.map((row) => <p key={row.session} className="small muted">{row.title} · {row.excerpts} excerpts. {row.note}</p>)}
      {evidence.excerpts.map((row) => <blockquote key={row.reference}><small>{row.role} · {row.reference}</small><p>{row.text}</p></blockquote>)}
    </details>}
    <p role="status" className="small">{busy ? (busy === "preview" ? "Reading excerpts…" : "Drafting progress…") : message}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
  </details>;
}
