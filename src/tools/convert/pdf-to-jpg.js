import { createConvertUI, showErrorView, backendStatusFieldHTML, refreshBackendStatus, convertViaBackend } from './convert-shared.js';

// ==========================================
// PDF TO JPG / CBZ
// ==========================================
export function initPdfToJpg(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF document here',
    subtitle: 'Render each PDF page to individual JPG images or a CBZ archive',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-jpg',
    multiple: false,
    settingsHTML: `
      <div class="form-group">
        <label for="pdf-jpg-format">Output Format</label>
        <select id="pdf-jpg-format" class="form-control">
          <option value="zip">ZIP Archive (JPG Images)</option>
          <option value="cbz">Comic Book Archive (.cbz)</option>
        </select>
        <span class="form-help" style="margin-top: 0.4rem; display: block;">
          <strong>ZIP Archive</strong>: A standard folder of JPG files.<br>
          <strong>Comic Book Archive</strong>: A .cbz bundle for sequential reading in comic viewer apps.
        </span>
      </div>
      <div class="form-group" style="margin-top: 1rem;">
        <label for="pdf-jpg-dpi">Render Resolution (DPI)</label>
        <input type="number" id="pdf-jpg-dpi" class="form-control" min="72" max="600" value="200">
        <span class="form-help" style="margin-top: 0.4rem; display: block;">
          Lower DPI is faster; higher DPI is sharper (72–600). Default is 200.
        </span>
      </div>
      ${backendStatusFieldHTML()}
    `
  });

  let file = null;

  refreshBackendStatus(container);

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  function processFile(f) {
    file = f;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.fileName.innerText = file.name;
    ui.fileMeta.innerText = 'PDF readied. Ready to render pages.';
    ui.runBtn.disabled = false;
    refreshBackendStatus(container);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file) return;

    const outputFormat = container.querySelector('#pdf-jpg-format').value;
    let dpi = parseInt(container.querySelector('#pdf-jpg-dpi').value) || 200;
    dpi = Math.max(72, Math.min(dpi, 600));

    const backend = await refreshBackendStatus(container);

    if (!backend.ok) {
      showErrorView(container, "Local Python backend is offline. Please start it using 'start.bat' (or 'uv run server.py') to enable high-fidelity PDF to JPG conversion.", () => initPdfToJpg(container));
      return;
    }

    const isCbz = outputFormat === 'cbz';
    const ext = isCbz ? '.cbz' : '_images.zip';
    const mime = isCbz ? 'application/x-cbz' : 'application/zip';
    const outputName = file.name.replace(/\.pdf$/i, '') + ext;

    await convertViaBackend(container, file, {
      endpoint: '/convert/pdf-to-jpg',
      fields: { dpi: dpi.toString() },
      outName: outputName,
      mime: mime,
      title: isCbz ? 'PDF converted to Comic Archive!' : 'PDF pages converted to JPG!',
      meta: `Images package: <strong>${outputName}</strong> — Rendered via local Python engine (PyMuPDF at ${dpi} DPI)`,
      icon: isCbz ? 'bi-book-half' : 'bi-file-earmark-zip-fill',
      progressText: `Rendering images at ${dpi} DPI (running PyMuPDF)...`,
      onReload: () => initPdfToJpg(container)
    });
  });
}
