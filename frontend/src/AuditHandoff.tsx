import { useState, type FormEvent } from "react";
import { api } from "./api";
import { errorText, sourceNames, type ApplyDashboardChange, type AuditCandidate, type DashboardState,
  type KickoffPreview, type Project, type RoadmapLocation, type Session, type SessionSource, type WorkItem } from "./model";

interface Props {
  project: Project;
  location: RoadmapLocation;
  item: WorkItem;
  sessions: Session[];
  runner: DashboardState["runner"];
  closed: boolean;
  onApply: ApplyDashboardChange;
}

export function AuditHandoff({ project, location, item, sessions, runner, closed, onApply }: Props) {
  const [editRevision, setEditRevision] = useState<string>();
  const [preview, setPreview] = useState<KickoffPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidate = item.audit_candidate;
  const audit = item.audit;
  const producer = sessions.find((session) => session.key === candidate?.producer);
  const canLaunch = candidate && runner.providers.includes(candidate.auditor) && runner.workspaces.includes(candidate.workspace);
  const canPreview = !closed && audit && ["ready", "failed", "interrupted"].includes(audit.status);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!candidate && closed) return null;
  return <section className="roadmap-review" id={"handoff-" + item.id} tabIndex={-1} aria-label="Audit handoff">
    {candidate && audit && <>
      <div className="section-heading">
        <h5>Producer and independent auditor</h5>
        <span className="status">{audit.status}</span>
      </div>
      <ol className="outbox-list small">
        <li><strong>Producer</strong> {producer ? `${sourceNames[producer.source]} · ${producer.title}` : "Session unavailable"}<br />
          <strong>Candidate</strong> <code className="audit-commit" title={candidate.commit}>{candidate.commit.slice(0, 12)}</code><br />
          <strong>Reported checks</strong> {candidate.checks}</li>
        <li><strong>Auditor</strong> {sourceNames[candidate.auditor]}
          {audit.run && <> · <a href={"#/outbox?run=" + encodeURIComponent(audit.run)}>View run in Outbox</a></>}
        </li>
        <li><strong>Human acceptance</strong> {audit.status === "accepted" ? "Accepted" :
          audit.status === "awaiting acceptance" ? "Ready in Outbox" : "Waiting on passing audit"}</li>
      </ol>
      {audit.attempts > 0 && <p className="small muted">Auditor usage · {audit.usage
        ? `${audit.usage.input_tokens.toLocaleString()} input · ${audit.usage.output_tokens.toLocaleString()} output tokens`
        : "Token totals unavailable"} · {audit.measured_attempts} of {audit.attempts} attempts reported</p>}
    </>}
    {candidate && canPreview && !canLaunch && <p className="small muted">Enable the {sourceNames[candidate.auditor]} runner for the producer workspace.</p>}
    {!closed && !editRevision && <div className="workflow-actions">
      <button type="button" className="button secondary" disabled={busy} onClick={() => { setPreview(undefined); setEditRevision(item.revision); }}>
        {candidate ? "Edit candidate" : "Set up audit handoff"}
      </button>
      {canPreview && canLaunch && <button type="button" className="button secondary" disabled={busy} onClick={() => void perform(async () => {
        setPreview(await api.previewAudit(project.id, location));
      })}>Preview auditor brief</button>}
    </div>}
    {!closed && editRevision && <CandidateForm candidate={candidate} project={project} sessions={sessions} runner={runner} busy={busy}
      onCancel={() => { setEditRevision(undefined); setError(""); }} onSave={(values) => void perform(async () => {
        await onApply(api.roadmap(project.id, { ...location, ...values, revision: editRevision, action: "audit candidate" }));
        setEditRevision(undefined);
      })} />}
    {canPreview && canLaunch && preview && <div className="kickoff-preview">
      <label className="small">Auditor brief<textarea value={preview.brief} readOnly rows={6} /></label>
      <div className="workflow-actions">
        <button type="button" className="button primary" disabled={busy} onClick={() => void perform(async () => {
          await onApply(api.startAudit(project.id, location, preview));
          setPreview(undefined);
        })}>Start read-only audit</button>
      </div>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

export function ProjectAgents({ project, sessions }: { project: Project; sessions: Session[] }) {
  const agents = new Set<string>();
  for (const milestone of project.roadmap) {
    for (const item of milestone.items) {
      const candidate = item.audit_candidate;
      if (!candidate) continue;
      const producer = sessions.find((session) => session.key === candidate.producer);
      if (producer) agents.add(`Producer · ${sourceNames[producer.source]}`);
      agents.add(`Auditor · ${sourceNames[candidate.auditor]}`);
    }
  }
  if (!agents.size) return null;
  return <section className="checkpoint" aria-labelledby="project-agents-heading">
    <h2 id="project-agents-heading">Project agents</h2>
    <ul>{[...agents].map((agent) => <li key={agent}>{agent}</li>)}</ul>
  </section>;
}

function CandidateForm({ candidate, project, sessions, runner, busy, onSave, onCancel }: {
  candidate?: AuditCandidate;
  project: Project;
  sessions: Session[];
  runner: DashboardState["runner"];
  busy: boolean;
  onSave: (values: AuditCandidate) => void;
  onCancel: () => void;
}) {
  const superseded = new Set(project.decisions.map((row) => row.supersedes));
  const active = project.decisions.filter((row) => !superseded.has(row.id));
  const producers = sessions.filter((session) => session.workspace);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const producer = producers.find((session) => session.key === fields.get("producer"));
    if (!producer) return;
    onSave({ producer: producer.key, workspace: producer.workspace, auditor: fields.get("auditor") as SessionSource,
      commit: String(fields.get("commit")), checks: String(fields.get("checks")), decisions: fields.getAll("decisions").map(String) });
  }
  if (!producers.length) return <>
    <p className="small muted">Link a producer session with a workspace before setting up the audit.</p>
    <button type="button" className="button secondary" onClick={onCancel}>Close</button>
  </>;
  return <form className="roadmap-form" onSubmit={save}>
    <label>Producer session<select name="producer" required defaultValue={candidate?.producer ?? ""}>
      <option value="">Choose a linked session</option>
      {producers.map((session) => <option key={session.key} value={session.key}>
        {sourceNames[session.source]} · {session.title}
      </option>)}
    </select></label>
    <label>Auditor<select name="auditor" defaultValue={candidate?.auditor ?? runner.providers[0] ?? "codex"}>
      <option value="codex">Codex</option><option value="claude">Claude Code</option>
    </select></label>
    <label>Full Git commit hash<input name="commit" pattern="[a-fA-F0-9]{40}([a-fA-F0-9]{24})?" required defaultValue={candidate?.commit} /></label>
    <label>Reported check results<textarea name="checks" maxLength={800} required defaultValue={candidate?.checks} /></label>
    {active.length > 0 && <fieldset>
      <legend>Relevant decisions (up to five)</legend>
      {active.map((decision) => <label className="roadmap-check" key={decision.id}>
        <input name="decisions" type="checkbox" value={decision.id} defaultChecked={candidate?.decisions.includes(decision.id)} /> {decision.choice}
      </label>)}
    </fieldset>}
    <div className="workflow-actions">
      <button type="submit" className="button primary" disabled={busy}>Save candidate</button>
      <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
