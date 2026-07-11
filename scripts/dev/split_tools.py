"""One-shot helper: split multi-export tool mega-files into feature folders."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "src" / "tools"


def rewrite_imports(text: str, depth: int) -> str:
    prefix = "../" * depth
    text = re.sub(r"from\s+['\"](?:\.\./)+utils\.js['\"]", f"from '{prefix}lib/utils.js'", text)
    text = re.sub(
        r"from\s+['\"](?:\.\./)+pdfjs-setup\.js['\"]",
        f"from '{prefix}lib/pdfjs-setup.js'",
        text,
    )
    text = re.sub(r"from\s+['\"](?:\.\./)*logo\.png['\"]", f"from '{prefix}assets/logo.png'", text)
    text = re.sub(r"from\s+['\"](?:\.\./)+main\.js['\"]", f"from '{prefix}main.js'", text)
    return text


NAME_MAP = {
    "initOrganize": "organize.js",
    "initRotate": "rotate.js",
    "initCrop": "crop.js",
    "initPageNumbers": "page-numbers.js",
    "initWatermark": "watermark.js",
    "initEditPdf": "edit-pdf.js",
    "initSign": "sign.js",
    "initProtect": "protect.js",
    "initUnlock": "unlock.js",
    "initRedact": "redact.js",
    "initRepair": "repair.js",
    "initPdfA": "pdf-a.js",
    "initSummarizer": "summarizer.js",
    "initTranslate": "translate.js",
    "initOcr": "ocr.js",
    "initCompare": "compare.js",
    "initForms": "forms.js",
    "initScan": "scan.js",
}


def split_tool_file(path: Path, folder: Path, shared_name: str = "shared.js") -> None:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)

    export_idxs: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        m = re.match(r"export function (init\w+)\s*\(", line)
        if m:
            export_idxs.append((i, m.group(1)))
    if not export_idxs:
        print(f"No exports in {path}")
        return

    folder.mkdir(parents=True, exist_ok=True)

    shared_raw = "".join(lines[: export_idxs[0][0]])
    shared_raw = rewrite_imports(shared_raw, depth=2)

    # Export top-level helpers from shared so tool files can import them.
    shared_lines_out: list[str] = []
    for line in shared_raw.splitlines(keepends=True):
        if re.match(r"^(async\s+)?function\s+\w+", line) and not line.lstrip().startswith("export "):
            line = "export " + line
        shared_lines_out.append(line)
    shared_text = "".join(shared_lines_out)
    if not shared_text.endswith("\n"):
        shared_text += "\n"
    (folder / shared_name).write_text(shared_text, encoding="utf-8")

    exported = set(re.findall(r"^export (?:async )?function (\w+)", shared_text, re.M))
    exported |= set(re.findall(r"^export const (\w+)", shared_text, re.M))
    # module-level helpers without export that start with load
    for m in re.finditer(r"^(?:export )?(?:async )?function (load\w+)", shared_text, re.M):
        exported.add(m.group(1))

    reexports: list[tuple[str, str]] = []
    for idx, (start, name) in enumerate(export_idxs):
        end = export_idxs[idx + 1][0] if idx + 1 < len(export_idxs) else len(lines)
        body = "".join(lines[start:end]).rstrip() + "\n"

        needed_shared = sorted({sym for sym in exported if re.search(rf"\b{sym}\b", body)})
        lib_utils = [
            u
            for u in (
                "downloadBlob",
                "formatBytes",
                "fileToArrayBuffer",
                "renderPDFPageToCanvas",
                "renderPDFPageToObjectUrl",
                "pdfjsDataFromBuffer",
                "yieldToUI",
                "releaseCanvas",
                "canvasToBlob",
                "downloadZipOfFiles",
                "loadScript",
            )
            if re.search(rf"\b{u}\b", body)
        ]

        import_lines: list[str] = []
        if lib_utils:
            import_lines.append("import {\n  " + ",\n  ".join(lib_utils) + "\n} from '../../lib/utils.js';\n")
        if re.search(r"\bpdfjsLib\b", body):
            import_lines.append("import { pdfjsLib } from '../../lib/pdfjs-setup.js';\n")

        if folder.name == "security":
            pdflib_syms = [s for s in ("PDFDocument", "rgb", "PDFName") if re.search(rf"\b{s}\b", body)]
            if pdflib_syms:
                import_lines.append(f"import {{ {', '.join(pdflib_syms)} }} from 'pdf-lib';\n")
            if re.search(r"\bCantooPDFDocument\b", body):
                import_lines.append(
                    "import { PDFDocument as CantooPDFDocument } from '@cantoo/pdf-lib';\n"
                )
            if re.search(r"\bencryptPDF\b", body):
                import_lines.append("import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';\n")
        else:
            pdflib_syms = [
                s
                for s in ("PDFDocument", "StandardFonts", "rgb", "degrees", "PDFName")
                if re.search(rf"\b{s}\b", body)
            ]
            if pdflib_syms:
                import_lines.append(f"import {{ {', '.join(pdflib_syms)} }} from 'pdf-lib';\n")

        if re.search(r"\bTesseract\b", body):
            import_lines.append("import Tesseract from 'tesseract.js';\n")
        if re.search(r"\bstate\b", body) and "state" not in body[: body.find("{") if "{" in body else 0]:
            # crude: if state. is used
            if re.search(r"\bstate\.", body):
                import_lines.append("import { state } from '../../main.js';\n")
        if re.search(r"\blogoUrl\b", body):
            import_lines.append("import logoUrl from '../../assets/logo.png';\n")
        if needed_shared:
            import_lines.append(
                f"import {{ {', '.join(needed_shared)} }} from './{shared_name}';\n"
            )

        file_name = NAME_MAP.get(name, re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", name).lower() + ".js")
        content = "".join(import_lines) + "\n" + body
        (folder / file_name).write_text(content, encoding="utf-8")
        reexports.append((name, file_name))
        print(f"  wrote {folder / file_name}")

    (folder / "index.js").write_text(
        "".join(f"export {{ {name} }} from './{fname}';\n" for name, fname in reexports),
        encoding="utf-8",
    )
    print(f"  wrote {folder / 'index.js'}")
    path.unlink()
    print(f"  removed {path}")


def main() -> None:
    for mega_name, folder_name in (
        ("organize.js", "organize"),
        ("edit.js", "edit"),
        ("security.js", "security"),
        ("ai.js", "ai"),
    ):
        mega = TOOLS / mega_name
        if mega.exists():
            print(f"Splitting {mega} -> {TOOLS / folder_name}/")
            split_tool_file(mega, TOOLS / folder_name)
        else:
            print(f"skip missing {mega}")


if __name__ == "__main__":
    main()
