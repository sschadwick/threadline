import { useState } from "react";
import { api } from "./api";
import { FormDialog } from "./Dialogs";
import { KickoffEvals } from "./KickoffEvals";
import { dateLabel, sourceNames, type ApplyDashboardChange, type Decision, type Project, type Session } from "./model";

type Editor = { kind: "decision"; previous?: Decision } | { kind: "eval"; decision: Decision };

interface Props {
  project: Project;
  sessions: Session[];
  onApply: ApplyDashboardChange;
}

export function DecisionPanel({ project, sessions, onApply }: Props) {
  const [editor, setEditor] = useState<Editor>();
  const superseded = new Set(project.decisions.map((decision) => decision.supersedes));
  const close = () => setEditor(undefined);

  return <>
    <section className="decision-panel" aria-labelledby="decisions-heading">
      <div className="section-heading">
        <h3 id="decisions-heading">Decisions</h3>
        <button className="button secondary" type="button" onClick={() => setEditor({ kind: "decision" })}>Add decision</button>
      </div>
      {project.decisions.length ? <ol className="decision-list">
        {project.decisions.slice().reverse().map((decision) => {
          const retired = superseded.has(decision.id);
          const previous = project.decisions.find((item) => item.id === decision.supersedes);
          return <li key={decision.id}>
            <div className="decision-meta">
              <span>{retired ? "Superseded" : "Active"}</span>
              <time dateTime={decision.accepted_on}>{dateLabel(decision.accepted_on)}</time>
            </div>
            <h4>{decision.choice}</h4>
            <p>{decision.rationale}</p>
            <p className="muted"><strong>Source</strong> {decision.source}</p>
            {previous && <p className="muted"><strong>Supersedes</strong> {previous.choice}</p>}
            {!retired && <div className="decision-actions">
              <button className="button secondary" type="button"
                onClick={() => setEditor({ kind: "decision", previous: decision })}>Supersede</button>
              <button className="button secondary" type="button"
                onClick={() => setEditor({ kind: "eval", decision })}>Save as eval</button>
            </div>}
          </li>;
        })}
      </ol> : <p className="muted small">Record choices you want future sessions to carry forward.</p>}
    </section>
    <KickoffEvals project={project} onApply={onApply} />
    {editor?.kind === "decision" && <FormDialog id="decision-dialog" formId="decision-form"
      title={editor.previous ? "Supersede decision" : "Add decision"} submitLabel="Save decision" onClose={close}
      onSubmit={async (values) => {
        await onApply(api.saveDecision(project.id, {
          choice: String(values.get("choice")),
          rationale: String(values.get("rationale")),
          source: String(values.get("source")),
          source_session: String(values.get("session") ?? "") || null,
          supersedes: editor.previous?.id ?? null,
        }));
      }}>
      {editor.previous && <p className="muted">Supersedes {editor.previous.choice}</p>}
      <label>Choice <textarea name="choice" required rows={2} maxLength={600} autoFocus /></label>
      <label>Rationale <textarea name="rationale" required rows={3} maxLength={1600} /></label>
      <label>Evidence <input name="source" required={!sessions.length} maxLength={500}
        placeholder="A file, link, or other source" /></label>
      {sessions.length > 0 && <label>Linked session <select name="session">
        <option value="">Choose a session</option>
        {sessions.map((session) => <option key={session.key} value={session.key}>
          {sourceNames[session.source]} · {session.title}
        </option>)}
      </select></label>}
    </FormDialog>}
    {editor?.kind === "eval" && <FormDialog id="eval-dialog" formId="eval-form" title="Save decision as an eval"
      submitLabel="Save eval" onClose={close} onSubmit={async (values) => {
        await onApply(api.saveEval(project.id, {
          name: String(values.get("name")), task: String(values.get("task")), decision: editor.decision.id,
        }));
      }}>
      <p className="muted"><strong>Expected choice</strong> {editor.decision.choice}</p>
      <label>Name <input name="name" required maxLength={100} autoFocus /></label>
      <label>Kickoff task <textarea name="task" required rows={3} maxLength={1000}
        placeholder="What should the next session do?" /></label>
      <p className="muted">The eval freezes the current checkpoint, linked context, and decision history.</p>
    </FormDialog>}
  </>;
}
