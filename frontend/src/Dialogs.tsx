import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { errorText, sourceNames, type Project, type ProjectContext, type ProjectDraft, type Session } from "./model";

export function Modal({ id, onClose, children }: {
  id: string; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  return <dialog id={id} ref={dialog} aria-labelledby={id + "-title"} onCancel={(event) => {
    event.preventDefault();
    onClose();
  }}>
    {children}
  </dialog>;
}

function DialogTitle({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return <div className="dialog-head">
    <h2 id={id + "-title"}>{title}</h2>
    <button type="button" className="icon-button" data-close="" aria-label="Close" onClick={onClose}>×</button>
  </div>;
}

export function FormDialog({ id, formId, title, submitLabel, onClose, onSubmit, children, extraAction }: {
  id: string; formId: string; title: string; submitLabel: string; onClose: () => void;
  onSubmit: (values: FormData) => Promise<void>; children: ReactNode; extraAction?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(new FormData(event.currentTarget));
      onClose();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }

  return <Modal id={id} onClose={onClose}>
    <form id={formId} onSubmit={submit}>
      <DialogTitle id={id} title={title} onClose={onClose} />
      {children}
      <p className="form-error" role="alert">{error}</p>
      <div className="dialog-actions">
        {extraAction ?? <button type="button" className="button secondary" data-close="" onClick={onClose}>Cancel</button>}
        <button className="button primary" type="submit" disabled={busy}>{submitLabel}</button>
      </div>
    </form>
  </Modal>;
}

export function ProjectEditor({ project, context, statuses, onSave, onClose }: {
  project?: Project; context?: ProjectContext; statuses: string[];
  onSave: (draft: ProjectDraft) => Promise<void>; onClose: () => void;
}) {
  const [revisitLater, setRevisitLater] = useState(project?.revisit_later ?? false);
  return <FormDialog id="project-dialog" formId="project-form" title={project ? "Edit project" : "New project"}
    submitLabel="Save project" onClose={onClose} onSubmit={async (values) => {
      await onSave({
        id: project?.id, sessions: context?.sessions, workspace: context?.workspace,
        name: String(values.get("name")), status: String(values.get("status")),
        area: String(values.get("area")), summary: String(values.get("summary")),
        next: String(values.get("next")), evidence: String(values.get("evidence")),
        revisit_later: revisitLater,
        revisit_on: String(values.get("revisit_on") ?? "") || null,
      });
    }}>
    {context?.label && <p className="muted">{context.label}</p>}
    <label>Project name <input name="name" required maxLength={100} autoFocus defaultValue={project?.name ?? context?.name} /></label>
    <div className="form-pair">
      <label>Area <input name="area" maxLength={70} defaultValue={project?.area} placeholder="e.g. Agent tooling" /></label>
      <label>Status <select name="status" required defaultValue={project?.status ?? "Planned"}>
        {statuses.map((status) => <option key={status}>{status}</option>)}
      </select></label>
    </div>
    <div className="form-checks">
      <label><input type="checkbox" checked={revisitLater}
        onChange={(event) => setRevisitLater(event.target.checked)} /> Revisit later</label>
    </div>
    <label>Revisit date (optional) <input type="date" name="revisit_on" disabled={!revisitLater}
      defaultValue={project?.revisit_on ?? ""} /></label>
    <label>Checkpoint <textarea name="summary" rows={3} maxLength={2400} defaultValue={project?.summary}
      placeholder="What did you last verify?" /></label>
    <label>Next action <textarea name="next" rows={2} maxLength={800} defaultValue={project?.next}
      placeholder="What would you do in the next session?" /></label>
    <label>Evidence <input name="evidence" maxLength={300} defaultValue={project?.evidence} placeholder="A spec, commit, or result" /></label>
  </FormDialog>;
}

export function LinkEditor({ session, projects, onLink, onCreate, onClose }: {
  session: Session; projects: Project[]; onLink: (id: string | null) => Promise<void>;
  onCreate: (context: ProjectContext) => void; onClose: () => void;
}) {
  return <FormDialog id="link-dialog" formId="link-form" title="Link session" submitLabel="Save link"
    onClose={onClose} onSubmit={(values) => onLink(String(values.get("project")) || null)}
    extraAction={
      <button type="button" className="button secondary" onClick={() => onCreate({
        sessions: [session.key], label: "Link " + session.title,
      })}>Create project</button>
    }>
    <p className="muted">{session.title} · {sourceNames[session.source]}</p>
    <label>Project <select name="project" defaultValue={session.project ?? ""}>
      <option value="">Unlinked</option>
      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select></label>
  </FormDialog>;
}

export function CopyDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.select(); }, []);
  return <Modal id="copy-dialog" onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); onClose(); }}>
      <DialogTitle id="copy-dialog" title="Copy text" onClose={onClose} />
      <label>Selected text <textarea id="copy-text" ref={input} rows={7} readOnly autoFocus value={text} /></label>
      <div className="dialog-actions"><button className="button secondary" type="submit">Done</button></div>
    </form>
  </Modal>;
}
