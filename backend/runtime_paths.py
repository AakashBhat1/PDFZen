"""Binary path resolution (LibreOffice), mirroring the blueprint's RuntimePathConfig.

Resolution order for ``soffice`` (blueprint note 876 / §6):
1. ``SOFFICE_PATH`` environment variable (explicit override).
2. ``soffice`` / ``soffice.exe`` on ``PATH``.
3. Well-known install locations per platform.

The result is cached; call :func:`refresh_soffice_path` to re-detect after an
install (e.g. right after ``setup.ps1`` installs LibreOffice).
"""

from __future__ import annotations

import os
import shutil
import sys
from functools import lru_cache
from pathlib import Path

_ENV_OVERRIDE = "SOFFICE_PATH"

# Well-known install locations, checked in order, per platform.
_WINDOWS_CANDIDATES = (
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
)
_MACOS_CANDIDATES = (
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
)
_LINUX_CANDIDATES = (
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/opt/libreoffice/program/soffice",
    "/snap/bin/libreoffice",
)


def _platform_candidates() -> tuple[str, ...]:
    if sys.platform.startswith("win"):
        return _WINDOWS_CANDIDATES
    if sys.platform == "darwin":
        return _MACOS_CANDIDATES
    return _LINUX_CANDIDATES


@lru_cache(maxsize=1)
def get_soffice_path() -> str | None:
    """Return an absolute path to the LibreOffice ``soffice`` executable, or None."""
    override = os.environ.get(_ENV_OVERRIDE)
    if override and Path(override).is_file():
        return str(Path(override).resolve())

    on_path = shutil.which("soffice") or shutil.which("soffice.exe")
    if on_path:
        return str(Path(on_path).resolve())

    for candidate in _platform_candidates():
        if Path(candidate).is_file():
            return str(Path(candidate).resolve())

    return None


def refresh_soffice_path() -> str | None:
    """Clear the cache and re-detect ``soffice`` (use after an install)."""
    get_soffice_path.cache_clear()
    return get_soffice_path()


def libreoffice_available() -> bool:
    """True when a usable ``soffice`` executable was found."""
    return get_soffice_path() is not None
