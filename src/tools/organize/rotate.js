import {
  downloadBlob,
  fileToArrayBuffer,
  renderPDFPageToObjectUrl,
  pdfjsDataFromBuffer,
  yieldToUI
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import { PDFDocument, degrees } from 'pdf-lib';
import { createOrganizeUI } from './shared.js';

export function initRotate(container) {
  const ui = createOrganizeUI(container, 'Drag & Drop PDF file to Rotate', 'Rotate individual pages or all pages at once', 'bi-arrow-clockwise');
  
  let fileBuffer = null;
  let selectedFile = null;
  let pageList = []; // Array of { id, originalIndex, rotationAngle, canvasUrl }

  function revokeRotateUrls(list) {
    for (const item of list) {
      if (item.canvasUrl && item.canvasUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.canvasUrl);
      }
    }
  }

  ui.settingsFields.innerHTML = `
    <div class="form-group">
      <label>Batch Rotate</label>
      <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
        <button id="btn-rotate-all-95" class="btn btn-secondary" style="flex:1;"><i class="bi bi-arrow-clockwise"></i> +90° All</button>
        <button id="btn-rotate-all-180" class="btn btn-secondary" style="flex:1;"><i class="bi bi-arrow-repeat"></i> 180° All</button>
      </div>
    </div>
  `;


  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Extracting pages...';

    try {
      revokeRotateUrls(pageList);
      fileBuffer = await fileToArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      const count = pdf.numPages;
      pageList = [];

      for (let i = 1; i <= count; i++) {
        const page = await pdf.getPage(i);
        const canvasUrl = await renderPDFPageToObjectUrl(page, 0.4, 0.72);

        pageList.push({
          id: i,
          originalIndex: i - 1,
          rotationAngle: 0, // In degrees (0, 90, 180, 270)
          canvasUrl
        });
        if (i % 3 === 0) await yieldToUI();
      }

      ui.fileMeta.innerText = `Pages: ${pageList.length}`;
      ui.runBtn.disabled = false;
      renderGrid();

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF.';
    }
  }

  function renderGrid() {
    ui.pagesGrid.innerHTML = '';
    pageList.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'page-thumbnail-card';
      
      // Visual rotation in DOM
      card.innerHTML = `
        <img src="${item.canvasUrl}" class="page-thumbnail-canvas" style="transform: rotate(${item.rotationAngle}deg); transition: transform 0.2s ease;">
        <span class="page-number-badge">${item.id}</span>
        <div class="page-action-overlay">
          <button class="btn-overlay btn-rotate-page" title="Rotate +90°"><i class="bi bi-arrow-clockwise"></i></button>
        </div>
      `;

      card.querySelector('.btn-rotate-page').addEventListener('click', (e) => {
        e.stopPropagation();
        item.rotationAngle = (item.rotationAngle + 90) % 360;
        card.querySelector('img').style.transform = `rotate(${item.rotationAngle}deg)`;
      });

      ui.pagesGrid.appendChild(card);
    });
  }

  // Batch rotators
  ui.settingsFields.querySelector('#btn-rotate-all-95').addEventListener('click', () => {
    pageList.forEach(item => item.rotationAngle = (item.rotationAngle + 90) % 360);
    renderGrid();
  });
  ui.settingsFields.querySelector('#btn-rotate-all-180').addEventListener('click', () => {
    pageList.forEach(item => item.rotationAngle = (item.rotationAngle + 180) % 360);
    renderGrid();
  });

  ui.runBtn.addEventListener('click', async () => {
    if (pageList.length === 0) return;
    
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Rotating PDF pages...</p>
        </div>
      </div>
    `;

    try {


      const pdfDoc = await PDFDocument.load(fileBuffer);
      const pages = pdfDoc.getPages();

      pageList.forEach(item => {
        if (item.rotationAngle !== 0) {
          const page = pages[item.originalIndex];
          const currentRotation = page.getRotation().angle;
          page.setRotation(degrees(currentRotation + item.rotationAngle));
        }
      });

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_rotated.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-arrow-clockwise success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Pages Rotated!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-rot" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-rot-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Rotate More</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-rot').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-rot-again').addEventListener('click', () => initRotate(container));

    } catch (err) {
      console.error(err);
      alert('Rotation Failed: ' + err.message);
      initRotate(container);
    }
  });
}

// ==========================================
// 3. CROP PDF
// ==========================================
