import { createConvertUI, showSuccessView, showProgressView, showErrorView, fileToArrayBuffer, downloadBlob, backendStatusFieldHTML, refreshBackendStatus, convertViaBackend } from './convert-shared.js';

// ==========================================
// PDF TO MARKDOWN
// ==========================================
export function initPdfToMarkdown(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF file here',
    subtitle: 'Parse PDF structure and extract styled Markdown text (.md)',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-md',
    multiple: false,
    settingsHTML: backendStatusFieldHTML()
  });

  let fileBuffer = null;
  let file = null;

  refreshBackendStatus(container);

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(f) {
    file = f;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.fileName.innerText = file.name;
    ui.fileMeta.innerText = 'PDF loaded. Ready to compile Markdown.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
    refreshBackendStatus(container);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;

    const backend = await refreshBackendStatus(container);

    if (!backend.ok) {
      showErrorView(container, "Local Python backend is offline. Please start it using 'start.bat' (or 'uv run server.py') to enable high-fidelity PDF to Markdown conversion.", () => initPdfToMarkdown(container));
      return;
    }

    const outputName = file.name.replace(/\.pdf$/i, '') + '.md';
    await convertViaBackend(container, file, {
      endpoint: '/convert/pdf-to-markdown',
      outName: outputName,
      mime: 'text/markdown',
      title: 'PDF converted to Markdown!',
      meta: `Markdown file: <strong>${outputName}</strong> — Extracted via local Python engine (pymupdf4llm)`,
      icon: 'bi-file-earmark-code-fill',
      progressText: 'Extracting document layout (running pymupdf4llm)...',
      onReload: () => initPdfToMarkdown(container)
    });
  });
}
