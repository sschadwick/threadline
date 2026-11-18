import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { FormDialog } from "./Dialogs";
import { errorText, sourceNames, type Project, type ProjectContext, type ProjectDraft,
  type ProjectFields, type Session, type SessionSource } from "./model";

export function ProjectEditor({ project, context, statuses, sessions, providers, onSave, onClose }: {
  project?: Project; context?: ProjectContext; statuses: string[]; sessions: Session[]; providers: SessionSource[];
  onSave: (draft: ProjectDraft) => Promise<void>; onClose: () => void;
}) {
  const [revisitLater, setRevisitLater] = useState(project?.revisit_later ?? false);
  const [selected, setSelected] = useState(context?.sessions ?? []);
  const [fields, setFields] = useState<ProjectFields>({
    name: project?.name ?? context?.name ?? "", area: project?.area ?? "", status: project?.status ?? "Planned",
    summary: project?.summary ?? "", next: project?.next ?? "", evidence: project?.evidence ?? "",
  });
  const [provider, setProvider] = useState<SessionSource>(providers.includes("codex") ? "codex" : providers[0] ?? "codex");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const dirty = useRef(new Set<keyof ProjectFields>());
  const pending = useRef<AbortController | undefined>(undefined);

  function change(key: keyof ProjectFields, value: string) {
    dirty.current.add(key);
    setFields((previous) => ({ ...previous, [key]: value }));
  }

  async function generate() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setDrafting(true);
    setDraftError("");
    setDraftReady(false);
    try {
      const result = await api.draftProject({ provider, suggestion: context?.suggestion,
        sessions: selected, fields }, controller.signal);
      if (!controller.signal.aborted) {
        setFields((previous) => ({ ...previous, ...Object.fromEntries(
          Object.entries(result).filter(([key]) => !dirty.current.has(key as keyof ProjectFields)),
        ) }));
        setDraftReady(true);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setDraftError(errorText(failure));
    } finally {
      if (!controller.signal.aborted) setDrafting(false);
      if (pending.current === controller) pending.current = undefined;
    }
  }

  useEffect(() => () => pending.current?.abort(), []);

  return <FormDialog id="project-dialog" formId="project-form" title={project ? "Edit project" : context?.suggestion ? "Track suggested project" : "New project"}
    submitLabel={context?.suggestion ? "Track project" : "Save project"} submitDisabled={drafting}
    onClose={onClose} onSubmit={async (values) => {
      if (context?.suggestion && !selected.length) throw new Error("Select at least one session to link.");
      await onSave({ ...fields, id: project?.id, sessions: selected, workspace: context?.workspace,
        suggestion: context?.suggestion, revisit_later: revisitLater,
        revisit_on: String(values.get("revisit_on") ?? "") || null });
    }}>
    {context?.label && <p className="muted">{context.label}</p>}
    {!project && providers.length > 0 && <section className="project-ai" aria-label="AI project draft" aria-busy={drafting}>
      <div className="workflow-actions">
        <label>Draft with <select aria-label="AI draft provider" value={provider} disabled={drafting}
          onChange={(event) => setProvider(event.target.value as SessionSource)}>
          {providers.map((value) => <option key={value} value={value}>{sourceNames[value]}</option>)}
        </select></label>
        <button type="button" className="button secondary" disabled={drafting || (!fields.name.trim() && !fields.summary.trim() && !selected.length)}
          onClick={() => void generate()}>{drafting ? "Drafting…" : draftReady ? "Regenerate draft" : "Generate draft"}</button>
      </div>
      <p className="muted">Sends selected session titles, project notes, and a bounded README and commit summary to the chosen provider.</p>
      <p role="status">{drafting ? "Generating editable project details…" : draftReady ? "Draft ready. Review before saving; your edits are preserved." : ""}</p>
      {draftError && <p className="form-error" role="alert">{draftError}</p>}
    </section>}
    {context && sessions.length > 0 && <fieldset className="suggestion-sessions" disabled={drafting}><legend>Sessions to link</legend>
      {sessions.map((session) => <label key={session.key}><input type="checkbox" checked={selected.includes(session.key)}
        onChange={(event) => setSelected(event.target.checked ? [...selected, session.key]
          : selected.filter((key) => key !== session.key))} />
        <span>{session.title}<small>{sourceNames[session.source]} · {session.cwd}</small></span>
      </label>)}
    </fieldset>}
    <label>Project name <input name="name" required maxLength={100} autoFocus value={fields.name}
      onChange={(event) => change("name", event.target.value)} /></label>
    <div className="form-pair">
      <label>Area <input name="area" maxLength={70} value={fields.area} placeholder="e.g. Agent tooling"
        onChange={(event) => change("area", event.target.value)} /></label>
      <label>Status <select name="status" required value={fields.status} onChange={(event) => change("status", event.target.value)}>
        {statuses.map((status) => <option key={status}>{status}</option>)}
      </select></label>
    </div>
    <div className="form-checks">
      <label><input type="checkbox" checked={revisitLater}
        onChange={(event) => setRevisitLater(event.target.checked)} /> Revisit later</label>
    </div>
    <label>Revisit date (optional) <input type="date" name="revisit_on" disabled={!revisitLater}
      defaultValue={project?.revisit_on ?? ""} /></label>
    <label>Checkpoint <textarea name="summary" rows={3} maxLength={2400} value={fields.summary}
      onChange={(event) => change("summary", event.target.value)} placeholder="What did you last verify?" /></label>
    <label>Next action <textarea name="next" rows={2} maxLength={800} value={fields.next}
      onChange={(event) => change("next", event.target.value)} placeholder="What would you do in the next session?" /></label>
    <label>Evidence <input name="evidence" maxLength={300} value={fields.evidence}
      onChange={(event) => change("evidence", event.target.value)} placeholder="A spec, commit, or result" /></label>
  </FormDialog>;
}
