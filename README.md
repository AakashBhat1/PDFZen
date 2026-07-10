# PDFZen

PDFZen is a premium, client-side, single-page web application (SPA) offering a comprehensive suite of **29 document processing tools** inspired by **iLovePDF**. Running entirely in the user's browser, PDFZen ensures that your files are processed locally and kept 100% private.

## Key Features

> [!NOTE]
> We are actively launching features! The **Organize & Optimize** suite and **PDF to Word** converter are fully functional. The remaining tools are currently in progress and will be active in a few days.

### 1. Organize & Optimize (✓ Active)
*   **Merge PDF** `[Active]`: Combine multiple PDFs into a single file in the exact order you want.
*   **Split PDF** `[Active]`: Extract specific pages/ranges, split in page-sized chunks, or split every page into a ZIP archive.
*   **Compress PDF** `[Active]`: Reduce file size while optimizing quality by downsampling page canvas sizes and re-saving them as compressed JPEG overlays.
*   **Organize PDF** `[Active]`: Visual thumbnail page editor. Drag-and-drop to sort, duplicate pages, delete pages, or insert blank sheets.
*   **Rotate PDF** `[Active]`: Rotate individual pages or batch rotate all pages at once.
*   **Crop PDF** `[Active]`: Adjust page crop bounding box margins visually.
*   **Page Numbers** `[Active]`: Stamp numbering counts into page headers or footers with custom formatting.
*   **Watermark** `[Active]`: Overlay transparent text stamps or logo images onto page layers.

### 2. Document Conversions
*   **PDF to Word** `[Active]`: Convert PDF layouts, tables, and images to Microsoft Word (.docx) via high-fidelity local python backend (pdf2docx), or client-side fallback.
*   **PDF to Excel** `[Active]`: Reconstruct spreadsheet tables and text into Excel Workbooks (.xlsx) or CSV sheets via local backend (pdfplumber + pandas), or client-side fallback.
*   **PDF to PowerPoint** `[Active]`: Convert pages to editable slide presentations (.pptx) via local backend (LibreOffice), or client-side fallback.
*   **PDF to JPG** `[Active]`: Render pages into high-resolution JPG images packaged in a ZIP or Comic Book Archive (.cbz) via local backend (PyMuPDF with custom DPI), or client-side fallback.
*   **PDF to Markdown** `[Active]`: Convert document structure to clean Markdown text (.md) via local backend (pymupdf4llm), or client-side fallback.
*   **Word to PDF** `[In Progress]`: Convert DOCX to PDF by converting it to HTML via Mammoth.js and printing it via html2pdf.js.
*   **Excel to PDF** `[In Progress]`: Convert spreadsheets to styled HTML tables and export them to PDF pages.
*   **PowerPoint to PDF** `[In Progress]`: Parse slide ZIP XML structures to layout HTML pages and print to PDF.
*   **JPG to PDF** `[In Progress]`: Compile images into a PDF with margin and layout sizing settings.
*   **HTML to PDF** `[In Progress]`: Convert raw HTML markup or webpage links to PDF sheets.

### 3. Edits & Security `[In Progress]`
*   **Edit PDF**: Visual vector overlay drawing, freehand brushes, and typing text annotations.
*   **Sign PDF**: Sign documents with a custom signatures drawing pad, drag, and resize overlays.
*   **Unlock PDF**: Decrypt password-restricted PDFs on loading and save them password-free.
*   **Protect PDF**: Password encrypt files with RC4 128-bit security via pdf-encrypt-lite.
*   **Redact PDF**: Permanent black-out box overlays to mask sensitive sections.
*   **Repair PDF**: Salvage corrupted PDF structures and rebuild xref offset indices.
*   **PDF to PDF/A**: Conformance metadata injection for ISO long-term archiving standards.

