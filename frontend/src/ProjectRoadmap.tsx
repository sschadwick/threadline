import { useState } from "react";
import { api } from "./api";
import { dateLabel, errorText, type ApplyDashboardChange, type Milestone, type Project, type RoadmapTarget,
  type Session, type SessionSource } from "./model";
import { roadmapHref } from "./navigation";
import { RoadmapEditor } from "./RoadmapEditor";
import { DraftProgress, ProgressEditor, ProgressHistory } from "./RoadmapProgress";
import { SessionCitations } from "./SessionCitations";
import "./roadmap.css";

interface Context {
  project: Project;
  sessions: Session[];
  providers: SessionSource[];
  onApply: ApplyDashboardChange;
  onResume: (session: Session) => void;
  onCopy: (text: string, confirmation: string) => void;
}

export function NextActionCard({ project, onCopy }: Pick<Context, "project" | "onCopy">) {
  const next = project.next_action;
  const href = roadmapHref(project.id, next.milestone, next.item, next.kind === "review");
  const selected = project.roadmap.find((milestone) => milestone.id === next.milestone);
  const target = next.item ? selected?.items.find((item) => item.id === next.item) : selected;
  return <section className="panel next-action-card" aria-labelledby="next-action-heading">
    <h2 id="next-action-heading">What’s next?</h2>
    <p><strong>{next.title}</strong></p>
    <p className="muted small">{next.reason}{next.kind === "work" && target?.until && " · Revisit when " + target.until}</p>
    {!project.archived && <div className="workflow-actions">
      {(next.kind === "work" || next.kind === "legacy") && <button type="button" className="button primary"
        onClick={() => onCopy(project.kickoff, "Continuation brief copied")}>Copy continuation brief</button>}
      {next.kind !== "legacy" && <a className="button secondary" href={href}>
        {next.kind === "review" ? "Review proposal" : next.kind === "plan" ? "Open roadmap" : "View work"}
      </a>}
    </div>}
  </section>;
}

export function ProjectRoadmap(context: Context) {
  const { project, sessions, onApply } = context;
  const [creating, setCreating] = useState(false);
  const milestones = [...project.roadmap].sort((a, b) =>
    ["active", "planned", "complete"].indexOf(a.status) - ["active", "planned", "complete"].indexOf(b.status),
  );

  return <section className="project-roadmap" id="roadmap-section" tabIndex={-1} aria-labelledby="roadmap-heading">
    <div className="section-heading">
      <h2 id="roadmap-heading">Roadmap</h2>
      {!project.archived && !creating && <button type="button" className="button secondary"
        onClick={() => setCreating(true)}>Add milestone</button>}
    </div>
    {creating && !project.archived && <RoadmapEditor item={false} sessions={sessions}
      onSave={(values) => onApply(api.roadmap(project.id, { ...values, action: "save" }))} onClose={() => setCreating(false)} />}
    {!milestones.length && !creating && <p className="muted small">No milestones recorded.</p>}
    {milestones.map((milestone) => <MilestoneCard key={milestone.id} milestone={milestone} context={context} />)}
  </section>;
}

function MilestoneCard({ milestone, context }: { milestone: Milestone; context: Context }) {
  const { project, sessions, onApply } = context;
  const [adding, setAdding] = useState<string>();
  const closed = project.archived || milestone.status === "complete";
  return <RoadmapCard target={milestone} milestone={milestone} context={context}>
    <>
      {milestone.items.length > 0 && <p className="small muted">
        {milestone.items.filter((item) => item.status === "done").length} done ·{" "}
        {milestone.items.filter((item) => item.blocked_by).length} blocked ·{" "}
        {milestone.items.filter((item) => item.status === "in progress" && !item.blocked_by).length} in progress ·{" "}
        {milestone.items.filter((item) => item.status === "todo" && !item.blocked_by).length} to do
      </p>}
      {milestone.items.map((item) => <RoadmapCard key={item.id} milestone={milestone} target={item} context={context} />)}
      {!closed && (adding ? <RoadmapEditor item milestone={milestone} sessions={sessions} onClose={() => setAdding(undefined)}
        onSave={(values) => onApply(api.roadmap(project.id, {
          ...values, action: "add item", milestone: milestone.id, revision: adding,
        }))} /> : <button type="button" className="button secondary" onClick={() => setAdding(milestone.revision)}>Add work item</button>)}
    </>
  </RoadmapCard>;
}

