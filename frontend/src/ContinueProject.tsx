import type { Project, Session } from "./model";

interface Props {
  project: Project;
  pinned?: Session;
  onResume: (session: Session) => void;
  onCopy: (content: string, confirmation: string) => void;
  onKickoff: (project: string) => void;
}

export function ContinueProject({ project, pinned, onResume, onCopy, onKickoff }: Props) {
  return <section className="continuation-section" aria-labelledby="continue-project-heading">
    <h2 id="continue-project-heading">Continue project</h2>
    {pinned ? <p>Pinned session · <strong>{pinned.title}</strong></p>
      : project.sessions.length > 0 && <p className="muted">Pin a linked session to keep it here.</p>}
    <div className="project-actions continuation-actions">
      {pinned?.source === "codex" && <a className="button secondary"
        href={"codex://threads/" + encodeURIComponent(pinned.id)}>Open in Codex</a>}
      {pinned && <button type="button" className="button secondary" onClick={() => onResume(pinned)}>
        Copy resume command
      </button>}
      <button type="button" className="button secondary" id="copy-brief"
        onClick={() => onCopy(project.kickoff, "Continuation brief copied")}>
        Copy continuation brief
      </button>
      {!project.archived && <button type="button" className="button primary" onClick={() => onKickoff(project.id)}>
        Prepare kickoff
      </button>}
    </div>
  </section>;
}
