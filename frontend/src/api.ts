import type { DashboardState, ProjectDraft } from "./model";

async function request(path: string, body?: object): Promise<DashboardState> {
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
  linkSession: (session: string, id: string | null) => request("/api/link", { session, id }),
};