function RoadmapCard({ milestone, target, context, children }: {
  milestone: Milestone; target: RoadmapTarget; context: Context; children?: React.ReactNode;
}) {
  const { project, sessions, providers, onApply, onCopy, onResume } = context;
  const [form, setForm] = useState<{ mode: "edit" | "progress"; revision: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const item = "depends_on" in target;
  const closed = project.archived || milestone.status === "complete";
  const index = project.roadmap.findIndex((record) => record.id === milestone.id);
  const location = { milestone: milestone.id, item: item ? target.id : null, revision: target.revision };
  const review = target.review;
  const Heading = item ? "h4" : "h3";
  const change = (values: object) => onApply(api.roadmap(project.id, { ...location, ...values }));

  async function run(values: object) {
    setBusy(true);
    setError("");
    try {
      await change(values);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <section className={"roadmap-card" + (item ? " roadmap-item" : "")}
    id={"roadmap-" + target.id} tabIndex={-1} aria-labelledby={"title-" + target.id}>
    <div className="section-heading">
      <Heading id={"title-" + target.id}>{target.title}</Heading>
      <span className={"status " + (target.blocked_by ? "blocked" : target.status === "active" ? "progress" : "")}>
        {target.blocked_by ? "blocked" : target.status}
      </span>
    </div>
    <p>{target.outcome}</p>
    {!item && <>
      {target.scope && <p className="small"><strong>Scope</strong> {target.scope}</p>}
      <p className="small"><strong>Success criteria</strong> {target.criteria}</p>
    </>}
    {target.blocked_by && <p className="small"><strong>Blocked</strong> {target.blocked_by}</p>}
    {target.next && target.status !== "done" && target.status !== "complete" && <p className="small">
      <strong>Next action</strong> {target.next}{target.until && " · Revisit when " + target.until}
    </p>}
    {!item && target.completed_on && <p className="small muted">Completed {dateLabel(target.completed_on)}</p>}
    {target.updates.length > 0 && <p className="small"><strong>Latest checkpoint</strong> {target.updates.at(-1)?.summary}</p>}
    <div className="workflow-actions">
      <button type="button" className="button secondary" onClick={() => onCopy(target.brief, "Continuation brief copied")}>Copy continuation brief</button>
      {!closed && <>
        <button type="button" className="button secondary" onClick={() => setForm({ mode: "edit", revision: target.revision })}>Edit {item ? "work item" : "milestone"}</button>
        <button type="button" className="button secondary" onClick={() => setForm({ mode: "progress", revision: target.revision })}>Record progress</button>
        {!item && <>
          {target.status === "planned" && !project.roadmap.some((record) => record.status === "active") &&
            <button type="button" className="button primary" disabled={busy} onClick={() => void run({ action: "activate" })}>Activate milestone</button>}
          {target.status === "active" && <button type="button" className="button secondary" disabled={busy}
            onClick={() => void run({ action: "defer" })}>Return to planned</button>}
          {target.ready && <button type="button" className="button primary" disabled={busy}
            onClick={() => void run({ action: "complete" })}>Confirm completion</button>}
          {target.status === "planned" && <>
            {index > 0 && <button type="button" className="button secondary" disabled={busy} onClick={() => void run({ action: "move", direction: "up" })}>Move up</button>}
            {index < project.roadmap.length - 1 && <button type="button" className="button secondary" disabled={busy} onClick={() => void run({ action: "move", direction: "down" })}>Move down</button>}
          </>}
        </>}
      </>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!closed && form?.mode === "edit" && <RoadmapEditor target={target} milestone={milestone} item={item} sessions={sessions}
      onSave={(values) => change({ ...values, action: "save", revision: form.revision })} onClose={() => setForm(undefined)} />}
    {!closed && form?.mode === "progress" && <ProgressEditor target={target} sessions={sessions}
      onSave={(values) => change({ ...values, action: "progress", revision: form.revision })} onClose={() => setForm(undefined)} />}
    <ProgressHistory target={target} sessions={sessions} onResume={onResume} />
    {!closed && <>
      {review && <section className="roadmap-review" id={"progress-" + target.id} tabIndex={-1} aria-label="Progress proposal">
        <SessionCitations citations={review.citations} />
        {review.stale ? <p className="form-error">The record or its linked evidence changed. Draft a fresh update.</p> :
          <ProgressEditor key={review.id} target={target} review={review} sessions={sessions}
            onSave={(values) => change({ ...values, action: "accept", review: review.id })} />}
        <button type="button" className="button secondary" disabled={busy}
          onClick={() => void run({ action: "dismiss", review: review.id })}>Dismiss proposal</button>
      </section>}
      <DraftProgress project={project.id} location={location} providers={providers} sessions={sessions} onApply={onApply} />
    </>}
    {children}
  </section>;
}
