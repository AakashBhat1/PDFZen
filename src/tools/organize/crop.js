import {
  downloadBlob,
  fileToArrayBuffer,
  renderPDFPageToCanvas,
  pdfjsDataFromBuffer
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import { PDFDocument } from 'pdf-lib';
import { createOrganizeUI } from './shared.js';

export function initCrop(container) {
  const ui = createOrganizeUI(container, 'Drag & Drop PDF file to Crop', 'Adjust margin viewports visually', 'bi-crop');
  
  let fileBuffer = null;
  let selectedFile = null;
  let pdfDocInstance = null;
  let cropPageCanvas = null;
  let cropCtx = null;
  
  // Crop coords
  let startX = 0, startY = 0;
  let endX = 0, endY = 0;
  let isDrawing = false;
  let scale = 1.0;

  ui.settingsFields.innerHTML = `
    <div class="form-group">
      <label>Crop Selection</label>
      <span class="form-help">Click and drag over the page to define a crop bounding box.</span>
    </div>
    
    <div class="form-group" style="margin-top: 0.75rem;">
      <label for="crop-scope">Scope</label>
      <select id="crop-scope" class="form-control">
        <option value="current">Apply only to current page</option>
        <option value="all">Apply to all pages</option>
      </select>
    </div>
  `;


  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Rendering page...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      pdfDocInstance = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      ui.fileMeta.innerText = `Total Pages: ${pdfDocInstance.numPages}`;

      // Load page 1
      const page = await pdfDocInstance.getPage(1);

      // Render page on editor container style
      scale = 1.0;
      cropPageCanvas = await renderPDFPageToCanvas(page, scale);
      cropCtx = cropPageCanvas.getContext('2d');
      
      // Clear visual grid container, replace with interactive canvas wrapper
      ui.pagesGrid.innerHTML = '';
      ui.pagesGrid.className = 'editor-workspace';
      
      const wrapper = document.createElement('div');
      wrapper.className = 'editor-page-container';
      wrapper.appendChild(cropPageCanvas);
      
      // Interactive drawing canvas overlay
      const overlay = document.createElement('canvas');
      overlay.width = cropPageCanvas.width;
      overlay.height = cropPageCanvas.height;
      overlay.className = 'editor-canvas-overlay';
      wrapper.appendChild(overlay);
      
      ui.pagesGrid.appendChild(wrapper);
      
      setupCropSelection(overlay);
      ui.runBtn.disabled = false;

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to render PDF page.';
    }
  }

  function setupCropSelection(overlay) {
    const ctx = overlay.getContext('2d');
    
    overlay.addEventListener('mousedown', (e) => {
      const rect = overlay.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      isDrawing = true;
    });

    overlay.addEventListener('mousemove', (e) => {
      if (!isDrawing) return;
      const rect = overlay.getBoundingClientRect();
      endX = e.clientX - rect.left;
      endY = e.clientY - rect.top;
      
      // Redraw crop box selection
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2.5;
      ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
      ctx.setLineDash([5, 5]);
      ctx.fillRect(startX, startY, endX - startX, endY - startY);
      ctx.strokeRect(startX, startY, endX - startX, endY - startY);
    });

    overlay.addEventListener('mouseup', () => {
      isDrawing = false;
    });
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!cropPageCanvas) return;
    
    // Bounds check
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    if (width < 10 || height < 10) return alert('Please select a larger cropping region.');

    const cropScopeEl = container.querySelector('#crop-scope');
    const scope = cropScopeEl ? cropScopeEl.value : 'current';

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Cropping PDF dimensions...</p>
        </div>
      </div>
    `;

    try {


      const pdfDoc = await PDFDocument.load(fileBuffer);

      // Map browser canvas coordinates to original pdf-lib page coordinates
      // Bounding boxes in PDF start from bottom-left (Y = 0 is bottom). Canvas Y = 0 is top.
      const canvasHeight = cropPageCanvas.height;
      
      const pdfPage1 = pdfDoc.getPages()[0];
      const pdfWidth = pdfPage1.getWidth();
      const pdfHeight = pdfPage1.getHeight();

      // Ratio scaling factor
      const rx = pdfWidth / cropPageCanvas.width;
      const ry = pdfHeight / cropPageCanvas.height;

      const left = Math.min(startX, endX) * rx;
      const right = Math.max(startX, endX) * rx;
      const canvasTop = Math.min(startY, endY);
      const canvasBottom = Math.max(startY, endY);

      // Translate top/bottom to PDF coordinate space (bottom-left origin)
      const bottom = (canvasHeight - canvasBottom) * ry;
      const top = (canvasHeight - canvasTop) * ry;

      const pagesToCrop = scope === 'all' ? pdfDoc.getPages() : [pdfDoc.getPages()[0]];

      pagesToCrop.forEach(page => {
        page.setCropBox(left, bottom, right - left, top - bottom);
      });

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_cropped.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-crop success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Cropped Successfully!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-crop" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-crop-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Crop Again</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-crop').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-crop-again').addEventListener('click', () => initCrop(container));

    } catch (err) {
      console.error(err);
      alert('Crop Failed: ' + err.message);
      initCrop(container);
    }
  });
}

// ==========================================
// 4. PAGE NUMBERS
// ==========================================