### 4. Advanced & AI Features `[In Progress]`
*   **AI Summarizer**: Structural summaries, key points, and outlines powered by Gemini 1.5 Flash.
*   **Translate PDF**: Translate document text formats directly into multiple languages using Gemini AI.
*   **OCR PDF**: Optical Character Recognition on page canvases using Tesseract.js.
*   **Compare PDF**: Side-by-side textual modifications diffing tool.
*   **Scan to PDF**: Capture frames from webcams or mobile cameras and apply document high-contrast thresholding filters.
*   **PDF Forms**: Fill interactive fields or create new textboxes and checkboxes.

---

## Hybrid Architecture & High-Fidelity Local Backend

PDFZen runs as a hybrid desktop utility:
1. **Client-Side Engine**: By default, conversions run fully in-browser using client-side JavaScript engines (Mammoth.js, pptxgenjs, pdf.js, xlsx, etc.). This ensures zero server overhead and complete privacy.
2. **Optional Local Python Backend**: To close the layout and image fidelity gap compared to cloud tools like *iLovePDF* or *Stirling-PDF*, PDFZen integrates with an optional local FastAPI backend. When running, the frontend automatically detects it via `/health` and routes conversion requests through high-performance Python libraries:
   - **PDF -> Word**: Uses `pdf2docx` to preserve complex layouts, columns, tables, and embed images.
   - **PDF -> Excel**: Uses `pdfplumber` + `pandas` to reconstruct spreadsheet tables.
   - **PDF -> PowerPoint**: Uses LibreOffice `soffice` to generate editable PPTX slides from page vectors.
   - **PDF -> JPG**: Uses PyMuPDF's fast and sharp raster rendering (with customizable DPI settings).
   - **PDF -> Markdown**: Uses `pymupdf4llm` for clean, structure-aware output.

If the backend is not running, the application silently falls back to the client-side browser engines.

---

## Technology Stack

*   **Bundler**: Vite (Vanilla JS ES modules)
*   **Styling**: Vanilla CSS (glassmorphism tokens, CSS variables, dark mode defaults)
*   **Document Engines (Dynamic CDN script loading)**:
    *   `pdf-lib` & `@cantoo/pdf-lib` (PDF structures and edits)
    *   `pdfjs-dist` (PDF rendering, text extraction)
    *   `mammoth.js` (Word parsing)
    *   `docx.js` (Word generation)
    *   `xlsx` SheetJS (Excel processing)
    *   `pptxgenjs` (PowerPoint generation)
    *   `jszip` (ZIP packages)
    *   `tesseract.js` (OCR text engine)
    *   `html2pdf.js` (HTML printing)

---

## Installation & Setup

### Option 1: One-Click Windows Setup (Recommended)

If you are on Windows, we provide automated scripts to configure your environment:

1. **Run Setup**: Double-click `setup.bat` (or run it in your terminal). This script automatically:
   - Checks for and installs Node.js and Astral `uv` if they are missing.
   - Installs all frontend dependencies (`npm install`).
   - Downloads Python 3.13 and synchronizes the backend virtual environment (`uv sync`).
2. **Start the Application**: Double-click `start.bat` (or run it in your terminal). This starts both the frontend and backend servers concurrently and automatically opens `http://localhost:3000/` in your browser.

### Option 2: Manual Setup (Cross-Platform)

If you prefer manual setup or are on a non-Windows platform:

1.  **Install Runtimes**: Ensure you have Node.js and Python (>=3.13) or `uv` installed.
2.  **Setup Frontend**:
    ```bash
    npm install
    ```
3.  **Setup Backend**:
    ```bash
    uv sync
    ```
4.  **Start Servers**:
    *   Start Backend:
        ```bash
        uv run server.py
        ```
    *   Start Frontend:
        ```bash
        npm run dev
        ```
        This will open the dashboard locally at `http://localhost:3000/`.

---

## Production Deployment

To compile the static production assets for the frontend:
```bash
npm run build
```
The compiled bundle will be outputted to `/dist` and is ready for static deployment (e.g. GitHub Pages or Vercel).

