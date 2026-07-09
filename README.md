# PDFZen

PDFZen is a premium, client-side, single-page web application (SPA) offering a comprehensive suite of **29 document processing tools** inspired by **iLovePDF**. Running entirely in the user's browser, PDFZen ensures that your files are processed locally and kept 100% private.

## Key Features

### 1. Organize & Optimize
*   **Merge PDF**: Combine multiple PDFs into a single file in the exact order you want.
*   **Split PDF**: Extract specific pages/ranges, split in page-sized chunks, or split every page into a ZIP archive.
*   **Compress PDF**: Reduce file size while optimizing quality by downsampling page canvas sizes and re-saving them as compressed JPEG overlays.
*   **Organize PDF**: Visual thumbnail page editor. Drag-and-drop to sort, duplicate pages, delete pages, or insert blank sheets.
*   **Rotate PDF**: Rotate individual pages or batch rotate all pages at once.
*   **Crop PDF**: Adjust page crop bounding box margins visually.
*   **Page Numbers**: Stamp numbering counts into page headers or footers with custom formatting.
*   **Watermark**: Overlay transparent text stamps or logo images onto page layers.

### 2. Document Conversions
*   **PDF to Word**: Extract text content and structure it into Microsoft Word (.docx) paragraphs.
*   **Word to PDF**: Convert DOCX to PDF by converting it to HTML via Mammoth.js and printing it via html2pdf.js.
*   **PDF to Excel**: Parse table grids from PDF texts and compile them into Excel sheets (.xlsx).
*   **Excel to PDF**: Convert spreadsheets to styled HTML tables and export them to PDF pages.
*   **PDF to PowerPoint**: Generate Slide decks from extracted text headers using PptxGenJS.
*   **PowerPoint to PDF**: Parse slide ZIP XML structures to layout HTML pages and print to PDF.
*   **PDF to JPG**: Export each PDF page as an individual JPEG and package them into a ZIP file.
*   **JPG to PDF**: Compile images into a PDF with margin and layout sizing settings.
*   **PDF to Markdown**: Parse text formats into structural Markdown files (.md).
*   **HTML to PDF**: Convert raw HTML markup or webpage links to PDF sheets.

### 3. Edits & Security
*   **Edit PDF**: Visual vector overlay drawing, freehand brushes, and typing text annotations.
*   **Sign PDF**: Sign documents with a custom signatures drawing pad, drag, and resize overlays.
*   **Unlock PDF**: Decrypt password-restricted PDFs on loading and save them password-free.
*   **Protect PDF**: Password encrypt files with RC4 128-bit security via pdf-encrypt-lite.
*   **Redact PDF**: Permanent black-out box overlays to mask sensitive sections.
*   **Repair PDF**: Salvage corrupted PDF structures and rebuild xref offset indices.
*   **PDF to PDF/A**: Conformance metadata injection for ISO long-term archiving standards.

### 4. Advanced & AI Features
*   **AI Summarizer**: Structural summaries, key points, and outlines powered by Gemini 1.5 Flash.
*   **Translate PDF**: Translate document text formats directly into multiple languages using Gemini AI.
*   **OCR PDF**: Optical Character Recognition on page canvases using Tesseract.js.
*   **Compare PDF**: Side-by-side textual modifications diffing tool.
*   **Scan to PDF**: Capture frames from webcams or mobile cameras and apply document high-contrast thresholding filters.
*   **PDF Forms**: Fill interactive fields or create new textboxes and checkboxes.

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

1.  **Clone/Open project**: Ensure you are in the project folder containing `package.json`.
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Start Development Server**:
    ```bash
    npm run dev
    ```
    This will open the dashboard locally at `http://localhost:3000/`.
4.  **Build Production Bundle**:
    ```bash
    npm run build
    ```
    The compiled bundle will be outputted to `/dist` and is ready for static deployment (e.g. GitHub Pages or Vercel).
