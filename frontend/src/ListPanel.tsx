import type { ReactNode } from "react";

interface Props {
  title: string;
  count: number;
  search: string;
  searchLabel: string;
  filters: string[];
  filter: string;
  onSearch: (search: string) => void;
  onFilter: (filter: string) => void;
  controls?: ReactNode;
  children: ReactNode;
}

export function ListPanel({ title, count, search, searchLabel, filters, filter, onSearch, onFilter, controls, children }: Props) {
  return <section className="panel list-panel" aria-labelledby="list-heading">
    <div className="list-head">
      <div><h2 id="list-heading">{title}</h2><span id="list-count">{count.toLocaleString()}</span></div>
      <div className="list-actions">
        <label className="search"><span aria-hidden="true">⌕</span>
          <input type="search" placeholder={searchLabel} aria-label={searchLabel} value={search} onChange={(event) => onSearch(event.target.value)} />
        </label>
        {controls}
      </div>
    </div>
    <div className="filters" aria-label="Filters">
      {filters.map((label) =>
        <button key={label} type="button" data-filter={label} aria-pressed={label === filter} onClick={() => onFilter(label)}>
          {label}
        </button>,
      )}
    </div>
    <div>{children}</div>
  </section>;
}
