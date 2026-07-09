import { loadScript, downloadBlob, formatBytes, fileToArrayBuffer, renderPDFPageToCanvas, canvasToBlob } from '../utils.js';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function createEditorUI(container, title, subtitle, isSignMode = false) {
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div id="edit-dropzone" class="dropzone">
        <i class="bi ${isSignMode ? 'bi-pen' : 'bi-pencil-square'} dropzone-icon"></i>
        <h4>${title}</h4>
        <p>${subtitle}</p>
        <input type="file" id="edit-file-input" class="file-input-hidden" accept="application/pdf">
      </div>
      
      <div id="edit-preview-container" style="display: none; margin-top: 1rem; width: 100%;">
        <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h4 style="font-family: var(--font-title);" id="edit-preview-title">Document Editor</h4>
          <span id="edit-file-meta" class="form-help">Page 1 of 1</span>
        </div>
        <div id="edit-workspace-grid" class="editor-workspace">
          <!-- Canvas preview will render here -->
        </div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Editor Controls</h3>
      
      ${isSignMode ? `
        <!-- Sign PDF Panel -->
        <div class="form-group">
          <label>Signature Options</label>
          <button id="btn-draw-sig-pad" class="btn btn-secondary" style="width:100%; margin-top:0.5rem;">
            <i class="bi bi-pencil"></i> Draw Signature
          </button>
        </div>
        <div id="signature-preview-box" class="form-group" style="display:none; margin-top: 0.75rem; text-align:center;">
          <label>Active Signature</label>
          <div style="padding:10px; background:#fff; border:1px solid var(--border-card); border-radius:8px; margin-top:0.25rem;">
            <img id="active-sig-img" style="max-height:80px; object-fit:contain; max-width:100%;">
          </div>
          <span class="form-help">Click signature on page to drag and resize.</span>
        </div>
      ` : `
        <!-- Edit PDF Panel -->
        <div class="form-group">
          <label>Drawing Mode</label>
          <select id="edit-mode-select" class="form-control">
            <option value="text">Add Text Field</option>
            <option value="draw">Freehand Draw (Brush)</option>
          </select>
        </div>

        <div id="brush-settings" class="form-group" style="margin-top: 0.75rem; display:none;">
          <label for="brush-color">Color</label>
          <input type="color" id="brush-color" class="form-control" value="#6366f1" style="height:35px; padding:0; cursor:pointer;">
          
          <label for="brush-size" style="margin-top:0.5rem;">Brush Size</label>
          <select id="brush-size" class="form-control">
            <option value="3">Small (3px)</option>
            <option value="6" selected>Medium (6px)</option>
            <option value="12">Large (12px)</option>
          </select>
        </div>
        
        <div id="text-settings" class="form-group" style="margin-top: 0.75rem;">
          <p class="form-help">Click anywhere on the document page to place a text box.</p>
        </div>
      `}

      <button id="btn-run-edit" class="btn btn-primary" style="width: 100%; margin-top: 1.5rem;" disabled>
        <i class="bi bi-file-earmark-check"></i> Save Changes
      </button>
    </div>

    <!-- Signature drawing Modal dialog -->
    <div id="modal-sig-pad" class="modal-overlay">
      <div class="modal-card">
        <div class="modal-header">
          <h3>Draw Your Signature</h3>
          <button class="modal-close" id="sig-pad-close"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="modal-body" style="align-items:center;">
          <canvas id="sig-draw-canvas" width="440" height="200" style="background:#fff; border:2px dashed #ccc; border-radius:8px; cursor:crosshair;"></canvas>
          <p class="form-help">Use your mouse or touchpad to sign in the box above.</p>
        </div>
        <div class="modal-footer">
          <button id="btn-clear-sig" class="btn btn-secondary">Clear</button>
          <button id="btn-save-sig" class="btn btn-primary">Insert Signature</button>
        </div>
      </div>
    </div>
  `;

  return {
    dropzone: container.querySelector('#edit-dropzone'),
    fileInput: container.querySelector('#edit-file-input'),
    previewContainer: container.querySelector('#edit-preview-container'),
    workspaceGrid: container.querySelector('#edit-workspace-grid'),
    fileMeta: container.querySelector('#edit-file-meta'),
    runBtn: container.querySelector('#btn-run-edit'),
    sigModal: container.querySelector('#modal-sig-pad'),
    sigClose: container.querySelector('#sig-pad-close'),
    sigDrawCanvas: container.querySelector('#sig-draw-canvas'),
    clearSig: container.querySelector('#btn-clear-sig'),
    saveSig: container.querySelector('#btn-save-sig'),
    drawSigBtn: container.querySelector('#btn-draw-sig-pad'),
    activeSigBox: container.querySelector('#signature-preview-box'),
    activeSigImg: container.querySelector('#active-sig-img'),
    modeSelect: container.querySelector('#edit-mode-select'),
    brushSettings: container.querySelector('#brush-settings'),
    textSettings: container.querySelector('#text-settings')
  };
}

// ==========================================
// 1. EDIT PDF
// ==========================================
export function initEditPdf(container) {
  const ui = createEditorUI(container, 'Drag & Drop PDF file to Edit', 'Add annotations, text, or drawing lines visually', false);

  let fileBuffer = null;
  let selectedFile = null;
  let pageCanvas = null;
  let drawOverlayCanvas = null;
  let drawOverlayCtx = null;

  // Drawing state
  let currentMode = 'text'; // 'text', 'draw'
  let isDrawing = false;
  let brushColor = '#6366f1';
  let brushSize = 6;
  
  // Array of typed texts: { text, x, y }
  const addedTexts = [];

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  ui.modeSelect.addEventListener('change', () => {
    currentMode = ui.modeSelect.value;
    if (currentMode === 'draw') {
      ui.brushSettings.style.display = 'flex';
      ui.textSettings.style.display = 'none';
      drawOverlayCanvas.style.pointerEvents = 'auto';
    } else {
      ui.brushSettings.style.display = 'none';
      ui.textSettings.style.display = 'flex';
      drawOverlayCanvas.style.pointerEvents = 'auto';
    }
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Rendering page...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      ui.fileMeta.innerText = `Total Pages: ${pdf.numPages}`;
      
      const page = await pdf.getPage(1);
      pageCanvas = await renderPDFPageToCanvas(page, 1.2);
      
      // Setup workspace wrapper
      ui.workspaceGrid.innerHTML = '';
      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'editor-page-container';
      pageWrapper.appendChild(pageCanvas);

      // Create Drawing/Interaction overlay canvas
      drawOverlayCanvas = document.createElement('canvas');
      drawOverlayCanvas.width = pageCanvas.width;
      drawOverlayCanvas.height = pageCanvas.height;
      drawOverlayCanvas.className = 'editor-canvas-overlay';
      drawOverlayCtx = drawOverlayCanvas.getContext('2d');
      pageWrapper.appendChild(drawOverlayCanvas);

      // Text boxes container
      const textBoxesContainer = document.createElement('div');
      textBoxesContainer.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:20;';
      pageWrapper.appendChild(textBoxesContainer);

      ui.workspaceGrid.appendChild(pageWrapper);
      setupDrawingEvents();
      setupTextEvents(textBoxesContainer);

      ui.runBtn.disabled = false;

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF.';
    }
  }

  function setupDrawingEvents() {
    container.querySelector('#brush-color').addEventListener('input', (e) => brushColor = e.target.value);
    container.querySelector('#brush-size').addEventListener('change', (e) => brushSize = parseInt(e.target.value, 10));

    drawOverlayCanvas.addEventListener('mousedown', (e) => {
      if (currentMode !== 'draw') return;
      isDrawing = true;
      const rect = drawOverlayCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      drawOverlayCtx.beginPath();
      drawOverlayCtx.moveTo(x, y);
      drawOverlayCtx.strokeStyle = brushColor;
      drawOverlayCtx.lineWidth = brushSize;
      drawOverlayCtx.lineCap = 'round';
      drawOverlayCtx.lineJoin = 'round';
    });

    drawOverlayCanvas.addEventListener('mousemove', (e) => {
      if (!isDrawing || currentMode !== 'draw') return;
      const rect = drawOverlayCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      drawOverlayCtx.lineTo(x, y);
      drawOverlayCtx.stroke();
    });

    drawOverlayCanvas.addEventListener('mouseup', () => isDrawing = false);
    drawOverlayCanvas.addEventListener('mouseleave', () => isDrawing = false);
  }

  function setupTextEvents(textContainer) {
    // Click overlay to place text field
    drawOverlayCanvas.addEventListener('click', (e) => {
      if (currentMode !== 'text') return;
      
      const rect = drawOverlayCanvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Create interactive input element
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'editor-text-input-overlay';
      input.style.left = `${clickX}px`;
      input.style.top = `${clickY - 10}px`; // center slightly
      input.style.color = '#312e81'; // Deep indigo text color
      input.style.fontSize = '15px';
      input.style.fontFamily = 'Arial, sans-serif';
      input.style.pointerEvents = 'auto';
      
      textContainer.appendChild(input);
      input.focus();

      input.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') {
          input.blur();
        }
      });

      input.addEventListener('blur', () => {
        const val = input.value.trim();
        if (val) {
          // Keep reference of added text
          addedTexts.push({
            text: val,
            x: clickX,
            y: clickY
          });
          
          // Render it statically inside container as text
          const textEl = document.createElement('div');
          textEl.style.cssText = `position:absolute; left:${clickX}px; top:${clickY - 12}px; font-family:Arial, sans-serif; font-size:15px; color:#312e81; font-weight:bold; pointer-events:auto; cursor:move;`;
          textEl.innerText = val;
          textContainer.appendChild(textEl);
        }
        input.remove(); // Remove active input
      });
    });
  }

  ui.runBtn.addEventListener('click', async () => {
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Baking annotations into PDF...</p>
        </div>
      </div>
    `;

    try {


      const pdfDoc = await PDFDocument.load(fileBuffer);
      const firstPage = pdfDoc.getPages()[0];
      
      // 1. Bake added texts onto drawOverlayCanvas so everything is in one layer
      drawOverlayCtx.font = 'bold 15px Arial';
      drawOverlayCtx.fillStyle = '#312e81';
      addedTexts.forEach(t => {
        // Offset Y slightly matching canvas baseline
        drawOverlayCtx.fillText(t.text, t.x, t.y);
      });

      // 2. Export transparent edit overlay canvas to PNG Blob
      const editOverlayBlob = await canvasToBlob(drawOverlayCanvas, 'image/png');
      const editOverlayBuffer = await editOverlayBlob.arrayBuffer();

      // 3. Embed PNG into pdf-lib and overlay on top of original page
      const embedOverlayImg = await pdfDoc.embedPng(editOverlayBuffer);
      
      const pageW = firstPage.getWidth();
      const pageH = firstPage.getHeight();

      firstPage.drawImage(embedOverlayImg, {
        x: 0,
        y: 0,
        width: pageW,
        height: pageH
      });

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_edited.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-file-earmark-check success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Edited Successfully!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-edit" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-edit-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Edit More</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-edit').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-edit-again').addEventListener('click', () => initEditPdf(container));

    } catch (err) {
      console.error(err);
      alert('Failed to save edits: ' + err.message);
      initEditPdf(container);
    }
  });
}

// ==========================================
// 2. SIGN PDF
// ==========================================
export function initSign(container) {
  const ui = createEditorUI(container, 'Drag & Drop PDF file to Sign', 'Add your digital signature onto document pages', true);

  let fileBuffer = null;
  let selectedFile = null;
  let pageCanvas = null;
  
  // Signature drawing state
  let signatureImgUrl = null;
  let signatureImgBlob = null;
  let isSigDrawing = false;
  let sigCtx = null;
  
  // Active placed signature visual coords
  let placedSigEl = null;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
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
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      ui.fileMeta.innerText = `Total Pages: ${pdf.numPages}`;
      
      const page = await pdf.getPage(1);
      pageCanvas = await renderPDFPageToCanvas(page, 1.2);
      
      // Setup workspace
      ui.workspaceGrid.innerHTML = '';
      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'editor-page-container';
      pageWrapper.id = 'sign-page-wrapper';
      pageWrapper.appendChild(pageCanvas);

      ui.workspaceGrid.appendChild(pageWrapper);
      setupSigDrawPad();

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF.';
    }
  }

  function setupSigDrawPad() {
    sigCtx = ui.sigDrawCanvas.getContext('2d');
    sigCtx.strokeStyle = '#000000';
    sigCtx.lineWidth = 3;
    sigCtx.lineCap = 'round';

    // Sign Pad trigger modal open
    ui.drawSigBtn.addEventListener('click', () => {
      ui.sigModal.classList.add('active');
      // Reset signature canvas
      sigCtx.clearRect(0, 0, ui.sigDrawCanvas.width, ui.sigDrawCanvas.height);
    });

    ui.sigClose.addEventListener('click', () => ui.sigModal.classList.remove('active'));

    // Mouse Canvas events
    ui.sigDrawCanvas.addEventListener('mousedown', (e) => {
      isSigDrawing = true;
      const rect = ui.sigDrawCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      sigCtx.beginPath();
      sigCtx.moveTo(x, y);
    });

    ui.sigDrawCanvas.addEventListener('mousemove', (e) => {
      if (!isSigDrawing) return;
      const rect = ui.sigDrawCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      sigCtx.lineTo(x, y);
      sigCtx.stroke();
    });

    ui.sigDrawCanvas.addEventListener('mouseup', () => isSigDrawing = false);
    ui.sigDrawCanvas.addEventListener('mouseleave', () => isSigDrawing = false);

    ui.clearSig.addEventListener('click', () => {
      sigCtx.clearRect(0, 0, ui.sigDrawCanvas.width, ui.sigDrawCanvas.height);
    });

    ui.saveSig.addEventListener('click', async () => {
      // Create PNG blob of signature
      signatureImgBlob = await canvasToBlob(ui.sigDrawCanvas, 'image/png');
      signatureImgUrl = URL.createObjectURL(signatureImgBlob);
      
      // Update sidebar view
      ui.activeSigImg.src = signatureImgUrl;
      ui.activeSigBox.style.display = 'block';
      ui.sigModal.classList.remove('active');

      // Place draggable signature image onto page wrapper
      placeSignatureOnPage();
      ui.runBtn.disabled = false;
    });
  }

  function placeSignatureOnPage() {
    const wrapper = container.querySelector('#sign-page-wrapper');
    if (!wrapper) return;

    // Remove existing signature visual representation if any
    if (placedSigEl) placedSigEl.remove();

    placedSigEl = document.createElement('div');
    placedSigEl.style.cssText = 'position:absolute; top:100px; left:100px; width:160px; height:75px; z-index:30; cursor:move; border:1.5px dashed var(--primary-color); pointer-events:auto;';
    placedSigEl.innerHTML = `
      <img src="${signatureImgUrl}" style="width:100%; height:100%; pointer-events:none;">
      <div style="position:absolute; right: -5px; bottom: -5px; width:10px; height:10px; background:var(--primary-color); cursor:se-resize; border-radius:50%;" class="resize-handle"></div>
    `;

    wrapper.appendChild(placedSigEl);

    // Draggable & Resizable implementation
    let isDragging = false;
    let isResizing = false;
    let startX, startY;
    let startW, startH;
    let startLeft, startTop;

    placedSigEl.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('resize-handle')) {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startW = placedSigEl.offsetWidth;
        startH = placedSigEl.offsetHeight;
      } else {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = placedSigEl.offsetLeft;
        startTop = placedSigEl.offsetTop;
      }
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        placedSigEl.style.left = `${startLeft + dx}px`;
        placedSigEl.style.top = `${startTop + dy}px`;
      } else if (isResizing) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        placedSigEl.style.width = `${Math.max(50, startW + dx)}px`;
        placedSigEl.style.height = `${Math.max(25, startH + dy)}px`;
      }
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      isResizing = false;
    });
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!placedSigEl || !signatureImgBlob) return;

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Baking signature onto PDF page...</p>
        </div>
      </div>
    `;

    try {


      const pdfDoc = await PDFDocument.load(fileBuffer);
      const firstPage = pdfDoc.getPages()[0];
      
      const sigImgBytes = await signatureImgBlob.arrayBuffer();
      const embedSigImg = await pdfDoc.embedPng(sigImgBytes);

      // Map positions relative to page canvas size
      const canvasW = pageCanvas.width;
      const canvasH = pageCanvas.height;

      const pageW = firstPage.getWidth();
      const pageH = firstPage.getHeight();

      const rx = pageW / canvasW;
      const ry = pageH / canvasH;

      // placedSigEl coords
      const elLeft = placedSigEl.offsetLeft;
      const elTop = placedSigEl.offsetTop;
      const elW = placedSigEl.offsetWidth;
      const elH = placedSigEl.offsetHeight;

      // Translate coordinates to PDF (Y origin is bottom-left)
      const pdfX = elLeft * rx;
      const pdfY = (canvasH - elTop - elH) * ry;
      const pdfW = elW * rx;
      const pdfH = elH * ry;

      firstPage.drawImage(embedSigImg, {
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH
      });

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_signed.pdf';

      // Revoke signatures URL
      URL.revokeObjectURL(signatureImgUrl);

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-pen success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Signed Successfully!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-sign" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-sign-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Sign Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-sign').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-sign-again').addEventListener('click', () => initSign(container));

    } catch (err) {
      console.error(err);
      alert('Signing Failed: ' + err.message);
      initSign(container);
    }
  });
}
