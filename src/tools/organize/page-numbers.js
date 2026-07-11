import {
  downloadBlob,
  fileToArrayBuffer,
  renderPDFPageToCanvas,
  pdfjsDataFromBuffer
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createOrganizeUI } from './shared.js';

export function initPageNumbers(container) {
  const ui = createOrganizeUI(container, 'Drag & Drop PDF file to add numbers', 'Automatically insert page counts into margins', 'bi-hash');
  
  let fileBuffer = null;
  let selectedFile = null;

  ui.settingsFields.innerHTML = `
    <div class="form-group">
      <label for="num-pos">Position</label>
      <select id="num-pos" class="form-control">
        <option value="bottom-center">Bottom Center</option>
        <option value="bottom-right">Bottom Right</option>
        <option value="bottom-left">Bottom Left</option>
        <option value="top-center">Top Center</option>
        <option value="top-right">Top Right</option>
        <option value="top-left">Top Left</option>
      </select>
    </div>

    <div class="form-group" style="margin-top:0.75rem;">
      <label for="num-format">Format</label>
      <select id="num-format" class="form-control">
        <option value="simple">Page X (e.g. Page 3)</option>
        <option value="number">X (e.g. 3)</option>
        <option value="total">X of Y (e.g. 3 of 10)</option>
      </select>
    </div>

    <div class="form-group" style="margin-top:0.75rem;">
      <label for="num-start">Start Page</label>
      <input type="number" id="num-start" class="form-control" value="1" min="1">
    </div>

    <label style="display:flex; gap:0.5rem; align-items:center; margin-top:1rem; cursor:pointer;">
      <input type="checkbox" id="num-skip-first" checked>
      <span class="form-help" style="color:var(--text-main); font-weight:normal;">Skip Cover Page (Page 1)</span>
    </label>
  `;


  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Analyzing pages...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      ui.fileMeta.innerText = `Pages: ${pdf.numPages} | Ready to stamp page numbers.`;

      // Load page 1 preview
      const page = await pdf.getPage(1);
      const canvas = await renderPDFPageToCanvas(page, 0.4, { alpha: false });
      ui.pagesGrid.innerHTML = '';
      ui.pagesGrid.appendChild(canvas);
      
      ui.runBtn.disabled = false;

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF preview.';
    }
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!fileBuffer) return;

    const numPosEl = container.querySelector('#num-pos');
    const numFormatEl = container.querySelector('#num-format');
    const numStartEl = container.querySelector('#num-start');
    const numSkipFirstEl = container.querySelector('#num-skip-first');

    const position = numPosEl ? numPosEl.value : 'bottom-center';
    const format = numFormatEl ? numFormatEl.value : 'simple';
    const startNum = numStartEl ? (parseInt(numStartEl.value, 10) || 1) : 1;
    const skipFirst = numSkipFirstEl ? numSkipFirstEl.checked : false;

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Stamping page numbers...</p>
        </div>
      </div>
    `;

    try {


      const pdfDoc = await PDFDocument.load(fileBuffer);
      const pages = pdfDoc.getPages();
      const count = pages.length;

      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontSize = 10;

      for (let i = 0; i < count; i++) {
        if (i === 0 && skipFirst) continue; // Skip first page

        const page = pages[i];
        const pageW = page.getWidth();
        const pageH = page.getHeight();

        // Build string
        const pageNum = i + startNum;
        let text = `${pageNum}`;
        if (format === 'simple') text = `Page ${pageNum}`;
        if (format === 'total') text = `Page ${pageNum} of ${count}`;

        // Width of text
        const textWidth = helvetica.widthOfTextAtSize(text, fontSize);
        const margin = 30;

        let x = pageW / 2 - textWidth / 2; // Center default
        let y = margin; // Bottom default

        // Handle X coordinate
        if (position.includes('right')) {
          x = pageW - margin - textWidth;
        } else if (position.includes('left')) {
          x = margin;
        }

        // Handle Y coordinate
        if (position.includes('top')) {
          y = pageH - margin;
        }

        page.drawText(text, {
          x: x,
          y: y,
          size: fontSize,
          font: helvetica,
          color: rgb(0.2, 0.2, 0.2) // Subtle slate text
        });
      }

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_numbered.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-hash success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">Page Numbers Inserted!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-num" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-num-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Again</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-num').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-num-again').addEventListener('click', () => initPageNumbers(container));

    } catch (err) {
      console.error(err);
      alert('Stamping Failed: ' + err.message);
      initPageNumbers(container);
    }
  });
}
