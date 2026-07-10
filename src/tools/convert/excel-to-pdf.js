import { createConvertUI, showSuccessView, showProgressView, showErrorView, fileToArrayBuffer, downloadBlob } from './convert-shared.js';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';

// ==========================================
// EXCEL TO PDF
// ==========================================
export function initExcelToPdf(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop Excel spreadsheet here (.xlsx, .xls)',
    subtitle: 'Render spreadsheet sheets into PDF layout pages',
    inputType: 'excel',
    icon: 'bi-file-excel',
    fileIcon: 'bi-file-pdf',
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
    ui.fileMeta.innerText = 'Spreadsheet parsed. Ready to print.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Parsing Excel workbook...');
    
    try {
      // 1. Parse XLSX
      
      progress.progressText.innerText = 'Extracting sheet values...';
      progress.progressBar.style.width = '40%';
      
      const wb = XLSX.read(fileBuffer, { type: 'array' });
      
      // Build HTML output of sheets tables
      let sheetsHtml = '';
      wb.SheetNames.forEach((name, idx) => {
        const ws = wb.Sheets[name];
        const htmlTable = XLSX.utils.sheet_to_html(ws);
        sheetsHtml += `
          <div class="sheet-container" style="page-break-after: always; padding: 20px 0;">
            <h2 style="font-family:'Outfit', sans-serif; font-size:1.5rem; margin-bottom:10px; color:#4f46e5;">Sheet: ${name}</h2>
            <div style="overflow-x:auto;">
              ${htmlTable}
            </div>
          </div>
        `;
      });

      // 2. Render to PDF
      progress.progressText.innerText = 'Configuring layout...';
      progress.progressBar.style.width = '70%';

      const renderContainer = document.createElement('div');
      renderContainer.style.cssText = 'padding: 40px; background:#fff; color:#333; font-family:sans-serif; font-size:11px;';
      renderContainer.innerHTML = `
        <style>
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
          tr:nth-child(even) { background-color: #f9f9f9; }
        </style>
        ${sheetsHtml}
      `;

      renderContainer.style.position = 'fixed';
      renderContainer.style.left = '-9999px';
      document.body.appendChild(renderContainer);

      progress.progressText.innerText = 'Printing sheets to PDF...';
      progress.progressBar.style.width = '85%';

      const outputName = file.name.replace(/\.xlsx$|\.xls$/i, '') + '.pdf';
      const opt = {
        margin: 0.5,
        filename: outputName,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 1.5, useCORS: true },
        // Render in landscape mode for sheets tables
        jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
      };

      const pdfBlob = await html2pdf().set(opt).from(renderContainer).output('blob');
      document.body.removeChild(renderContainer);
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'Excel sheets converted to PDF!',
        meta: `PDF document: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-pdf-fill',
        onDownload: () => downloadBlob(pdfBlob, outputName),
        onReload: () => initExcelToPdf(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initExcelToPdf(container));
    }
  });
}
