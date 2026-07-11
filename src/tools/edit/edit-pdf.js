import {
  downloadBlob,
  fileToArrayBuffer,
  renderPDFPageToCanvas,
  pdfjsDataFromBuffer
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import { PDFDocument } from 'pdf-lib';
import { bakeElementsAndGetBlob, createDraggableElement, createEditorUI, deselectAllElements, hexToRgbA, selectElement } from './shared.js';

export function initEditPdf(container) {
  const ui = createEditorUI(container, 'Drag & Drop PDF file to Edit', 'Add customizable annotations, text, highlighters or shapes visually', false);

  let fileBuffer = null;
  let selectedFile = null;
  let pageContainers = [];

  // Toolbox state
  let currentTool = 'select'; // 'select', 'text', 'pen', 'highlighter', 'rect', 'circle'
  let brushColor = '#6366f1';
  let brushSize = 4;
  let textFont = 'Arial';
  let textSize = 16;
  
  let activePageContainer = null;
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  let shapeState = null;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  // Handle toolbar tools switching
  function setupToolbarEvents() {
    const toolBtns = container.querySelectorAll('.editor-toolbar-btn[data-tool]');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        currentTool = btn.dataset.tool;
        deselectAllElements();

        // Switch visible panel on the sidebar properties
        container.querySelectorAll('.properties-panel').forEach(p => p.style.display = 'none');
        if (currentTool === 'select') {
          container.querySelector('#select-properties').style.display = 'block';
        } else if (currentTool === 'pen' || currentTool === 'highlighter' || currentTool === 'rect' || currentTool === 'circle') {
          container.querySelector('#draw-properties').style.display = 'block';
        } else if (currentTool === 'text') {
          container.querySelector('#text-properties').style.display = 'block';
        }
      });
    });

    // Properties binders
    container.querySelector('#brush-color').addEventListener('input', (e) => brushColor = e.target.value);
    container.querySelector('#brush-size').addEventListener('change', (e) => brushSize = parseInt(e.target.value, 10));
    container.querySelector('#text-font-family').addEventListener('change', (e) => textFont = e.target.value);
    container.querySelector('#text-font-size').addEventListener('change', (e) => textSize = parseInt(e.target.value, 10));

    // Stamp Image trigger
    const stampInput = container.querySelector('#stamp-image-input');
    container.querySelector('#btn-add-img').addEventListener('click', () => stampInput.click());
    stampInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (evt) => {
          const pc = activePageContainer || pageContainers[0];
          if (pc) {
            const html = `<img src="${evt.target.result}" style="width:100%; height:100%; object-fit: contain; pointer-events:none;">`;
            const w = 150;
            const h = 100;
            const left = (pc.overlayCanvas.width - w) / 2;
            const top = (pc.overlayCanvas.height - h) / 2;
            
            const el = createDraggableElement(pc, html, w, h, left, top, 'image');
            selectElement(el);
          }
        };
        reader.readAsDataURL(file);
        stampInput.value = ''; // Reset
      }
    });

    // Clear Active Page
    container.querySelector('#btn-clear-active').addEventListener('click', () => {
      const pc = activePageContainer || pageContainers[0];
      if (pc) {
        if (confirm("Are you sure you want to clear all drawings and overlays on this page?")) {
          pc.overlayCtx.clearRect(0, 0, pc.overlayCanvas.width, pc.overlayCanvas.height);
          pc.elementContainer.innerHTML = '';
          pc.drawHistory = [];
          pc.redoHistory = [];
        }
      }
    });

    // Undo action
    container.querySelector('#btn-undo').addEventListener('click', () => {
      const pc = activePageContainer || pageContainers[0];
      if (pc && pc.drawHistory.length > 0) {
        const popped = pc.drawHistory.pop();
        pc.redoHistory.push(popped);
        
        pc.overlayCtx.clearRect(0, 0, pc.overlayCanvas.width, pc.overlayCanvas.height);
        if (pc.drawHistory.length > 0) {
          const prevState = pc.drawHistory[pc.drawHistory.length - 1];
          pc.overlayCtx.putImageData(prevState, 0, 0);
        }
      }
    });
  }

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Loading and rendering PDF...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      
      const totalPages = pdf.numPages;
      ui.fileMeta.innerText = `Total Pages: ${totalPages}`;
      ui.workspaceGrid.innerHTML = '';
      pageContainers = [];

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        // Render base canvas at crisp 1.5 scale
        const pCanvas = await renderPDFPageToCanvas(page, 1.5);
        
        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'editor-page-container';
        pageWrapper.style.position = 'relative';
        pageWrapper.dataset.page = pageNum;
        
        // Add badge
        const badge = document.createElement('div');
        badge.className = 'page-badge';
        badge.innerText = `Page ${pageNum} of ${totalPages}`;
        pageWrapper.appendChild(badge);
        
        pageWrapper.appendChild(pCanvas);

        // Drawing overlay canvas
        const oCanvas = document.createElement('canvas');
        oCanvas.width = pCanvas.width;
        oCanvas.height = pCanvas.height;
        oCanvas.className = 'editor-canvas-overlay';
        const oCtx = oCanvas.getContext('2d');
        pageWrapper.appendChild(oCanvas);

        // Element container for absolutely placed draggable widgets
        const elementContainer = document.createElement('div');
        elementContainer.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:20;';
        pageWrapper.appendChild(elementContainer);

        ui.workspaceGrid.appendChild(pageWrapper);

        const pc = {
          pageNum,
          wrapper: pageWrapper,
          canvas: pCanvas,
          overlayCanvas: oCanvas,
          overlayCtx: oCtx,
          elementContainer,
          drawHistory: [],
          redoHistory: []
        };
        
        setupCanvasInteractions(pc);
        pageContainers.push(pc);
      }

      setupToolbarEvents();
      ui.runBtn.disabled = false;

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF.';
    }
  }

  function setupCanvasInteractions(pc) {
    const oCanvas = pc.overlayCanvas;
    const oCtx = pc.overlayCtx;

    oCanvas.addEventListener('mousedown', (e) => {
      const rect = oCanvas.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      activePageContainer = pc;

      if (currentTool === 'select') {
        deselectAllElements();
        return;
      }

      if (currentTool === 'text') {
        placeTextAnnotation(pc, startX, startY);
        return;
      }

      if (['pen', 'highlighter', 'rect', 'circle'].includes(currentTool)) {
        isDrawing = true;
        shapeState = oCtx.getImageData(0, 0, oCanvas.width, oCanvas.height);
        
        if (currentTool === 'pen' || currentTool === 'highlighter') {
          oCtx.beginPath();
          oCtx.moveTo(startX, startY);
          oCtx.strokeStyle = currentTool === 'highlighter' ? hexToRgbA(brushColor, 0.4) : brushColor;
          oCtx.lineWidth = brushSize;
          oCtx.lineCap = 'round';
          oCtx.lineJoin = 'round';
        }
      }
    });

    oCanvas.addEventListener('mousemove', (e) => {
      if (!isDrawing || activePageContainer !== pc) return;

      const rect = oCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (currentTool === 'pen' || currentTool === 'highlighter') {
        oCtx.lineTo(x, y);
        oCtx.stroke();
      } else if (currentTool === 'rect') {
        oCtx.putImageData(shapeState, 0, 0);
        oCtx.strokeStyle = brushColor;
        oCtx.lineWidth = brushSize;
        oCtx.strokeRect(startX, startY, x - startX, y - startY);
      } else if (currentTool === 'circle') {
        oCtx.putImageData(shapeState, 0, 0);
        oCtx.strokeStyle = brushColor;
        oCtx.lineWidth = brushSize;
        oCtx.beginPath();
        const r = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
        oCtx.arc(startX, startY, r, 0, 2 * Math.PI);
        oCtx.stroke();
      }
    });

    const finishDraw = () => {
      if (!isDrawing || activePageContainer !== pc) return;
      isDrawing = false;
      pc.drawHistory.push(oCtx.getImageData(0, 0, oCanvas.width, oCanvas.height));
      pc.redoHistory = [];
    };

    oCanvas.addEventListener('mouseup', finishDraw);
    oCanvas.addEventListener('mouseleave', finishDraw);
  }

  function placeTextAnnotation(pc, x, y) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'editor-text-input-overlay';
    input.style.left = `${x}px`;
    input.style.top = `${y - 10}px`;
    input.style.color = brushColor;
    input.style.fontSize = `${textSize}px`;
    input.style.fontFamily = textFont;
    input.style.fontWeight = 'bold';
    input.style.pointerEvents = 'auto';
    input.style.zIndex = '100';
    
    pc.elementContainer.appendChild(input);
    input.focus();

    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') input.blur();
    });

    input.addEventListener('blur', () => {
      const val = input.value.trim();
      input.remove();
      
      if (val) {
        const fontStyle = `font-family: ${textFont}; font-size: ${textSize}px; color: ${brushColor}; font-weight: bold; overflow: hidden; word-break: break-all;`;
        const html = `<div class="text-content" style="${fontStyle}" data-val="${val}">${val}</div>`;
        const approxW = Math.max(80, val.length * (textSize * 0.65));
        const h = textSize + 10;
        
        const el = createDraggableElement(pc, html, approxW, h, x, y - (textSize/2), 'text');
        selectElement(el);
      }
    });
  }

  // Baking and Saving compiler
  ui.runBtn.addEventListener('click', async () => {
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Baking annotations and compiling PDF...</p>
        </div>
      </div>
    `;

    try {
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const pages = pdfDoc.getPages();

      for (const pc of pageContainers) {
        const pageIdx = pc.pageNum - 1;
        if (pageIdx >= pages.length) continue;
        
        const page = pages[pageIdx];
        const overlayBlob = await bakeElementsAndGetBlob(pc);
        const overlayBuffer = await overlayBlob.arrayBuffer();

        const embedImg = await pdfDoc.embedPng(overlayBuffer);
        const pageW = page.getWidth();
        const pageH = page.getHeight();

        page.drawImage(embedImg, {
          x: 0,
          y: 0,
          width: pageW,
          height: pageH
        });
      }

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
