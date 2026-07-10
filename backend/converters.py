"""Per-format conversion functions.

Each function takes an input path and an output *directory* and returns the path
to the produced file. Blocking library calls (pdf2docx, pdfplumber, PyMuPDF) run
in a worker thread so the FastAPI event loop stays responsive; LibreOffice runs
through :mod:`backend.process_executor`.

Engine choice per conversion (see plan / blueprint):
* PDF->Word     : ``pdf2docx`` (most editable, layout-preserving; keeps images).
* PDF->Excel    : ``pdfplumber`` table extraction + ``pandas``.
* PDF->PowerPoint: LibreOffice ``impress_pdf_import`` (editable slides).
* PDF->Markdown : ``pymupdf4llm`` if available, else PyMuPDF markdown text.
* PDF->JPG      : PyMuPDF page pixmaps zipped.
"""

from __future__ import annotations

import asyncio
import zipfile
from pathlib import Path

from . import libreoffice

# openpyxl sheet names are capped at 31 characters.
_MAX_SHEET_NAME = 31


async def pdf_to_word(input_path: str | Path, out_dir: str | Path) -> Path:
    """PDF -> DOCX via pdf2docx (preserves layout, tables, and embedded images)."""
    input_path, out_dir = Path(input_path), Path(out_dir)
    output_path = out_dir / f"{input_path.stem}.docx"

    def _convert() -> None:
        from pdf2docx import Converter

        cv = Converter(str(input_path))
        try:
            # multi_processing is unsafe inside an async worker thread; keep it off.
            cv.convert(str(output_path), start=0, end=None, multi_processing=False)
        finally:
            cv.close()

    await asyncio.to_thread(_convert)
    if not output_path.is_file():
        raise RuntimeError("PDF-to-Word conversion did not produce an output file.")
    return output_path


async def pdf_to_excel(
    input_path: str | Path, out_dir: str | Path, *, fmt: str = "xlsx"
) -> Path:
    """PDF -> XLSX/CSV via pdfplumber table extraction (text fallback if no tables)."""
    input_path, out_dir = Path(input_path), Path(out_dir)
    ext = "xlsx" if fmt == "xlsx" else "csv"
    output_path = out_dir / f"{input_path.stem}.{ext}"

    def _convert() -> None:
        import pandas as pd
        import pdfplumber

        tables: list[tuple[str, "pd.DataFrame"]] = []
        with pdfplumber.open(str(input_path)) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                for table_idx, table in enumerate(page.extract_tables()):
                    if table:
                        tables.append(
                            (f"P{page_idx + 1}_T{table_idx + 1}", pd.DataFrame(table))
                        )

        # Fallback: no tables detected -> dump text lines split on whitespace.
        if not tables:
            rows: list[list[str]] = []
            with pdfplumber.open(str(input_path)) as pdf:
                for page in pdf.pages:
                    text = page.extract_text() or ""
                    rows.extend(line.split() for line in text.split("\n") if line)
            if rows:
                tables.append(("Extracted Text", pd.DataFrame(rows)))

        if not tables:
            raise ValueError("No text or tables could be extracted from this PDF.")

        if ext == "xlsx":
            with pd.ExcelWriter(str(output_path), engine="openpyxl") as writer:
                for name, df in tables:
                    df.to_excel(
                        writer, sheet_name=name[:_MAX_SHEET_NAME], index=False, header=False
                    )
        else:
            pd.concat([df for _, df in tables], ignore_index=True).to_csv(
                str(output_path), index=False, header=False
            )

    await asyncio.to_thread(_convert)
    if not output_path.is_file():
        raise RuntimeError("PDF-to-Excel conversion did not produce an output file.")
    return output_path


async def pdf_to_powerpoint(input_path: str | Path, out_dir: str | Path) -> Path:
    """PDF -> PPTX via LibreOffice (each PDF page becomes an editable slide)."""
    return await libreoffice.convert(
        input_path, "pptx", infilter="impress_pdf_import", out_dir=out_dir
    )


async def pdf_to_markdown(input_path: str | Path, out_dir: str | Path) -> Path:
    """PDF -> Markdown, preferring pymupdf4llm for structure-aware output."""
    input_path, out_dir = Path(input_path), Path(out_dir)
    output_path = out_dir / f"{input_path.stem}.md"

    def _convert() -> str:
        try:
            import pymupdf4llm

            return pymupdf4llm.to_markdown(str(input_path))
        except ImportError:
            # Safety fallback if pymupdf4llm is unavailable: plain text per page.
            # PyMuPDF has no "markdown" text format, so use "text" and separate pages.
            import fitz  # PyMuPDF

            parts: list[str] = []
            with fitz.open(str(input_path)) as doc:
                for page in doc:
                    parts.append(page.get_text("text").strip())
            return "\n\n---\n\n".join(p for p in parts if p)

    markdown = await asyncio.to_thread(_convert)
    if not markdown.strip():
        raise ValueError("No extractable text was found in this PDF.")
    output_path.write_text(markdown, encoding="utf-8")
    return output_path


async def pdf_to_jpg(
    input_path: str | Path, out_dir: str | Path, *, dpi: int = 200
) -> Path:
    """PDF -> ZIP of per-page JPEG images rendered by PyMuPDF at ``dpi``."""
    input_path, out_dir = Path(input_path), Path(out_dir)
    output_path = out_dir / f"{input_path.stem}_images.zip"

    def _convert() -> None:
        import fitz  # PyMuPDF

        with fitz.open(str(input_path)) as doc, zipfile.ZipFile(
            output_path, "w", zipfile.ZIP_DEFLATED
        ) as archive:
            if doc.page_count == 0:
                raise ValueError("The PDF has no pages to render.")
            for page_idx in range(doc.page_count):
                pix = doc[page_idx].get_pixmap(dpi=dpi)
                archive.writestr(
                    f"{input_path.stem}_page_{page_idx + 1:03d}.jpg",
                    pix.tobytes("jpg"),
                )

    await asyncio.to_thread(_convert)
    if not output_path.is_file():
        raise RuntimeError("PDF-to-JPG conversion did not produce an output file.")
    return output_path
