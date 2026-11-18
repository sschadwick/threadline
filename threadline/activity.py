"""Read live session state without starting or resuming a session."""

import base64
import hashlib
import json
import os
import socket
import struct
import subprocess
import time

from . import __version__
from .history import UUID


def claude_activity(directory):
    result = subprocess.run(["claude", "agents", "--json", "--all"], capture_output=True, check=True, timeout=3,
                            env={**os.environ, "CLAUDE_CONFIG_DIR": str(directory)})
    states = {}
    entries = json.loads(result.stdout)
    if not isinstance(entries, list):
        raise ValueError("Invalid Claude Code session status")
    for entry in entries:
        identity = entry.get("sessionId")
        if not isinstance(identity, str) or not UUID.fullmatch(identity):
            continue
        status, state = entry.get("status"), entry.get("state")
        if state == "blocked" or entry.get("waitingFor") or status == "blocked":
            activity = "needs_input"
        elif state == "working" or status == "busy":
            activity = "working"
        elif status == "idle":
            activity = "idle"
        else:
            activity = "saved"
        states[identity] = activity
    return states


class CodexConnection:
    """The App Server uses standard WebSocket frames on its local Unix socket."""

    def __init__(self, connection, stream):
        self.connection = connection
        self.stream = stream
        self.deadline = time.monotonic() + 3
        self.request_id = 0
        nonce = base64.b64encode(os.urandom(16))
        connection.sendall(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\n"
                           b"Upgrade: websocket\r\nSec-WebSocket-Version: 13\r\n"
                           b"Sec-WebSocket-Key: " + nonce + b"\r\n\r\n")
        if stream.readline(256).split()[1:2] != [b"101"]:
            raise ValueError("Codex App Server refused the WebSocket handshake")
        expected = base64.b64encode(hashlib.sha1(nonce + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
        headers = []
        for _ in range(32):
            header = stream.readline(4096)
            if header == b"\r\n":
                break
            name, _, value = header.partition(b":")
            headers.append((name.lower(), value.strip()))
        else:
            raise ValueError("Codex App Server sent an invalid handshake")
        if (b"sec-websocket-accept", expected) not in headers:
            raise ValueError("Codex App Server sent an invalid WebSocket key")

    def send(self, payload, opcode=1):
        length = len(payload)
        size = bytes([128 | length]) if length < 126 else b"\xfe" + struct.pack("!H", length)
        mask = os.urandom(4)
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.connection.sendall(bytes([128 | opcode]) + size + mask + masked)

    def receive(self):
        message = bytearray()
        while True:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Codex App Server did not respond")
            self.connection.settimeout(remaining)
            header = self.stream.read(2)
            if len(header) != 2:
                raise EOFError("Codex App Server disconnected")
            opcode = header[0] & 15
            size = header[1]
            if size == 126:
                size = int.from_bytes(self.stream.read(2))
            elif size == 127:
                size = int.from_bytes(self.stream.read(8))
            if header[1] & 128 or size + len(message) > 512 * 1024 or opcode == 8:
                raise ValueError("Invalid Codex App Server frame")
            payload = self.stream.read(size)
            if opcode == 9:
                self.send(payload, opcode=10)
            elif opcode in (0, 1):
                message.extend(payload)
                if header[0] & 128:
                    return json.loads(message)

    def request(self, method, params=None):
        self.request_id += 1
        self.send(json.dumps({"id": self.request_id, "method": method, "params": params or {}}).encode())
        while True:
            message = self.receive()
            if message.get("id") == self.request_id:
                return message.get("result", {})


def codex_activity(path):
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(2)
        connection.connect(str(path))
        with connection.makefile("rb") as stream:
            client = CodexConnection(connection, stream)
            initialized = client.request("initialize", {"clientInfo": {
                "name": "threadline", "title": "Threadline", "version": __version__,
            }})
            if not initialized:
                raise ValueError("Could not initialize Codex App Server")
            client.send(b'{"method":"initialized"}')
            states = {}
            for identity in client.request("thread/loaded/list")["data"]:
                if not isinstance(identity, str) or not UUID.fullmatch(identity):
                    continue
                status = client.request("thread/read", {"threadId": identity}).get("thread", {}).get("status", {})
                kind = status.get("type")
                if kind == "active":
                    flags = status.get("activeFlags") or []
                    states[identity] = ("needs_input" if any(str(flag).startswith("waitingOn") for flag in flags)
                                        else "working")
                elif kind == "idle":
                    states[identity] = "idle"
                elif kind != "notLoaded":
                    states[identity] = "unknown"
            return states


def read_activity(rows, sources, claude_dir, codex_socket):
    for source, read in (("claude", lambda: claude_activity(claude_dir)), ("codex", lambda: codex_activity(codex_socket))):
        observed = None
        if source == "claude" or codex_socket is not None:
            try:
                observed = read()
            except (OSError, ValueError, TypeError, AttributeError, KeyError, EOFError, subprocess.SubprocessError):
                pass
        sources[source]["activity_available"] = observed is not None
        for row in rows:
            if row["source"] == source:
                row["activity"] = observed.get(row["id"], "saved") if observed is not None else "unknown"
