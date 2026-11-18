import type { SessionCitation } from "./model";

export function SessionCitations({ citations }: { citations: SessionCitation[] }) {
  return <details className="session-citations"><summary>Session evidence ({citations.length})</summary>
    {citations.map((citation, index) => <blockquote key={index}>
      <p>{citation.quote}</p>
      <small>{citation.role} · <code>{citation.reference}</code></small>
      {citation.session.startsWith("codex:") && <a href={"codex://threads/" + citation.session.slice(6)}>Open session</a>}
    </blockquote>)}
  </details>;
}
