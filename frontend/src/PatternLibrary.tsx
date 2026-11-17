import { useState } from "react";
import { KickoffForm } from "./KickoffForm";
import type { ApplyDashboardChange, DashboardState } from "./model";

interface Props {
  data: DashboardState;
  project?: string;
  onApply: ApplyDashboardChange;
  onCopy: (text: string, confirmation: string) => void;
  onLaunch: () => void;
}

export function PatternLibrary({ data, project, onApply, onCopy, onLaunch }: Props) {
  const [selected, setSelected] = useState(data.patterns[0]?.id);
  const pattern = data.patterns.find((item) => item.id === selected);

  return <div className="layout workflow-layout">
    <section className="panel workflow-panel" aria-labelledby="patterns-heading">
      <h2 id="patterns-heading">Workflow catalog</h2>
      <ul className="pattern-list">
        {data.patterns.map((item) => <li key={item.id}>
          <button type="button" className="pattern-option" aria-pressed={selected === item.id}
            onClick={() => setSelected(item.id)}>
            <strong>{item.title}</strong>
            <span>{item.summary}</span>
          </button>
        </li>)}
      </ul>
      {pattern && <div className="pattern-details">
        <h3>Roles</h3>
        <ul>{pattern.roles.map((role) => <li key={role}>{role}</li>)}</ul>
        <h3>Workflow</h3>
        <ol>{pattern.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        <p>{pattern.stop}</p>
        {pattern.source && <a href={pattern.source}>Source</a>}
      </div>}
    </section>
    {pattern && <KickoffForm data={data} pattern={pattern.id} initialProject={project}
      onApply={onApply} onCopy={onCopy} onLaunch={onLaunch} />}
  </div>;
}
