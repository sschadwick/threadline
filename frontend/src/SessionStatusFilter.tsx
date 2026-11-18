import { sessionStatusLabels, type SessionStatusFilter } from "./sessionStatus";

export function SessionStatusSelect({ value, onChange }: {
  value: SessionStatusFilter;
  onChange: (value: SessionStatusFilter) => void;
}) {
  return <select aria-label="Session status" value={value}
    onChange={(event) => onChange(event.target.value as SessionStatusFilter)}>
    <option value="all">All statuses</option>
    {Object.entries(sessionStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
  </select>;
}
