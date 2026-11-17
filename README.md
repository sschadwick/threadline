# Threadline

Threadline keeps a project register alongside your Claude Code and Codex history. Open an effort to see the last checkpoint, what to do next, and which sessions to return to.

![Threadline dashboard showing six demo projects and the selected project's checkpoint, next action, and linked sessions](docs/images/dashboard.png)

## Try the demo

Threadline needs Python 3.11 or later. [Download v0.1.0](https://github.com/sschadwick/threadline/releases/tag/v0.1.0).

```bash
python3 threadline-0.1.0.pyz --demo
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). The demo uses six fictional projects and synthetic session metadata. Its edits live in a temporary directory.

From a source checkout, run `python3 -m threadline --demo` for the same experience.

## Use your own history

Run the archive without `--demo` or run `python3 -m threadline` from the checkout. Open the same address. Threadline starts with an empty project register and scans the history available on that machine.

1. Find related sessions in **Session inbox**. Use **Workspaces** to see checkouts with at least two unlinked sessions.
2. Choose **Track workspace** to create a project and link its sessions. You can also link individual sessions to a project.
3. Record a checkpoint and a next action when you stop work. **Revisit** surfaces open projects after 14 days without a checkpoint or linked-session activity.
4. When you return, copy a resume command for an existing session or a continuation brief for a new one.

![The session inbox showing unlinked Claude Code and Codex conversations with controls to attach them to projects](docs/images/inbox.png)

Threadline refreshes session activity every minute while the dashboard is visible. After you track a workspace, later sessions can match its checkout path or project name. You decide the status and next action. Manual links and unlinks take priority.

## History and storage

| Input | Default location | What Threadline reads |
| --- | --- | --- |
| Claude Code | `~/.claude` | The history index and session records used to derive titles, dates, and working directories |
| Codex | `~/.codex` | The local state database, session index, and available rollout headers |

Threadline reads from the host's filesystem. It uses `CLAUDE_CONFIG_DIR` and `CODEX_HOME` when set. Use `--claude-dir` and `--codex-dir` to point at other local directories. Compressed Codex rollouts rely on metadata in the database or index.

The dashboard serves titles, dates, and working directories to your browser. Transcript bodies stay in the source stores. Threadline makes no external requests and requires no model credentials.

Back up `~/.local/state/threadline/state.json` to keep project edits and session links. Threadline honors `XDG_STATE_HOME` and supports `--data PATH` for a custom location.

## Develop

```bash
python3 -m unittest discover -s tests -v
python3 scripts/build_release.py
```

The build writes a Python archive and SHA-256 checksum under `dist/`. Both the application and the build use the Python standard library.

[MIT License](LICENSE)
