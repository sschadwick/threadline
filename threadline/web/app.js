const $ = (id) => document.getElementById(id);
const sourceNames = { claude: "Claude Code", codex: "Codex" };
const statusTone = {
  "In progress": "progress", Prototype: "prototype", Planned: "planned",
  Blocked: "blocked", Parked: "parked", Completed: "completed",
};
const viewCopy = {
  projects: ["Projects", "AI projects", "Pick up where you left off across Claude Code and Codex.", "Project register"],
  revisit: ["Revisit", "Projects to revisit", "Open efforts with no recorded activity for at least 14 days.", "Dormant projects"],
  inbox: ["Session inbox", "Session inbox", "Find related conversations and bring them into a project.", "Local sessions"],
};

let data;
let sessions = new Map();
let view = "projects";
let filter = "All projects";
let selected;
let limit = 40;
let showAllSessions = false;
let projectContext;
let sessionContext;
let syncPending = false;
let toastTimer;

const escape = (value = "") => String(value).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const number = (n) => n.toLocaleString();
const shortDate = (value) => value
  ? new Date(value * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  : "Unknown date";
const checkpointDate = (value) => new Date(value + "T00:00:00").toLocaleDateString(undefined, {
  month: "short", day: "numeric", year: "numeric",
});
const status = (value) => '<span class="status ' + statusTone[value] + '"><i></i>' + escape(value) + "</span>";
const sourceLabel = (key) => '<span class="source-label"><i class="source-dot ' + key + '"></i>' + sourceNames[key] + "</span>";
const token = (name) => (name.match(/[\p{L}\p{N}]+/gu) || [name]).slice(0, 2)
  .map((part) => [...part][0]).join("").toUpperCase();

async function request(path, body) {
  const options = body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  };
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

function update(result) {
  data = result;
  sessions = new Map(data.sessions.map((row) => [row.key, row]));
  render();
}

function render() {
  const [crumb, heading, subtitle, listHeading] = viewCopy[view];
  $("crumb").textContent = crumb;
  $("heading").textContent = heading;
  $("subtitle").textContent = subtitle;
  $("list-heading").textContent = listHeading;
  $("search").placeholder = view === "inbox" ? "Search sessions" : "Search projects";
  $("search").setAttribute("aria-label", $("search").placeholder);
  for (const button of document.querySelectorAll("[data-view]")) {
    if (button.dataset.view === view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const stale = data.projects.filter((project) => project.revisit).length;
  $("nav-count").textContent = stale ? number(stale) : "";
  $("codex-count").textContent = number(data.sources.codex.count);
  $("claude-count").textContent = number(data.sources.claude.count);
  $("demo-note").hidden = !data.demo;
  $("sync-time").textContent = "Scanned " + new Date(data.scanned * 1000).toLocaleTimeString([], {
    hour: "numeric", minute: "2-digit",
  });
  const notes = Object.entries(data.sources).filter(([, source]) => source.note)
    .map(([key, source]) => sourceNames[key] + " · " + source.note);
  $("data-note").textContent = notes.join(" ");
  $("data-note").hidden = !notes.length;
  $("list").setAttribute("aria-busy", "false");
  $("overview").hidden = view !== "projects";
  $("detail").hidden = view === "inbox";
  $("sort").hidden = view === "inbox";
  $("footnote").hidden = view === "inbox";
  $("layout").classList.toggle("single", view === "inbox");
  if (view === "inbox") {
    renderInbox();
    return;
  }

  const inProgress = data.projects.filter((p) => p.status === "In progress").length;
  const linked = data.sessions.filter((row) => row.project).length;
  const metrics = [
    ["▤", "Tracked projects", data.projects.length, "projects"],
    ["◐", "In progress", inProgress, "progress"],
    ["◷", "To revisit", stale, "revisit"],
    ["⌁", "Linked sessions", linked, "linked"],
  ];
  $("overview").innerHTML = metrics.map(([symbol, label, count, action]) =>
    '<button class="metric" type="button" data-metric="' + action + '"><span><i aria-hidden="true">' +
    symbol + "</i>" + label + '</span><strong>' + number(count) + "</strong></button>").join("");
  renderProjects();
}

function filterButtons(labels, current) {
  return labels.map((label) => '<button type="button" data-filter="' + escape(label) + '" aria-pressed="' +
    (label === current) + '">' + escape(label) + "</button>").join("");
}

function renderProjects() {
  const possible = view === "revisit" ? data.projects.filter((p) => p.revisit) : data.projects;
  const applicable = data.statuses.filter((value) => possible.some((p) => p.status === value));
  $("filters").innerHTML = filterButtons(["All projects", ...applicable], filter);
  const query = $("search").value.trim().toLowerCase();
  const order = $("sort").value;
  const list = possible.filter((project) =>
    (filter === "All projects" || project.status === filter) &&
    [project.name, project.area, project.next, project.summary].some((v) => v.toLowerCase().includes(query)));
  if (order === "oldest") list.reverse();
  if (order === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  if (!list.some((project) => project.id === selected)) selected = list[0]?.id;
  $("list-count").textContent = number(list.length);
  $("list").innerHTML = list.length ? [
    '<div class="table-head"><span>Project</span><span>Status</span><span>Last active</span><span></span></div>',
    ...list.map((project) =>
      '<button type="button" class="project-row" aria-pressed="' + (project.id === selected) +
      '" data-project="' + escape(project.id) + '"><span class="project-cell"><span class="tile ' + statusTone[project.status] +
      '" aria-hidden="true">' + escape(token(project.name)) + '</span><span><strong>' + escape(project.name) +
      '</strong><small>' + escape(project.area || "General") + " · " + project.sessions.length +
      (project.sessions.length === 1 ? " session" : " sessions") + '</small></span></span><span>' +
      status(project.status) + (project.revisit ? '<span class="revisit-mark">Revisit</span>' : "") +
      '</span><span class="row-date">' + shortDate(project.updated) + '</span><span class="arrow" aria-hidden="true">›</span></button>'),
  ].join("") : '<div class="empty">' + (query || filter !== "All projects" ? "No projects match these filters." :
    view === "revisit" ? "No open projects need revisiting." : "Create a project or start from a session in the inbox.") + "</div>";
  renderDetail(list.find((project) => project.id === selected));
}

function renderDetail(project) {
  if (!project) {
    $("detail").innerHTML = '<div class="empty">Select a project to view its checkpoint.</div>';
    return;
  }
  const linked = project.sessions.map((key) => sessions.get(key));
  const displayed = showAllSessions ? linked : linked.slice(0, 4);
  $("detail").innerHTML = [
    '<div class="detail-head"><span>PROJECT DETAILS</span><button type="button" class="button secondary" id="edit">Edit</button></div>',
    '<div class="detail-body"><h2 id="detail-heading" tabindex="-1">' + escape(project.name) + '</h2><div class="detail-meta">',
    status(project.status), project.revisit ? '<span class="revisit-mark">Revisit</span>' : "",
    '<span>' + escape(project.area || "General") + '</span></div>',
    '<section class="checkpoint"><h3>Last checkpoint</h3><p>' + escape(project.summary || "No checkpoint recorded.") + '</p>',
    '<p class="evidence">' + escape(project.evidence ? project.evidence + " · " : "") + checkpointDate(project.checkpoint) + '</p></section>',
    '<section class="next"><h3><span aria-hidden="true">↳</span> Next action</h3><p>' + escape(project.next || "No next action recorded.") + '</p></section>',
    '<button type="button" class="button copy-brief" id="copy-brief"><span aria-hidden="true">⧉</span> Copy continuation brief</button>',
    '<div class="session-title"><h3>Linked sessions</h3><span>' + linked.length + '</span></div>',
    displayed.length ? displayed.map((row) => sessionCard(row, false)).join("") :
      '<p class="muted small">Find a conversation in the session inbox and link it here.</p>',
    linked.length > 4 ? '<button type="button" class="button text-button" id="show-sessions">' +
      (showAllSessions ? "Show fewer sessions" : "Show all " + linked.length + " sessions") + '</button>' : "",
    '</div>',
  ].join("");
}

function sessionCard(row, expanded) {
  const project = expanded && data.projects.find((p) => p.id === row.project);
  const info = '<div class="session-info"><strong title="' + escape(row.title) + '">' + escape(row.title) +
    '</strong><small>' + sourceLabel(row.source) + ' <span>·</span> ' + shortDate(row.updated) +
    (row.archived ? " · Archived" : "") + (project ? " · " + escape(project.name) : "") + '</small>' +
    (expanded && row.cwd ? '<small class="cwd" title="' + escape(row.cwd) + '">' + escape(row.cwd) + '</small>' : "") + '</div>';
  return '<div class="session-item">' + info +
    '<button class="icon-button" type="button" aria-label="Copy resume command for ' + escape(row.title) +
    '" title="Copy resume command" data-resume="' + row.key + '">⧉</button>' +
    '<button class="' + (expanded ? "button secondary" : "icon-button") + '" type="button" title="Manage project link" ' +
    'aria-label="Manage project link for ' + escape(row.title) + '" data-link="' + row.key + '">' +
    (expanded ? (row.project ? "Change link" : "Link") : "↗") + '</button></div>';
}

function renderInbox() {
  $("filters").innerHTML = filterButtons(["Unlinked", "Linked", "All sessions", "Workspaces"], filter);
  const query = $("search").value.trim().toLowerCase();
  if (filter === "Workspaces") {
    const list = data.suggestions.filter((group) => group.workspace.toLowerCase().includes(query));
    $("list-count").textContent = number(list.length);
    $("list").innerHTML = list.length ? '<div class="inbox-list">' + list.map((group) =>
      '<div class="session-item"><div class="session-info"><strong>' + escape(group.name) +
      '</strong><small>' + group.sessions.length + ' sessions · ' + group.sources.map((source) => sourceNames[source]).join(" + ") +
      '</small><small class="cwd">' + escape(group.workspace) + '</small></div>' +
      '<button class="button secondary" type="button" data-workspace="' + escape(group.workspace) +
      '">Track workspace</button></div>').join("") + '</div>' :
      '<div class="empty">No matching workspaces with at least two unlinked sessions.</div>';
    return;
  }
  const list = data.sessions.filter((row) =>
    (filter === "All sessions" || (filter === "Linked" ? row.project : !row.project)) &&
    [row.title, row.cwd, sourceNames[row.source]].some((value) => value.toLowerCase().includes(query)));
  $("list-count").textContent = number(list.length);
  $("list").innerHTML = list.length ? '<div class="inbox-list">' +
    list.slice(0, limit).map((row) => sessionCard(row, true)).join("") +
    (list.length > limit ? '<button type="button" class="button secondary more" id="more">Show more sessions</button>' : "") +
    '</div>' : '<div class="empty">No sessions match these filters.</div>';
}

function setView(next, nextFilter) {
  if (!data) return;
  view = next;
  filter = nextFilter || (view === "inbox" ? "Unlinked" : "All projects");
  selected = undefined;
  showAllSessions = false;
  $("search").value = "";
  limit = 40;
  render();
}

function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3500);
}

function openProject(project, context) {
  if (!data) return;
  const form = $("project-form");
  form.reset();
  form.querySelector(".form-error").textContent = "";
  projectContext = { id: project?.id, sessions: context?.sessions, workspace: context?.workspace };
  $("project-dialog-title").textContent = project ? "Edit project" : "New project";
  $("project-context").textContent = context?.label || "";
  $("project-context").hidden = !context?.label;
  form.elements.status.replaceChildren(...data.statuses.map((value) => new Option(value, value)));
  for (const key of ["name", "area", "status", "summary", "next", "evidence"]) {
    form.elements[key].value = project?.[key] ?? (key === "status" ? (context?.status || "Planned") :
      key === "name" ? (context?.name || "") : "");
  }
  $("project-dialog").showModal();
}

function openLink(row) {
  sessionContext = row;
  const form = $("link-form");
  form.querySelector(".form-error").textContent = "";
  form.elements.project.replaceChildren(new Option("Unlinked", ""), ...data.projects.map((p) => new Option(p.name, p.id)));
  form.elements.project.value = row.project || "";
  $("link-title").textContent = row.title + " · " + sourceNames[row.source];
  $("link-dialog").showModal();
}

function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function resume(row) {
  const command = (row.source === "codex" ? "codex resume " : "claude --resume ") + row.id;
  return row.cwd ? "cd " + shellQuote(row.cwd) + " && " + command : command;
}

async function copy(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    toast(label);
  } catch {
    $("copy-text").value = value;
    $("copy-dialog").showModal();
    $("copy-text").select();
  }
}

function copyBrief(project) {
  const recent = project.sessions.slice(0, 4).map((key) => {
    const row = sessions.get(key);
    return "- " + sourceNames[row.source] + " · " + row.title + " · " + shortDate(row.updated) + "\n  " + resume(row);
  });
  copy([
    "Continue " + project.name + ".",
    "Recorded stage: " + project.status + ".",
    "Checkpoint (" + checkpointDate(project.checkpoint) + "): " + (project.summary || "Unrecorded"),
    project.evidence ? "Evidence: " + project.evidence : "",
    "Next action: " + (project.next || "Confirm the next concrete milestone."),
    recent.length ? "Related sessions:\n" + recent.join("\n") : "",
    "Verify the checkpoint against current files and session evidence before acting.",
  ].filter(Boolean).join("\n\n"), "Continuation brief copied");
}

async function sync(manual = false) {
  if (syncPending) return;
  syncPending = true;
  $("refresh").disabled = true;
  try {
    update(await request(data ? "/api/refresh" : "/api/state", data ? {} : undefined));
    if (manual) toast("Session history refreshed");
  } catch (error) {
    if (!data) {
      $("list").textContent = "Could not read session history. Use Refresh to retry.";
      $("list").setAttribute("aria-busy", "false");
    }
    if (manual || !data) toast(error.message);
  } finally {
    syncPending = false;
    $("refresh").disabled = false;
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.hasAttribute("data-close")) button.closest("dialog").close();
  if (!data) return;
  const { view: next, filter: nextFilter, project, link, resume: resumeKey, workspace, metric } = button.dataset;
  if (next) setView(next);
  if (metric === "projects") setView("projects");
  if (metric === "revisit") setView("revisit");
  if (metric === "progress" && data.projects.some((p) => p.status === "In progress")) setView("projects", "In progress");
  if (metric === "linked") setView("inbox", "Linked");
  if (nextFilter) {
    filter = nextFilter;
    limit = 40;
    showAllSessions = false;
    render();
    [...$("filters").children].find((node) => node.dataset.filter === filter)?.focus();
  }
  if (project) {
    selected = project;
    showAllSessions = false;
    renderProjects();
    if (window.matchMedia("(max-width: 1030px)").matches) {
      $("detail-heading")?.focus();
    } else {
      document.querySelector('[data-project="' + CSS.escape(project) + '"]')?.focus();
    }
  }
  if (link) openLink(sessions.get(link));
  if (resumeKey) copy(resume(sessions.get(resumeKey)), "Resume command copied");
  if (workspace) {
    const group = data.suggestions.find((item) => item.workspace === workspace);
    openProject(undefined, { ...group, label: "Link " + group.sessions.length + " sessions from " + group.name });
  }
  if (button.id === "add") openProject();
  if (button.id === "edit") openProject(data.projects.find((p) => p.id === selected));
  if (button.id === "copy-brief") copyBrief(data.projects.find((p) => p.id === selected));
  if (button.id === "show-sessions") {
    showAllSessions = !showAllSessions;
    renderDetail(data.projects.find((p) => p.id === selected));
    $("show-sessions")?.focus();
  }
  if (button.id === "more") {
    const previous = limit;
    limit += 40;
    renderInbox();
    $("list").querySelectorAll("[data-resume]")[previous]?.focus();
  }
  if (button.id === "project-from-session") {
    $("link-dialog").close();
    openProject(undefined, { sessions: [sessionContext.key], label: "Link " + sessionContext.title });
  }
});

for (const [formId, endpoint] of [["project-form", "/api/project"], ["link-form", "/api/link"]]) {
  $(formId).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    const isProject = formId === "project-form";
    const payload = isProject ? { ...fields, ...projectContext } : {
      id: fields.project || null, session: sessionContext.key,
    };
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    form.querySelector(".form-error").textContent = "";
    try {
      const result = await request(endpoint, payload);
      form.closest("dialog").close();
      if (isProject) {
        data = result;
        setView("projects");
        selected = result.savedProject;
      }
      update(result);
      if (isProject) document.querySelector('[data-project="' + CSS.escape(selected) + '"]')?.focus();
      else document.querySelector('[data-link="' + sessionContext.key + '"]')?.focus();
      toast(isProject ? "Project saved" : "Session link updated");
    } catch (error) {
      form.querySelector(".form-error").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

$("refresh").addEventListener("click", () => sync(true));
$("search").addEventListener("input", () => {
  if (!data) return;
  limit = 40;
  showAllSessions = false;
  if (view === "inbox") renderInbox();
  else renderProjects();
});
$("sort").addEventListener("change", renderProjects);
sync();
setInterval(() => {
  if (!document.hidden && !document.querySelector("dialog[open]")) sync();
}, 60000);
