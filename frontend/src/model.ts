export type SessionSource = "claude" | "codex";
export type SessionActivity = "working" | "needs_input" | "idle" | "saved" | "unknown";

export interface Session {
  key: string;
  source: SessionSource;
  id: string;
  title: string;
  cwd: string;
  updated: number;
  archived: boolean | null;
  activity: SessionActivity;
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

interface ProjectReminder {
  revisit_later: boolean;
  revisit_on: string | null;
}

export interface DecisionDraft {
  choice: string;
  rationale: string;
  source: string;
  source_session: string | null;
  supersedes: string | null;
}

export interface Decision extends DecisionDraft {
  id: string;
  accepted_on: string;
}

export interface EvalDraft {
  name: string;
  task: string;
  decision: string;
}

export interface KickoffEval {
  id: string;
  name: string;
  task: string;
  expected_decision: string;
  runs: number;
  last_result: {
    passed: boolean;
    expected: string;
    actual: string[];
    assertions: { name: string; passed: boolean }[];
    brief: string;
  } | null;
}

export interface Project extends ProjectFields, ProjectReminder {
  id: string;
  archived: boolean;
  continuation_session: string | null;
  checkpoint: string;
  updated: number;
  revisit: boolean;
  revisit_state: "later" | "due" | "inactive" | null;
  sessions: string[];
  workspaces: string[];
  decisions: Decision[];
  evals: KickoffEval[];
  kickoff: string;
}

export interface Pattern {
  id: string;
  revision: number;
  title: string;
  summary: string;
  roles: string[];
  steps: string[];
  stop: string;
  source?: string;
}

export interface KickoffDraft {
  project: string;
  pattern: string;
  task: string;
  criteria: string;
  workspace: string;
  provider: SessionSource | "";
}

export interface KickoffPreview {
  brief: string;
  digest: string;
  request_id: string;
}

export type Proposal = "checkpoint" | "decision";
export type ReviewAction = "accept" | "dismiss";

export interface OutboxRun {
  id: string;
  project: string;
  pattern: string;
  pattern_revision: number;
  provider: SessionSource;
  workspace: string;
  task: string;
  status: "running" | "completed" | "failed" | "interrupted";
  started: number;
  finished: number | null;
  session_id: string | null;
  result: {
    summary: string;
    checkpoint: { summary: string; next: string; source: string } | null;
    decision: { choice: string; rationale: string; source: string } | null;
  } | null;
  error: string;
  acknowledged: boolean;
  review: Partial<Record<Proposal, "pending" | "accepted" | "dismissed">>;
}

export interface ProjectSuggestion {
  id: string;
  workspace: string;
  name: string;
  sessions: string[];
  sources: SessionSource[];
  reason: string;
  updated: number;
  dismissed: boolean;
}

export interface DashboardState {
  projects: Project[];
  sessions: Session[];
  statuses: string[];
  suggestions: ProjectSuggestion[];
  sources: Record<SessionSource, { count: number; note: string }>;
  scanned: number;
  demo: boolean;
  patterns: Pattern[];
  runner: { providers: SessionSource[]; workspaces: string[] };
  outbox: OutboxRun[];
  savedProject?: string;
}

export type ApplyDashboardChange = (request: Promise<DashboardState>) => Promise<DashboardState>;

export type ProjectStateChange = { status: string } | { archived: boolean };

export interface ProjectDraft extends ProjectFields, ProjectReminder {
  id?: string;
  suggestion?: string;
  workspace?: string;
  sessions?: string[];
}

export interface ProjectDraftRequest {
  provider: SessionSource;
  suggestion?: string;
  sessions: string[];
  fields: ProjectFields;
}

export interface ProjectContext {
  name?: string;
  suggestion?: string;
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
