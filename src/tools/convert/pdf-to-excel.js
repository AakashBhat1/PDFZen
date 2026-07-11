import { createConvertUI, showErrorView, backendStatusFieldHTML, refreshBackendStatus, convertViaBackend } from './convert-shared.js';

// ==========================================
// PDF TO EXCEL / CSV (local backend via pdfplumber)
// ==========================================

export function initPdfToExcel(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF file here',
    subtitle: 'Pull tabular layouts to Excel spreadsheets or CSV sheets',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-xlsx',
    multiple: false,
    settingsHTML: `
      <div class="form-group">
        <label for="excel-output-format">Output Format</label>
        <select id="excel-output-format" class="form-control">
          <option value="xlsx">Excel Workbook (.xlsx)</option>
          <option value="csv">CSV (Comma Separated Values)</option>
        </select>
        <span class="form-help" style="margin-top: 0.4rem; display: block;">
          <strong>Excel</strong>: Multi-page outputs become separate sheets.<br>
          <strong>CSV</strong>: Returns a text sheet. Multi-page outputs are packaged in a ZIP.
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
    ui.fileMeta.innerText = 'File selected. Ready to extract tabular data.';
    ui.runBtn.disabled = false;
    refreshBackendStatus(container);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file) return;

    const outputFormat = container.querySelector('#excel-output-format').value;
    const backend = await refreshBackendStatus(container);

    if (!backend.ok) {
      showErrorView(container, "Local Python backend is offline. Please start it using 'start.bat' (or 'uv run server.py') to enable high-fidelity PDF to Excel conversion.", () => initPdfToExcel(container));
      return;
    }

    const ext = outputFormat === 'xlsx' ? '.xlsx' : '.csv';
    await convertViaBackend(container, file, {
      endpoint: '/convert/pdf-to-excel',
      fields: { format: outputFormat },
      outName: file.name.replace(/\.pdf$/i, '') + ext,
      mime: outputFormat === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
      title: outputFormat === 'xlsx' ? 'PDF Converted to Excel!' : 'PDF Converted to CSV!',
      meta: `Spreadsheet: <strong>${file.name.replace(/\.pdf$/i, '') + ext}</strong> — Extracted via local Python engine`,
      icon: outputFormat === 'xlsx' ? 'bi-file-earmark-excel-fill' : 'bi-file-earmark-spreadsheet-fill',
      progressText: 'Extracting tables (running pdfplumber)...',
      onReload: () => initPdfToExcel(container)
    });
  });
}
