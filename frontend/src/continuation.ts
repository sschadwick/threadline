import type { Session } from "./model";

export function resumeCommand(session: Pick<Session, "source" | "id" | "cwd">) {
  const command = (session.source === "codex" ? "codex resume " : "claude --resume ") + session.id;
  const quotedDirectory = "'" + session.cwd.replaceAll("'", "'\\''") + "'";
  return session.cwd ? "cd " + quotedDirectory + " && " + command : command;
}
