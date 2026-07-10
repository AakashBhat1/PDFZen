import { createConvertUI, showSuccessView, showProgressView, showErrorView, extractPDFText, fileToArrayBuffer, downloadBlob } from './convert-shared.js';
import * as XLSX from 'xlsx';

// ==========================================
// PDF TO EXCEL
// ==========================================
export function initPdfToExcel(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF file here',
    subtitle: 'Pull tabular layouts to Excel spreadsheets (.xlsx)',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-xlsx',
    multiple: false
  });

  let fileBuffer = null;
  let file = null;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(f) {
    file = f;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.fileName.innerText = file.name;
    ui.fileMeta.innerText = 'File selected. Ready to extract sheets.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Parsing PDF grids...');
    
    try {
      const pagesText = await extractPDFText(fileBuffer, (current, total) => {
        progress.progressText.innerText = `Extracting PDF text structures... Page ${current} of ${total}`;
        progress.progressBar.style.width = `${10 + (current / total) * 50}%`;
      });

      // Create workbook
      progress.progressText.innerText = 'Structuring Excel columns...';
      progress.progressBar.style.width = '85%';
      const wb = XLSX.utils.book_new();

      pagesText.forEach((lines, pageIdx) => {
        // Map line text: if lines contain multiple spacing, split into table cells
        const sheetData = lines.map(line => {
          // Split by 2 or more spaces (heuristic to isolate columns)
          return line.split(/\s{2,}/);
        });

        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        XLSX.utils.book_append_sheet(wb, ws, `Page ${pageIdx + 1}`);
      });

      // Write workbook bytes
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const excelBlob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      progress.progressBar.style.width = '100%';

      const outputName = file.name.replace(/\.pdf$/i, '') + '.xlsx';
      showSuccessView(container, {
        title: 'PDF converted to Excel!',
        meta: `Spreadsheet: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-excel-fill',
        onDownload: () => downloadBlob(excelBlob, outputName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        onReload: () => initPdfToExcel(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPdfToExcel(container));
    }
  });
}
