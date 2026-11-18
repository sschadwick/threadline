"""Run a single bounded, read-only provider session on the Threadline host."""

import json
import os
import selectors
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from threading import Event
from uuid import UUID

from .kickoff import required_text


TIMEOUT_SECONDS = 300
MAX_OUTPUT = 2 * 1024 * 1024
RESULT_FIELDS = {
    "checkpoint": {"summary": 2400, "next": 800, "source": 220},
    "decision": {"choice": 600, "rationale": 1600, "source": 400},
}
PROVIDERS = {"codex": "Codex", "claude": "Claude Code"}
ENVIRONMENT = {
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL",
    "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME",
    "CODEX_HOME", "CLAUDE_CONFIG_DIR", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
}


def object_schema(properties):
    return {"type": "object", "properties": properties,
            "required": list(properties), "additionalProperties": False}


RESULT_SCHEMA = object_schema({
    "summary": {"type": "string", "description": "Summarize findings and cite concrete evidence."},
    **{name: {"anyOf": [object_schema({field: {"type": "string"} for field in fields}), {"type": "null"}]}
       for name, fields in RESULT_FIELDS.items()},
})


class RunError(RuntimeError):
    pass


class Runner:
    def __init__(self, providers=(), workspaces=()):
        self.stop = Event()
        self.commands = {}
        self.workspaces = []
        if providers and (os.name != "posix" or not workspaces):
            raise ValueError("Session launch requires a POSIX host and at least one --runner-workspace.")
        for provider in providers:
            command = shutil.which(provider)
            if command is None:
                raise ValueError(f"Install and authenticate {PROVIDERS[provider]} on the Threadline host.")
            self.commands[provider] = str(Path(command).absolute())
        for path in workspaces:
            path = path.expanduser().resolve()
            if not path.is_dir():
                raise ValueError("Each runner workspace must be an existing directory.")
            self.workspaces.append(str(path))

    def options(self):
        return {"providers": list(self.commands), "workspaces": sorted(set(self.workspaces))}

    def run(self, run):
        workspace = Path(run["workspace"])
        if str(workspace.resolve(strict=True)) != str(workspace) or str(workspace) not in self.workspaces:
            raise RunError("The approved workspace changed before launch.")
        output = self.execute(run["provider"], workspace, run["brief"], RESULT_SCHEMA, session_id=run["id"])
        return parse_result(run["provider"], output)

    def draft(self, provider, brief, schema):
        if provider not in self.commands:
            raise ValueError("Choose an enabled AI provider.")
        output = self.execute(provider, None, brief, schema, draft=True)
        return parse_response(provider, output)[1]

    def execute(self, provider, workspace, brief, result_schema, *, draft=False, session_id=None):
        executable = str(Path(self.commands[provider]).resolve(strict=True))
        schema = json.dumps(result_schema)
        with tempfile.TemporaryDirectory(prefix="threadline-run-") as scratch:
            workspace = workspace or Path(scratch)
            if provider == "codex":
                schema_path = Path(scratch) / "result.json"
                schema_path.write_text(schema, encoding="utf-8")
                readable_paths = (json.dumps(path, ensure_ascii=False) for path in (str(workspace), executable))
                filesystem = '{":root"="deny",":minimal"="read",' + ",".join(
                    f'{path}="read"' for path in readable_paths
                ) + "}"
                arguments = [
                    "--strict-config", "--ask-for-approval", "never", "--disable", "hooks", "--disable", "apps",
                    "--disable", "plugins", "--disable", "multi_agent", "--disable", "multi_agent_v2",
                    "-c", "mcp_servers={}", "-c", 'web_search="disabled"',
                    "-c", 'default_permissions="threadline_read_only"',
                    "-c", f"permissions.threadline_read_only.filesystem={filesystem}",
                    "-c", "permissions.threadline_read_only.network.enabled=false",
                    "-c", 'shell_environment_policy.inherit="none"',
                    "exec", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--json",
                    "--output-schema", str(schema_path), "-",
                ]
                if draft:
                    arguments[0:0] = ["-c", 'forced_login_method="chatgpt"']
                    arguments.insert(arguments.index("--json"), "--ephemeral")
            else:
                arguments = [
                    "--print", "--output-format", "json", "--restricted", "--strict-mcp-config",
                    "--safe-mode", "--disable-slash-commands", "--tools", "Read,Glob,Grep",
                    "--permission-mode", "plan", "--max-turns", "8", "--json-schema", schema,
                ]
                if draft:
                    arguments[arguments.index("--tools") + 1] = ""
                    arguments[arguments.index("--max-turns") + 1] = "2"
                    arguments.append("--no-session-persistence")
                elif session_id is not None:
                    arguments.extend(["--session-id", str(UUID(hex=session_id))])
            options = {"timeout": 90, "subscription_only": True} if draft else {}
            return self.capture([executable, *arguments], workspace, brief, scratch, **options)

    def capture(self, command, workspace, brief, scratch, *, timeout=TIMEOUT_SECONDS, subscription_only=False):
        if self.stop.is_set():
            raise RunError("Threadline stopped the session.")
        environment = {key: value for key, value in os.environ.items() if key in ENVIRONMENT}
        if subscription_only:
            environment.pop("OPENAI_API_KEY", None)
            environment.pop("ANTHROPIC_API_KEY", None)
        output = bytearray()
        deadline = time.monotonic() + timeout
        with tempfile.TemporaryFile(dir=scratch) as prompt:
            prompt.write(brief.encode())
            prompt.seek(0)
            with subprocess.Popen(command, cwd=workspace, env=environment, stdin=prompt,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True) as child:
                try:
                    with selectors.DefaultSelector() as selector:
                        selector.register(child.stdout, selectors.EVENT_READ)
                        while selector.get_map():
                            if self.stop.is_set():
                                raise RunError("Threadline stopped the session.")
                            if time.monotonic() >= deadline:
                                raise RunError(f"Session exceeded the {timeout}-second limit.")
                            if selector.select(timeout=0.25):
                                chunk = os.read(child.stdout.fileno(), 65536)
                                if not chunk:
                                    break
                                output.extend(chunk)
                                if len(output) > MAX_OUTPUT:
                                    raise RunError("Session output exceeded the capture limit.")
                    while child.poll() is None:
                        if self.stop.wait(0.25):
                            raise RunError("Threadline stopped the session.")
                        if time.monotonic() >= deadline:
                            raise RunError(f"Session exceeded the {timeout}-second limit.")
                    if child.returncode:
                        raise RunError(f"The runner exited with code {child.returncode}. Check the CLI on this host.")
                finally:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
        return output


