export type SessionSource = "claude" | "codex";

export interface Session {
  key: string;
  source: SessionSource;
  id: string;
  title: string;
  cwd: string;
  updated: number;
  archived: boolean;
  workspace: string;
  project: string | null;
}

export interface ProjectFields {
  name: string;
  area: string;
  summary: string;
  next: string;
  evidence: string;
  status: string;
}

export interface Project extends ProjectFields {
  id: string;
  checkpoint: string;
  updated: number;
  revisit: boolean;
  sessions: string[];
}

export interface WorkspaceSuggestion {
  workspace: string;
  name: string;
  sessions: string[];
  sources: SessionSource[];
}

export interface DashboardState {
  projects: Project[];
  sessions: Session[];
  statuses: string[];
  suggestions: WorkspaceSuggestion[];
  sources: Record<SessionSource, { count: number; note: string }>;
  scanned: number;
  demo: boolean;
  savedProject?: string;
}

export interface ProjectDraft extends ProjectFields {
  id?: string;
  workspace?: string;
  sessions?: string[];
}

export interface ProjectContext {
  name?: string;
  label: string;
  workspace?: string;
  sessions: string[];
}

export const sourceNames: Record<SessionSource, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

export function shortDate(seconds: number) {
  return seconds
    ? new Date(seconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "Unknown date";
}

export function dateLabel(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}
