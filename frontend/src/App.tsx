import { useRef, useState } from "react";
import { api } from "./api";
import { resumeCommand } from "./continuation";
import { CopyDialog, LinkEditor, ProjectEditor } from "./Dialogs";
import type { Project, ProjectContext, Session } from "./model";
import { ProjectMetrics } from "./ProjectMetrics";
import { ProjectRegister } from "./ProjectRegister";
import { SessionInbox } from "./SessionInbox";
import { useDashboard } from "./useDashboard";
import { WorkspaceLayout, type View } from "./WorkspaceLayout";

type Editor = { kind: "project"; project?: Project; context?: ProjectContext }
  | { kind: "link"; session: Session }
  | { kind: "copy"; text: string };

interface Navigation {
  view: View;
  revision: number;
  filter?: string;
  project?: string;
}

export function App() {
  const [navigation, setNavigation] = useState<Navigation>({ view: "projects", revision: 0 });
  const [editor, setEditor] = useState<Editor>();
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const { data, refreshing, loadError, refresh, apply } = useDashboard(Boolean(editor));

  function navigate(view: View, filter?: string, project?: string) {
    setNavigation((previous) => ({ view, revision: previous.revision + 1, filter, project }));
  }

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

  return <WorkspaceLayout view={navigation.view} data={data} refreshing={refreshing} onNavigate={navigate}
    onRefresh={() => void refresh().then((ok) => { if (ok) notify("Session history refreshed"); })}
    onNewProject={() => setEditor({ kind: "project" })}>
    {loadError && <div className="data-note" role="alert">Could not read session history. {loadError}</div>}
    {data ? <>
      {navigation.view === "projects" && <ProjectMetrics data={data} onNavigate={navigate} />}
      {navigation.view === "inbox" ?
        <SessionInbox key={navigation.revision} data={data} initialFilter={navigation.filter}
          onTrack={trackProject} {...sessionActions} /> :
        <ProjectRegister key={navigation.revision} data={data} revisit={navigation.view === "revisit"}
          initialFilter={navigation.filter} initialProject={navigation.project}
          onEdit={(project) => setEditor({ kind: "project", project })} onCopy={copy} onApply={apply} {...sessionActions} />}
      {editor?.kind === "project" &&
        <ProjectEditor project={editor.project} context={editor.context} statuses={data.statuses}
          onClose={closeEditor} onSave={async (draft) => {
            const result = await apply(api.saveProject(draft));
            navigate("projects", undefined, result.savedProject);
            notify("Project saved");
            requestAnimationFrame(() => {
              if (result.savedProject) document.querySelector<HTMLElement>(
                '[data-project="' + CSS.escape(result.savedProject) + '"]',
              )?.focus();
            });
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
