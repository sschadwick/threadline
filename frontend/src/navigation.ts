import { useSyncExternalStore } from "react";

export const views = ["projects", "suggestions", "attention", "revisit", "archive", "inbox", "patterns", "outbox"] as const;
export type View = typeof views[number];

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function projectHref(id: string) {
  return "#/projects/" + encodeURIComponent(id);
}

export function roadmapHref(project: string, milestone: string | null, item: string | null = null, kind?: "review" | "handoff") {
  return projectHref(project) + "?focus=" + encodeURIComponent(
    (kind === "review" ? "progress-" : kind === "handoff" ? "handoff-" : "roadmap-") + (item || milestone || "section"),
  );
}

export function attentionHref(project?: string) {
  return "#/attention" + (project ? "?project=" + encodeURIComponent(project) : "");
}

export function navigate(view: View, filter?: string, project?: string) {
  if (view === "projects" && project) {
    window.location.hash = projectHref(project);
    return;
  }
  const query = new URLSearchParams();
  if (filter) query.set("filter", filter);
  if (view === "patterns" && project) query.set("project", project);
  window.location.hash = "#/" + view + (query.size ? "?" + query : "");
}

export function useNavigation() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const [path, search] = hash.slice(2).split("?", 2);
  const [segment, id] = path.split("/", 2);
  const view = views.find((item) => item === segment) ?? "projects";
  const query = new URLSearchParams(search);
  return {
    hash, view, filter: query.get("filter") ?? undefined,
    project: segment === "projects" && id ? decodeProject(id) : undefined,
    projectFocus: segment === "projects" ? query.get("focus") ?? undefined : undefined,
    kickoffProject: view === "patterns" ? query.get("project") ?? undefined : undefined,
    attentionProject: view === "attention" ? query.get("project") ?? undefined : undefined,
    outboxRun: view === "outbox" ? query.get("run") ?? undefined : undefined,
  };
}

function decodeProject(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}
