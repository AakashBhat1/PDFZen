import {
  downloadBlob,
  fileToArrayBuffer,
  renderPDFPageToCanvas,
  pdfjsDataFromBuffer
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import { PDFDocument, rgb } from 'pdf-lib';
import { createSecurityUI } from './shared.js';

export function initRedact(container) {
  const ui = createSecurityUI(container, 'Drag & Drop PDF to Redact', 'Black-out and permanently erase sensitive text', 'bi-eye-slash', false);

  let fileBuffer = null;
  let selectedFile = null;
  let pageCanvas = null;
  let scale = 1.0;

  // Redaction box coords
  let startX = 0, startY = 0;
  let endX = 0, endY = 0;
  let isDrawing = false;
  let redactionBoxes = []; // Array of { sx, sy, ex, ey }

  ui.settingsFields.innerHTML = `
    <div class="form-group">
      <label for="redact-color">Redaction Color</label>
      <select id="redact-color" class="form-control" style="margin-bottom:0.75rem;">
        <option value="black" selected>Black (Standard)</option>
        <option value="red">Red (Warning/Review)</option>
        <option value="white">White (Erase/White-out)</option>
      </select>
    </div>
    <div class="form-group">
      <label>Redaction Areas</label>
      <span class="form-help">Click and drag over sensitive content to draw redaction boxes.</span>
      <button id="btn-clear-redactions" class="btn btn-secondary" style="width:100%; margin-top:0.5rem;" disabled>
        <i class="bi bi-trash"></i> Clear All Boxes
      </button>
    </div>
  `;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  const clearBtn = ui.settingsFields.querySelector('#btn-clear-redactions');

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.redactRoot.style.display = 'flex';
    ui.fileMeta.innerText = 'Loading...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      ui.fileMeta.innerText = `Total Pages: ${pdf.numPages}`;
      
      const page = await pdf.getPage(1);
      scale = 1.2;
      pageCanvas = await renderPDFPageToCanvas(page, scale);
      
      ui.redactRoot.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'editor-page-container';
      wrapper.appendChild(pageCanvas);

      // Interactive drawing overlay
      const overlay = document.createElement('canvas');
      overlay.width = pageCanvas.width;
      overlay.height = pageCanvas.height;
      overlay.className = 'editor-canvas-overlay';
      wrapper.appendChild(overlay);
      
      ui.redactRoot.appendChild(wrapper);
      
      setupRedactEvents(overlay);
      
      const colorSelect = ui.settingsFields.querySelector('#redact-color');
      colorSelect.addEventListener('change', () => {
        redrawAllRedactions(overlay.getContext('2d'), overlay.width, overlay.height);
      });

      ui.runBtn.disabled = false;

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF.';
    }
  }

  function setupRedactEvents(overlay) {
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
      
      redrawAllRedactions(ctx, overlay.width, overlay.height);
      
      // Draw active box outline
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.fillRect(startX, startY, endX - startX, endY - startY);
      ctx.strokeRect(startX, startY, endX - startX, endY - startY);
    });

    overlay.addEventListener('mouseup', () => {
      if (isDrawing) {
        redactionBoxes.push({
          sx: startX,
          sy: startY,
          ex: endX,
          ey: endY
        });
        isDrawing = false;
        clearBtn.disabled = false;
        redrawAllRedactions(ctx, overlay.width, overlay.height);
      }
    });

    clearBtn.addEventListener('click', () => {
      redactionBoxes = [];
      clearBtn.disabled = true;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    });
  }

  function redrawAllRedactions(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const colorVal = ui.settingsFields.querySelector('#redact-color').value;
    
    redactionBoxes.forEach(box => {
      if (colorVal === 'white') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(box.sx, box.sy, box.ex - box.sx, box.ey - box.sy);
        // Draw thin gray border on preview canvas for white-out visibility
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 1;
        ctx.strokeRect(box.sx, box.sy, box.ex - box.sx, box.ey - box.sy);
      } else if (colorVal === 'red') {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(box.sx, box.sy, box.ex - box.sx, box.ey - box.sy);
      } else {
        ctx.fillStyle = '#000000';
        ctx.fillRect(box.sx, box.sy, box.ex - box.sx, box.ey - box.sy);
      }
    });
  }

  ui.runBtn.addEventListener('click', async () => {
    if (redactionBoxes.length === 0) return alert('Please draw at least one redaction box.');
    
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Erasuring text elements and baking black boxes...</p>
        </div>
      </div>
    `;

    try {


      const pdfDoc = await PDFDocument.load(fileBuffer);
      const page = pdfDoc.getPages()[0];
      const pageW = page.getWidth();
      const pageH = page.getHeight();

      // Ratios
      const rx = pageW / pageCanvas.width;
      const ry = pageH / pageCanvas.height;

      // Draw redaction boxes on PDF coordinates
      const colorVal = ui.settingsFields.querySelector('#redact-color').value;
      let fillRGB = rgb(0, 0, 0);
      if (colorVal === 'red') fillRGB = rgb(0.93, 0.26, 0.26); // #ef4444
      if (colorVal === 'white') fillRGB = rgb(1, 1, 1);       // #ffffff

      redactionBoxes.forEach(box => {
        const left = Math.min(box.sx, box.ex) * rx;
        const width = Math.abs(box.ex - box.sx) * rx;
        const canvasBottom = Math.max(box.sy, box.ey);
        const height = Math.abs(box.ey - box.sy) * ry;

        // PDF coordinate Y is bottom-up
        const pdfY = (pageCanvas.height - canvasBottom) * ry;

        page.drawRectangle({
          x: left,
          y: pdfY,
          width: width,
          height: height,
          color: fillRGB
        });
      });

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_redacted.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-eye-slash-fill success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Content Redacted!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-sec" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-sec-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Redact More</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-sec').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-sec-again').addEventListener('click', () => initRedact(container));

    } catch (err) {
      console.error(err);
      alert('Redaction Failed: ' + err.message);
      initRedact(container);
    }
  });
}

// ==========================================
// 4. REPAIR PDF
// ==========================================
