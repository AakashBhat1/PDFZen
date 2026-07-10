"""Single subprocess gateway, ported from Stirling-PDF's ProcessExecutor (blueprint §2).

Guarantees for every external command:

* **No shell, ever** — commands are argv lists passed to
  :func:`asyncio.create_subprocess_exec`. :func:`validate_command` rejects null
  bytes, newlines, and ``..`` traversal, and confirms the executable is a real
  absolute file.
* **Per-tool concurrency limit** — an :class:`asyncio.Semaphore` keyed by a tool
  name (LibreOffice is serialized; blueprint defaults it to 1).
* **Timeout with tree-kill** — on timeout the whole process tree is killed
  (``taskkill /F /T`` on Windows, ``os.killpg`` on POSIX), because ``soffice``
  forks child processes that would otherwise survive.
* **Concurrent stdout/stderr drain** to avoid pipe-buffer deadlocks.
* **Minimal environment** to avoid leaking ambient LibreOffice profiles / display.
"""

from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
from dataclasses import dataclass

# Per-tool concurrency limits (blueprint §2 defaults, trimmed to this app's tools).
# LibreOffice must be serialized: concurrent headless soffice instances contend
# on the shared config lock unless each gets its own profile, and even then a
# single local user has no need for parallelism.
TOOL_LIMITS: dict[str, int] = {
    "libreoffice": 1,
    "default": 4,
}

# Per-tool timeouts in seconds (blueprint §2: LibreOffice 30 min; we use tighter
# local-desktop values).
TOOL_TIMEOUTS: dict[str, int] = {
    "libreoffice": 180,
    "pdf2docx": 180,
    "pdfplumber": 120,
    "pymupdf": 120,
    "default": 120,
}

_MAX_OUTPUT_BYTES = 5 * 1024 * 1024  # BoundedLineReader analogue (blueprint §2)

_semaphores: dict[str, asyncio.Semaphore] = {}


class CommandValidationError(ValueError):
    """Raised when a command fails :func:`validate_command`."""


@dataclass(frozen=True)
class CompletedProc:
    """Result of a finished subprocess."""

    returncode: int
    stdout: bytes
    stderr: bytes

    def stderr_text(self) -> str:
        return self.stderr.decode("utf-8", errors="replace").strip()


def _get_semaphore(tool: str) -> asyncio.Semaphore:
    limit = TOOL_LIMITS.get(tool, TOOL_LIMITS["default"])
    sem = _semaphores.get(tool)
    if sem is None:
        sem = asyncio.Semaphore(limit)
        _semaphores[tool] = sem
    return sem


def timeout_for(tool: str) -> int:
    return TOOL_TIMEOUTS.get(tool, TOOL_TIMEOUTS["default"])


def validate_command(cmd: list[str]) -> None:
    """Reject unsafe argv (blueprint §2 ``validateCommand``).

    * argv must be a non-empty list of strings;
    * no argument may contain a null byte, newline, or carriage return;
    * no argument may contain ``..`` path traversal;
    * the executable (argv[0]) must be an existing absolute regular file.
    """
    if not cmd or not isinstance(cmd, list):
        raise CommandValidationError("Command must be a non-empty list of strings.")

    for arg in cmd:
        if not isinstance(arg, str):
            raise CommandValidationError(f"Command argument is not a string: {arg!r}")
        if "\x00" in arg or "\n" in arg or "\r" in arg:
            raise CommandValidationError("Command argument contains a control character.")
        if ".." in arg.replace("\\", "/").split("/"):
            raise CommandValidationError(f"Command argument contains path traversal: {arg!r}")

    exe = cmd[0]
    if not os.path.isabs(exe):
        raise CommandValidationError(f"Executable must be an absolute path: {exe!r}")
    if not os.path.isfile(exe):
        raise CommandValidationError(f"Executable does not exist or is not a file: {exe!r}")


def _minimal_env() -> dict[str, str]:
    """A stripped environment carrying only what subprocesses genuinely need."""
    keys = ("PATH", "HOME", "USERPROFILE", "LANG", "LC_ALL", "SYSTEMROOT", "TEMP", "TMP")
    env = {k: os.environ[k] for k in keys if k in os.environ}
    # LibreOffice/Java under headless mode look for these; keep them if present.
    for k in ("JAVA_HOME", "HOMEDRIVE", "HOMEPATH"):
        if k in os.environ:
            env[k] = os.environ[k]
    return env


def _spawn_kwargs() -> dict:
    """Platform-specific flags so the child starts its own killable process group."""
    if sys.platform.startswith("win"):
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def _kill_tree(proc: asyncio.subprocess.Process) -> None:
    """Forcibly kill the process and all of its descendants."""
    if proc.returncode is not None:
        return
    pid = proc.pid
    try:
        if sys.platform.startswith("win"):
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                check=False,
                capture_output=True,
            )
        else:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        # Best-effort fallback: kill just the direct child.
        try:
            proc.kill()
        except ProcessLookupError:
            pass


async def run(cmd: list[str], *, tool: str, timeout_s: int | None = None) -> CompletedProc:
    """Run ``cmd`` under the given tool's semaphore and timeout.

    Raises :class:`CommandValidationError` for unsafe argv, and
    :class:`asyncio.TimeoutError` (after tree-killing) on timeout.
    """
    validate_command(cmd)
    timeout = timeout_s if timeout_s is not None else timeout_for(tool)

    async with _get_semaphore(tool):
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_minimal_env(),
            **_spawn_kwargs(),
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            _kill_tree(proc)
            # Reap the killed process so we don't leak a zombie / pending task.
            try:
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                pass
            raise asyncio.TimeoutError(
                f"'{tool}' command timed out after {timeout}s: {os.path.basename(cmd[0])}"
            )

    return CompletedProc(
        returncode=proc.returncode if proc.returncode is not None else -1,
        stdout=stdout[:_MAX_OUTPUT_BYTES],
        stderr=stderr[:_MAX_OUTPUT_BYTES],
    )
