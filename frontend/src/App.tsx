import { useRef, useState } from "react";
import { api } from "./api";
import { AttentionQueue, projectAttention } from "./AttentionQueue";
import { resumeCommand } from "./continuation";
import { CopyDialog, LinkEditor } from "./Dialogs";
import { ProjectEditor } from "./ProjectEditor";
import type { Project, ProjectContext, Session } from "./model";
import { navigate, useNavigation } from "./navigation";
import { Outbox } from "./Outbox";
import { PatternLibrary } from "./PatternLibrary";
import { ProjectDetails } from "./ProjectDetails";
import { ProjectMetrics } from "./ProjectMetrics";
import { ProjectRegister } from "./ProjectRegister";
import { SessionInbox } from "./SessionInbox";
import { SuggestedProjects } from "./SuggestedProjects";
import { useDashboard } from "./useDashboard";
import { WorkspaceLayout } from "./WorkspaceLayout";

type Editor = { kind: "project"; project?: Project; context?: ProjectContext }
  | { kind: "link"; session: Session }
  | { kind: "copy"; text: string };

export function App() {
  const navigation = useNavigation();
  const [editor, setEditor] = useState<Editor>();
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const { data, refreshing, loadError, refresh, apply } = useDashboard(Boolean(editor));

  function notify(message: string) {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 3500);
  }

  async function copy(text: string, confirmation: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(confirmation);
    } catch {
      setEditor({ kind: "copy", text });
    }
  }

  const sessionActions = {
    onLink: (session: Session) => setEditor({ kind: "link", session }),
    onResume: (session: Session) => void copy(resumeCommand(session), "Resume command copied"),
  };
  const trackProject = (context: ProjectContext) => setEditor({ kind: "project", context });
  const closeEditor = () => setEditor(undefined);
  const project = navigation.project && data?.projects.find((item) => item.id === navigation.project);
  const sessionsByKey = project && new Map(data?.sessions.map((session) => [session.key, session]));
  const linked = project && sessionsByKey ? project.sessions.flatMap((key) => {
    const session = sessionsByKey.get(key);
    return session ? [session] : [];
  }) : [];
  const attention = data ? projectAttention(data) : [];
  const attentionCount = attention.reduce((count, entry) => count + entry.sessions.length + entry.runs.length, 0);
  const projectQueue = attention.find((entry) => entry.project.id === navigation.project);

  return <WorkspaceLayout view={navigation.view} projectPage={Boolean(navigation.project)} attentionCount={attentionCount} data={data}
    refreshing={refreshing} onNavigate={navigate}
    onRefresh={() => void refresh().then((ok) => { if (ok) notify("Session history refreshed"); })}
    onNewProject={() => setEditor({ kind: "project" })}>
    {loadError && <div className="data-note" role="alert">Could not read session history. {loadError}</div>}
    {data ? <>
      {navigation.view === "projects" && !navigation.project && <ProjectMetrics data={data} onNavigate={navigate} />}
      {navigation.view === "inbox" &&
        <SessionInbox key={navigation.hash} data={data} initialFilter={navigation.filter}
          {...sessionActions} />}
      {navigation.view === "suggestions" && <SuggestedProjects data={data} onTrack={trackProject} onApply={apply} />}
      {navigation.view === "attention" && <AttentionQueue key={navigation.hash} groups={attention}
        projectId={navigation.attentionProject} onApply={apply} {...sessionActions} />}
      {!navigation.project && (navigation.view === "projects" || navigation.view === "revisit" || navigation.view === "archive") &&
        <ProjectRegister key={navigation.hash} data={data} view={navigation.view} initialFilter={navigation.filter} />}
      {navigation.project && (project ?
        <ProjectDetails key={project.id} project={project} sessions={linked} statuses={data.statuses}
          providers={data.demo ? [] : data.runner.providers}
          needsAttention={projectQueue ? projectQueue.sessions.length + projectQueue.runs.length : 0}
          onEdit={(project) => setEditor({ kind: "project", project })} onCopy={copy} onApply={apply} onNotify={notify}
          onKickoff={(project) => navigate("patterns", undefined, project)} {...sessionActions} />
        : <div><h1>Project unavailable</h1><a className="project-back" href="#/projects">Back to projects</a></div>)}
      {navigation.view === "patterns" && <PatternLibrary key={navigation.hash} data={data} project={navigation.kickoffProject}
        onApply={apply} onCopy={copy} onLaunch={() => navigate("outbox")} />}
      {navigation.view === "outbox" && <Outbox data={data} runId={navigation.outboxRun} onApply={apply} onCopy={copy} />}
      {editor?.kind === "project" &&
        <ProjectEditor project={editor.project} context={editor.context} statuses={data.statuses}
          providers={data.demo ? [] : data.runner.providers}
          sessions={data.sessions.filter((session) => editor.context?.sessions.includes(session.key))}
          onClose={closeEditor} onSave={async (draft) => {
            const result = await apply(api.saveProject(draft));
            navigate("projects", undefined, result.savedProject);
            notify("Project saved");
          }} />}
      {editor?.kind === "link" && <LinkEditor session={editor.session} projects={data.projects}
        onClose={closeEditor} onCreate={trackProject} onLink={async (id) => {
          await apply(api.linkSession(editor.session.key, id));
          notify("Session link updated");
        }} />}
      {editor?.kind === "copy" && <CopyDialog text={editor.text} onClose={closeEditor} />}
    </> : !loadError && <div className="panel empty" role="status">Reading local session history…</div>}
    <div id="toast" role="status" hidden={!toast}>{toast}</div>
  </WorkspaceLayout>;
}
