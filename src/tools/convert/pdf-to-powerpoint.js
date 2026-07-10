import { createConvertUI, showSuccessView, showProgressView, showErrorView, fileToArrayBuffer, downloadBlob, backendStatusFieldHTML, refreshBackendStatus, convertViaBackend } from './convert-shared.js';

// ==========================================
// PDF TO POWERPOINT
// ==========================================
export function initPdfToPowerpoint(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF document here',
    subtitle: 'Extract text lines into editing PowerPoint slides (.pptx)',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-pptx',
    multiple: false,
    settingsHTML: backendStatusFieldHTML('Start the local Python server with LibreOffice installed for high-fidelity conversion.')
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
    ui.fileMeta.innerText = 'PDF readied. Click Convert below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
    refreshBackendStatus(container);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;

    const backend = await refreshBackendStatus(container);

    if (!backend.ok) {
      showErrorView(container, "Local Python backend is offline. Please start it using 'start.bat' (or 'uv run server.py') to enable high-fidelity PDF to PowerPoint conversion.", () => initPdfToPowerpoint(container));
      return;
    }

    if (!backend.libreoffice) {
      showErrorView(container, "LibreOffice is missing on the local backend. Please run 'setup.bat' or install LibreOffice on your machine to enable PowerPoint conversion.", () => initPdfToPowerpoint(container));
      return;
    }

    const outputName = file.name.replace(/\.pdf$/i, '') + '.pptx';
    await convertViaBackend(container, file, {
      endpoint: '/convert/pdf-to-powerpoint',
      outName: outputName,
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      title: 'PDF Converted to Slides!',
      meta: `PowerPoint slide deck: <strong>${outputName}</strong> — Extracted via local Python engine (LibreOffice)`,
      icon: 'bi-file-earmark-ppt-fill',
      progressText: 'Converting slides (running LibreOffice)...',
      onReload: () => initPdfToPowerpoint(container)
    });
  });
}
