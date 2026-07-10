"""Sandboxed LibreOffice CLI conversion (blueprint §3, §4).

Uses self-contained ``soffice --headless --convert-to`` per request rather than
the unoserver/unoconvert pool: this is a local, single-user tool with no
concurrency pressure, and ``python-uno`` bindings are awkward on Windows. The
blueprint itself treats per-request ``soffice`` as the correctness path; a pool
can be layered on later behind :mod:`backend.process_executor` if needed.

Each conversion gets its own randomized ``UserInstallation`` profile so
concurrent runs never contend on LibreOffice's config lock, and the profile is
always removed afterwards.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from . import process_executor as pe
from .runtime_paths import get_soffice_path

# Import filters for PDF-source conversions (blueprint §3 filter map).
INPUT_FILTERS: dict[str, str] = {
    "pptx": "impress_pdf_import",
    "odp": "impress_pdf_import",
    "docx": "writer_pdf_import",
    "odt": "writer_pdf_import",
}


class LibreOfficeError(RuntimeError):
    """Raised when LibreOffice is unavailable or the conversion fails."""


async def convert(
    input_path: str | Path,
    out_ext: str,
    *,
    infilter: str | None = None,
    out_dir: str | Path | None = None,
) -> Path:
    """Convert ``input_path`` to ``out_ext`` via headless LibreOffice.

    ``infilter`` overrides the default input filter for ``out_ext``. Returns the
    path to the produced file (written into ``out_dir``, defaulting to the
    input's directory). Raises :class:`LibreOfficeError` on any failure.
    """
    soffice = get_soffice_path()
    if soffice is None:
        raise LibreOfficeError(
            "LibreOffice (soffice) was not found. Install it (setup.ps1) or set SOFFICE_PATH."
        )

    input_path = Path(input_path).resolve()
    if not input_path.is_file():
        raise LibreOfficeError(f"Input file does not exist: {input_path}")

    out_dir = Path(out_dir).resolve() if out_dir else input_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    chosen_filter = infilter if infilter is not None else INPUT_FILTERS.get(out_ext)

    # Per-conversion profile so concurrent soffice runs don't share config state.
    profile = Path(tempfile.mkdtemp(prefix="lo_profile_"))
    try:
        cmd = [
            soffice,
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--norestore",
            f"-env:UserInstallation={profile.as_uri()}",
        ]
        if chosen_filter:
            cmd.append(f"--infilter={chosen_filter}")
        cmd += ["--convert-to", out_ext, "--outdir", str(out_dir), str(input_path)]

        result = await pe.run(cmd, tool="libreoffice")

        expected = out_dir / f"{input_path.stem}.{out_ext}"
        if result.returncode != 0 or not expected.is_file():
            detail = result.stderr_text() or f"exit code {result.returncode}"
            raise LibreOfficeError(f"LibreOffice conversion failed: {detail}")

        return expected
    finally:
        shutil.rmtree(profile, ignore_errors=True)