def parse_response(provider, output):
    if provider == "codex":
        session_id = None
        result = None
        completed = False
        for line in output.splitlines():
            event = json.loads(line)
            if event["type"] == "thread.started":
                session_id = event["thread_id"]
            elif event["type"] == "item.completed" and event["item"]["type"] == "agent_message":
                result = event["item"]["text"]
            elif event["type"] == "turn.completed":
                completed = True
        if not completed or not result:
            raise RunError("Codex did not return a completed result.")
        result = json.loads(result)
    else:
        event = json.loads(output)
        if event.get("type") != "result" or event.get("is_error"):
            raise RunError("Claude Code did not return a completed result.")
        session_id, result = event.get("session_id"), event.get("structured_output")
    if not isinstance(session_id, str) or not isinstance(result, dict):
        raise RunError("The runner returned an incomplete session result.")
    session_id = str(UUID(session_id))
    return session_id, result


def parse_result(provider, output):
    session_id, result = parse_response(provider, output)
    clean = {"summary": required_text(result, "summary", 4000)}
    for name, fields in RESULT_FIELDS.items():
        proposal = result.get(name)
        if proposal is not None and not isinstance(proposal, dict):
            raise ValueError("Invalid proposal")
        clean[name] = ({field: required_text(proposal, field, limit) for field, limit in fields.items()}
                       if proposal is not None else None)
    return session_id, clean
