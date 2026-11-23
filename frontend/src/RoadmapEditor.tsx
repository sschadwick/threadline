import { useState, type FormEvent } from "react";
import { errorText, sourceNames, type Milestone, type RoadmapTarget, type Session } from "./model";

export function RoadmapEditor({ target, milestone, item, sessions, onSave, onClose }: {
  target?: RoadmapTarget; milestone?: Milestone; item: boolean; sessions: Session[];
  onSave: (values: object) => Promise<unknown>; onClose: () => void;
}) {
  const workItem = target && "depends_on" in target ? target : undefined;
  const phase = target && "criteria" in target ? target : undefined;
  const [selected, setSelected] = useState(target?.sessions ?? []);
  const [status, setStatus] = useState(workItem?.status ?? "todo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setError("");
    setBusy(true);
    try {
      await onSave({ ...values, sessions: selected, depends_on: values.depends_on || null });
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <form className="roadmap-form" onSubmit={save}>
    <fieldset disabled={busy}>
      <legend>{target ? "Edit" : "New"} {item ? "work item" : "milestone"}</legend>
      <label>Title <input name="title" required maxLength={100} defaultValue={target?.title} /></label>
      <label>{item ? "Deliverable" : "Outcome"} <textarea name="outcome" required maxLength={1000} defaultValue={target?.outcome} /></label>
      {item ? <>
        <label>Status <select name="status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="todo">To do</option><option value="in progress">In progress</option>
          <option value="blocked">Blocked</option><option value="done">Done</option>
        </select></label>
        {status === "blocked" && <label>What will unblock this? <textarea name="blocker" required maxLength={800} defaultValue={workItem?.blocker} /></label>}
        <label>Depends on <select name="depends_on" defaultValue={workItem?.depends_on ?? ""}>
          <option value="">None</option>
          {milestone?.items.filter((candidate) => candidate.id !== target?.id).map((candidate) =>
            <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
        </select></label>
      </> : <>
        <label>Scope <textarea name="scope" maxLength={1600} defaultValue={phase?.scope} /></label>
        <label>Success criteria <textarea name="criteria" required maxLength={1600} defaultValue={phase?.criteria} /></label>
      </>}
      <label>Next action <textarea name="next" maxLength={800} defaultValue={target?.next} /></label>
      <label>Replace this action when <input name="until" maxLength={800} defaultValue={target?.until} /></label>
      {sessions.length > 0 && <details className="analysis-selection">
        <summary>Attach project sessions ({selected.length})</summary>
        {sessions.map((session) => <label key={session.key}>
          <input type="checkbox" checked={selected.includes(session.key)} onChange={(event) => setSelected(
            event.target.checked ? [...selected, session.key] : selected.filter((key) => key !== session.key),
          )} />
          <span>{session.title}<small>{sourceNames[session.source]}</small></span>
        </label>)}
      </details>}
      <div className="workflow-actions">
        <button type="submit" className="button primary">{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
      </div>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
