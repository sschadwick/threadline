import { dateLabel, shortDate, sourceNames, type Project, type Session } from "./model";

export function resumeCommand(session: Session) {
  const command = (session.source === "codex" ? "codex resume " : "claude --resume ") + session.id;
  const quotedDirectory = "'" + session.cwd.replaceAll("'", "'\\''") + "'";
  return session.cwd ? "cd " + quotedDirectory + " && " + command : command;
}

export function continuationBrief(project: Project, sessions: Session[]) {
  const recent = sessions.slice(0, 4).map((session) =>
    "- " + sourceNames[session.source] + " · " + session.title + " · " +
    shortDate(session.updated) + "\n  " + resumeCommand(session),
  );
  return [
    "Continue " + project.name + ".",
    "Recorded stage: " + project.status + ".",
    "Checkpoint (" + dateLabel(project.checkpoint) + "): " + (project.summary || "Unrecorded"),
    project.evidence && "Evidence: " + project.evidence,
    "Next action: " + (project.next || "Confirm the next concrete milestone."),
    recent.length && "Related sessions:\n" + recent.join("\n"),
    "Verify the checkpoint against current files and session evidence before acting.",
  ].filter(Boolean).join("\n\n");
}
