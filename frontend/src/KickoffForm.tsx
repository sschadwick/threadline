import { useState, type FormEvent } from "react";
import { api } from "./api";
import { errorText, sourceNames, type ApplyDashboardChange, type DashboardState,
  type KickoffDraft, type KickoffPreview } from "./model";

interface Props {
  data: DashboardState;
  pattern: string;
  initialProject?: string;
  onApply: ApplyDashboardChange;
  onCopy: (text: string, confirmation: string) => void;
  onLaunch: () => void;
}

export function KickoffForm({ data, pattern, initialProject, onApply, onCopy, onLaunch }: Props) {
  const activeProjects = data.projects.filter((project) => !project.archived);
  const [draft, setDraft] = useState<Omit<KickoffDraft, "pattern">>({
    project: activeProjects.find((project) => project.id === initialProject)?.id ?? activeProjects[0]?.id ?? "",
    workspace: "", provider: "", task: "", criteria: "",
  });
  const [preview, setPreview] = useState<{ draft: KickoffDraft; result: KickoffPreview }>();
  const [pending, setPending] = useState<"preview" | "launch">();
  const [error, setError] = useState("");
  const project = activeProjects.find((item) => item.id === draft.project);
  const workspaces = draft.provider ? data.runner.workspaces
    : [...new Set([...(project?.workspaces ?? []), ...data.runner.workspaces])];
  const ready = preview?.draft.pattern === pattern ? preview : undefined;
  const running = data.outbox.some((run) => run.status === "running");

  function change(fields: Partial<typeof draft>) {
    setDraft((previous) => ({ ...previous, ...fields }));
    setPreview(undefined);
    setError("");
  }

  async function buildPreview(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending("preview");
    setError("");
    setPreview(undefined);
    const input = { ...draft, pattern };
    try {
      const result = await api.previewKickoff(input);
      setPreview({ draft: input, result });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(undefined);
    }
  }

  async function launch() {
    if (!ready || pending || running) return;
    setPending("launch");
    setError("");
    try {
      await onApply(api.launch(ready.draft, ready.result));
      onLaunch();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(undefined);
    }
  }

  return <section className="panel workflow-panel" aria-labelledby="kickoff-heading">
    <h2 id="kickoff-heading">Prepare kickoff</h2>
    {activeProjects.length ? <>
      <form className="kickoff-form" onSubmit={buildPreview}>
        <fieldset disabled={Boolean(pending)}>
          <label>Project <select required value={draft.project}
            onChange={(event) => change({ project: event.target.value, workspace: "" })}>
            {activeProjects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
          <label>Session <select value={draft.provider} onChange={(event) => change({
            provider: event.target.value as KickoffDraft["provider"], workspace: "",
          })}>
            <option value="">Copy for a manual session</option>
            {data.runner.providers.map((provider) => <option key={provider} value={provider}>
              {sourceNames[provider]} on this host
            </option>)}
          </select></label>
          {draft.provider && <p className="muted">Starts one read-only session using the host’s CLI model. The kickoff describes the other roles.</p>}
          {workspaces.length > 0 && <label>Workspace <select required={Boolean(draft.provider)} value={draft.workspace}
            onChange={(event) => change({ workspace: event.target.value })}>
            <option value="">{draft.provider ? "Choose an enrolled workspace" : "Choose a workspace (optional)"}</option>
            {workspaces.map((workspace) => <option key={workspace}>{workspace}</option>)}
          </select></label>}
          <label>Task <textarea rows={3} required maxLength={1000} value={draft.task}
            onChange={(event) => change({ task: event.target.value })} /></label>
          <label>Acceptance criteria <textarea rows={3} required maxLength={1600} value={draft.criteria}
            onChange={(event) => change({ criteria: event.target.value })} /></label>
          <button className="button secondary" type="submit">{pending === "preview" ? "Preparing…" : "Preview kickoff"}</button>
        </fieldset>
      </form>
      {ready && <div className="kickoff-preview">
        <label>Kickoff preview <textarea readOnly rows={12} value={ready.result.brief} /></label>
        <div className="workflow-actions">
          <button className="button secondary" type="button" onClick={() => onCopy(ready.result.brief, "Kickoff copied")}>Copy kickoff</button>
          {ready.draft.provider && <button className="button primary" type="button" disabled={Boolean(pending) || running}
            onClick={() => void launch()}>{pending === "launch" ? "Starting…" : "Start session"}</button>}
        </div>
        {ready.draft.provider && running && <p className="muted">A session is already running. Check the Outbox for its result.</p>}
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </> : <p className="muted">Create a project to prepare its kickoff.</p>}
  </section>;
}
