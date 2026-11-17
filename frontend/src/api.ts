import type {
  DashboardState, DecisionDraft, EvalDraft, KickoffDraft, KickoffPreview, ProjectDraft, ProjectStateChange, Proposal, ReviewAction,
} from "./model";

async function request<T = DashboardState>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

export const api = {
  load: () => request("/api/state"),
  refresh: () => request("/api/refresh", {}),
  saveProject: (draft: ProjectDraft) => request("/api/project", draft),
  setProjectState: (id: string, change: ProjectStateChange) => request("/api/project-state", { id, ...change }),
  linkSession: (session: string, id: string | null) => request("/api/link", { session, id }),
  saveDecision: (id: string, draft: DecisionDraft) => request("/api/decision", { id, ...draft }),
  saveEval: (id: string, draft: EvalDraft) => request("/api/eval", { id, ...draft }),
  replay: (id: string, evalId: string) => request("/api/replay", { id, case: evalId }),
  previewKickoff: (draft: KickoffDraft) => request<KickoffPreview>("/api/kickoff", draft),
  launch: (draft: KickoffDraft, preview: KickoffPreview) => request("/api/launch", {
    ...draft, digest: preview.digest, request_id: preview.request_id,
  }),
  review: (run: string, proposal: Proposal, action: ReviewAction) => request("/api/review", { run, proposal, action }),
};
