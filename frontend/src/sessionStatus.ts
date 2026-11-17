import type { Session, SessionActivity } from "./model";

export type SessionStatus = SessionActivity | "archived";
export type SessionStatusFilter = SessionStatus | "all";

export const sessionStatusLabels: Record<SessionStatus, string> = {
  working: "Working", needs_input: "Needs input", idle: "Idle",
  saved: "Saved", archived: "Archived", unknown: "Unknown",
};

export function sessionStatus(session: Session): SessionStatus {
  return session.archived ? "archived" : session.activity;
}
