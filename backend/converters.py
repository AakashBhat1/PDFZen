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
    """PDF -> XLSX/CSV via layout-aware table & text extraction.
    
    Extracts text and tables in their relative visual order (top-to-bottom) per page,
    representing columns accurately and preserving the full context of the report.
    """
    input_path, out_dir = Path(input_path), Path(out_dir)
    ext = "xlsx" if fmt == "xlsx" else "csv"
    output_path = out_dir / f"{input_path.stem}.{ext}"

    def _convert() -> None:
        import pandas as pd
        import pdfplumber

        pages_data = []

        with pdfplumber.open(str(input_path)) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                tables = page.find_tables()
                words = page.extract_words()

                # Group words into lines based on vertical proximity
                lines = []
                if words:
                    words_sorted = sorted(words, key=lambda x: x["top"])
                    current_line = [words_sorted[0]]
                    for w in words_sorted[1:]:
                        if abs(w["top"] - current_line[-1]["top"]) <= 3:
                            current_line.append(w)
                        else:
                            lines.append(current_line)
                            current_line = [w]
                    lines.append(current_line)

                # Filter out lines that lie inside any table bounding box
                filtered_lines = []
                for line in lines:
                    avg_top = sum(w["top"] for w in line) / len(line)
                    in_table = False
                    for t in tables:
                        if t.bbox[1] - 1 <= avg_top <= t.bbox[3] + 1:
                            in_table = True
                            break
                    if not in_table:
                        filtered_lines.append((avg_top, line))

                # Reconstruct cells for text lines by splitting on horizontal gaps
                elements = []
                for avg_top, line in filtered_lines:
                    sorted_line = sorted(line, key=lambda x: x["x0"])
                    row_cells = []
                    current_cell = [sorted_line[0]["text"]]
                    for idx in range(1, len(sorted_line)):
                        w_prev = sorted_line[idx - 1]
                        w_curr = sorted_line[idx]
                        gap = w_curr["x0"] - w_prev["x1"]
                        if gap > 15:
                            row_cells.append(" ".join(current_cell))
                            current_cell = [w_curr["text"]]
                        else:
                            current_cell.append(w_curr["text"])
                    row_cells.append(" ".join(current_cell))
                    elements.append((avg_top, row_cells))

                # Add tables
                for t in tables:
                    elements.append((t.bbox[1], t.extract()))

                # Sort all elements on the page from top to bottom
                elements.sort(key=lambda x: x[0])

                # Construct the final row list for the page
                page_rows = []
                for _, el in elements:
                    if isinstance(el[0], list):
                        # Table: append each row of the table
                        for row in el:
                            page_rows.append([("" if val is None else str(val)) for val in row])
                    else:
                        # Text line: append as a single row
                        page_rows.append(el)

                if page_rows:
                    pages_data.append((f"Page {page_idx + 1}", pd.DataFrame(page_rows)))

        if not pages_data:
            raise ValueError("No text or tables could be extracted from this PDF.")

        if ext == "xlsx":
            with pd.ExcelWriter(str(output_path), engine="openpyxl") as writer:
                for name, df in pages_data:
                    df.to_excel(writer, sheet_name=name, index=False, header=False)
        else:
            combined_df = pd.concat([df for _, df in pages_data], ignore_index=True)
            combined_df.to_csv(str(output_path), index=False, header=False)

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
