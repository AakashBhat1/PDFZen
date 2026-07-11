"""PDFZen local conversion backend — thin FastAPI app.

Each route accepts a multipart upload, runs it inside a self-cleaning temp
directory, and streams the result back. All heavy lifting lives in
:mod:`backend.converters`; this module only wires HTTP to those functions with
consistent error handling.

Run locally with ``uv run server.py`` (or ``start.bat``). Set ``PDFZEN_RELOAD=1``
to enable uvicorn autoreload during development.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from backend import converters
from backend.libreoffice import LibreOfficeError
from backend.process_executor import CommandValidationError
from backend.runtime_paths import libreoffice_available

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("pdfzen")

# The Vite dev server runs on :3000; restrict CORS to it rather than "*".
_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
_PROXY_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Cap proxy downloads so a malicious URL cannot exhaust local memory.
_MAX_PROXY_BYTES = 25 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Reuse one httpx client for all proxy routes (connection pooling)."""
    app.state.http = httpx.AsyncClient(
        headers={"User-Agent": _PROXY_UA},
        follow_redirects=True,
        timeout=httpx.Timeout(15.0, connect=5.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    )
    try:
        yield
    finally:
        await app.state.http.aclose()


app = FastAPI(title="PDFZen Local Conversion Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_stem(filename: str | None) -> str:
    """Return a filesystem-safe base name from an untrusted upload filename."""
    name = Path(filename or "document").name
    stem = Path(name).stem or "document"
    return "".join(c for c in stem if c.isalnum() or c in (" ", "-", "_")).strip() or "document"


async def _run_conversion(file: UploadFile, converter, output_media_type: str, download_name: str):
    """Shared upload -> temp-dir -> convert -> FileResponse flow.

    ``converter`` is an async callable ``(input_path: Path, out_dir: Path) -> Path``.
    The temp directory is retained until the response is sent, then removed by the
    background task attached to :class:`FileResponse`.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file was uploaded.")

    temp_dir = tempfile.mkdtemp(prefix="pdfzen_")

    def _cleanup() -> None:
        shutil.rmtree(temp_dir, ignore_errors=True)

    try:
        stem = _safe_stem(file.filename)
        suffix = Path(file.filename or "document.pdf").suffix or ".pdf"
        input_path = Path(temp_dir) / f"{stem}{suffix}"
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")
        input_path.write_bytes(contents)

        output_path = await converter(input_path, Path(temp_dir))
        # The temp dir is removed only after the file has finished streaming.
        return FileResponse(
            str(output_path),
            media_type=output_media_type,
            filename=download_name,
            background=BackgroundTask(_cleanup),
        )
    except HTTPException:
        _cleanup()
        raise
    except (LibreOfficeError, CommandValidationError, ValueError) as exc:
        _cleanup()
        logger.warning("Conversion rejected for %s: %s", file.filename, exc)
        return JSONResponse(status_code=400, content={"detail": str(exc)})
    except asyncio.TimeoutError as exc:
        _cleanup()
        logger.error("Conversion timed out for %s: %s", file.filename, exc)
        return JSONResponse(status_code=504, content={"detail": str(exc)})
    except Exception as exc:  # noqa: BLE001 - surface a clean message, log the detail
        _cleanup()
        logger.exception("Conversion failed for %s", file.filename)
        return JSONResponse(status_code=500, content={"detail": f"Conversion failed: {exc}"})


async def _run_libreoffice_conversion(
    file: UploadFile, converter, output_media_type: str, download_name: str, tool_label: str
):
    """Like ``_run_conversion`` but returns 503 when LibreOffice is missing."""
    if not libreoffice_available():
        return JSONResponse(
            status_code=503,
            content={"detail": f"LibreOffice is required for {tool_label} but was not found."},
        )
    return await _run_conversion(file, converter, output_media_type, download_name)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "libreoffice": libreoffice_available()}


@app.post("/convert/pdf-to-word")
async def convert_pdf_to_word(file: UploadFile = File(...)):
    return await _run_conversion(
        file, converters.pdf_to_word, _DOCX_MIME, f"{_safe_stem(file.filename)}.docx"
    )


@app.post("/convert/pdf-to-excel")
async def convert_pdf_to_excel(file: UploadFile = File(...), format: str = Form("xlsx")):
    fmt = "xlsx" if format == "xlsx" else "csv"

    async def _convert(input_path: Path, out_dir: Path) -> Path:
        return await converters.pdf_to_excel(input_path, out_dir, fmt=fmt)

    media = _XLSX_MIME if fmt == "xlsx" else "text/csv"
    return await _run_conversion(file, _convert, media, f"{_safe_stem(file.filename)}.{fmt}")


@app.post("/convert/pdf-to-powerpoint")
async def convert_pdf_to_powerpoint(file: UploadFile = File(...)):
    return await _run_libreoffice_conversion(
        file,
        converters.pdf_to_powerpoint,
        _PPTX_MIME,
        f"{_safe_stem(file.filename)}.pptx",
        "PDF-to-PowerPoint",
    )


@app.post("/convert/pdf-to-markdown")
async def convert_pdf_to_markdown(file: UploadFile = File(...)):
    return await _run_conversion(
        file, converters.pdf_to_markdown, "text/markdown", f"{_safe_stem(file.filename)}.md"
    )


@app.post("/convert/pdf-to-jpg")
async def convert_pdf_to_jpg(file: UploadFile = File(...), dpi: int = Form(200)):
    dpi = max(72, min(int(dpi), 600))

    async def _convert(input_path: Path, out_dir: Path) -> Path:
        return await converters.pdf_to_jpg(input_path, out_dir, dpi=dpi)

    return await _run_conversion(
        file, _convert, "application/zip", f"{_safe_stem(file.filename)}_images.zip"
    )


@app.post("/convert/word-to-pdf")
async def convert_word_to_pdf(file: UploadFile = File(...)):
    return await _run_libreoffice_conversion(
        file,
        converters.office_to_pdf,
        "application/pdf",
        f"{_safe_stem(file.filename)}.pdf",
        "Word-to-PDF",
    )


@app.post("/convert/excel-to-pdf")
async def convert_excel_to_pdf(file: UploadFile = File(...)):
    return await _run_libreoffice_conversion(
        file,
        converters.office_to_pdf,
        "application/pdf",
        f"{_safe_stem(file.filename)}.pdf",
        "Excel-to-PDF",
    )


@app.post("/convert/powerpoint-to-pdf")
async def convert_powerpoint_to_pdf(file: UploadFile = File(...)):
    return await _run_libreoffice_conversion(
        file,
        converters.office_to_pdf,
        "application/pdf",
        f"{_safe_stem(file.filename)}.pdf",
        "PowerPoint-to-PDF",
    )


@app.get("/proxy/webpage")
async def proxy_webpage(url: str):
    """Proxy external webpages to bypass CORS for client-side loading."""
    try:
        resp = await app.state.http.get(url, timeout=15.0)
        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Failed to fetch webpage: HTTP {resp.status_code}",
            )
        return Response(content=resp.text, media_type="text/html")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Webpage proxy failed: {e}") from e


@app.get("/proxy/image")
async def proxy_image(url: str):
    """Proxy external images to bypass CORS and prevent tainted canvas in html2pdf."""
    try:
        resp = await app.state.http.get(url, timeout=10.0)
        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Failed to fetch image: HTTP {resp.status_code}",
            )
        if len(resp.content) > _MAX_PROXY_BYTES:
            raise HTTPException(status_code=413, detail="Proxied image exceeds size limit.")
        return Response(
            content=resp.content,
            media_type=resp.headers.get("content-type", "image/jpeg"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image proxy failed: {e}") from e


if __name__ == "__main__":
    import uvicorn

    reload = os.environ.get("PDFZEN_RELOAD", "0") == "1"
    uvicorn.run("server:app", host="127.0.0.1", port=5000, reload=reload)
