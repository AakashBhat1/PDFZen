import { downloadBlob, fileToArrayBuffer, renderPDFPageToCanvas, canvasToBlob, pdfjsDataFromBuffer, yieldToUI, releaseCanvas } from '../utils.js';
import { PDFDocument } from 'pdf-lib';
import { pdfjsLib } from '../pdfjs-setup.js';

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

        ${!isSignMode ? `
        <!-- Floating toolbar for Edit PDF -->
        <div class="editor-toolbar">
          <button class="editor-toolbar-btn active" data-tool="select" title="Select & Move Elements">
            <i class="bi bi-arrows-move"></i> Select
          </button>
          <button class="editor-toolbar-btn" data-tool="text" title="Add Text Field">
            <i class="bi bi-type"></i> Text
          </button>
          <button class="editor-toolbar-btn" data-tool="pen" title="Freehand Draw">
            <i class="bi bi-pencil"></i> Pen
          </button>
          <button class="editor-toolbar-btn" data-tool="highlighter" title="Highlight Text">
            <i class="bi bi-brightness-high"></i> Highlight
          </button>
          
          <span class="editor-toolbar-separator"></span>
          
          <button class="editor-toolbar-btn" data-tool="rect" title="Draw Rectangle">
            <i class="bi bi-square"></i> Rectangle
          </button>
          <button class="editor-toolbar-btn" data-tool="circle" title="Draw Circle">
            <i class="bi bi-circle"></i> Circle
          </button>
          
          <span class="editor-toolbar-separator"></span>

          <button class="editor-toolbar-btn" id="btn-add-img" title="Insert Image Stamp">
            <i class="bi bi-image"></i> Image
          </button>
          
          <input type="file" id="stamp-image-input" style="display:none;" accept="image/*">
          
          <span class="editor-toolbar-separator"></span>

          <button class="editor-toolbar-btn text-danger" id="btn-clear-active" title="Clear current page drawings">
            <i class="bi bi-trash"></i> Clear Page
          </button>
          <button class="editor-toolbar-btn" id="btn-undo" title="Undo last draw action">
            <i class="bi bi-arrow-counterclockwise"></i> Undo
          </button>
        </div>
        ` : ''}

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
            <i class="bi bi-pencil"></i> Create Signature
          </button>
        </div>
        <div id="signature-preview-box" class="form-group" style="display:none; margin-top: 0.75rem; text-align:center;">
          <label>Active Signature</label>
          <div style="padding:10px; background:#fff; border:1px solid var(--border-card); border-radius:8px; margin-top:0.25rem;">
            <img id="active-sig-img" style="max-height:80px; object-fit:contain; max-width:100%;">
          </div>
          <span class="form-help">Click active page to place, then drag and resize.</span>
          <button id="btn-stamp-sig" class="btn btn-secondary" style="width:100%; margin-top:0.75rem;">
            <i class="bi bi-patch-check"></i> Place on Page
          </button>
        </div>
      ` : `
        <!-- Edit PDF Properties Panel -->
        <div id="select-properties" class="properties-panel">
          <label>Select & Move Mode</label>
          <p class="form-help">Select elements (text, images, signatures) on the page to drag, resize, or delete them.</p>
        </div>

        <div id="draw-properties" class="properties-panel" style="display:none;">
          <label>Draw & Highlight Settings</label>
          <div style="margin-top: 0.5rem;">
            <label for="brush-color">Color</label>
            <input type="color" id="brush-color" class="form-control" value="#6366f1" style="height:35px; padding:0; cursor:pointer; margin-bottom: 0.5rem;">
            
            <label for="brush-size">Size (Thickness)</label>
            <select id="brush-size" class="form-control">
              <option value="2">Thin (2px)</option>
              <option value="4" selected>Medium (4px)</option>
              <option value="8">Thick (8px)</option>
              <option value="15">Extra Thick (15px)</option>
            </select>
          </div>
        </div>

        <div id="text-properties" class="properties-panel" style="display:none;">
          <label>Text Settings</label>
          <div style="margin-top: 0.5rem;">
            <label for="text-font-family">Font Family</label>
            <select id="text-font-family" class="form-control" style="margin-bottom: 0.5rem;">
              <option value="Arial" selected>Arial</option>
              <option value="Georgia">Georgia</option>
              <option value="Courier New">Courier New</option>
              <option value="Times New Roman">Times New Roman</option>
            </select>

            <label for="text-font-size">Font Size</label>
            <select id="text-font-size" class="form-control">
              <option value="12">12px</option>
              <option value="14">14px</option>
              <option value="16" selected>16px</option>
              <option value="20">20px</option>
              <option value="24">24px</option>
              <option value="32">32px</option>
            </select>
          </div>
        </div>
      `}

      <button id="btn-run-edit" class="btn btn-primary" style="width: 100%; margin-top: 1.5rem;" disabled>
        <i class="bi bi-file-earmark-check"></i> Save Changes
      </button>
    </div>

    <!-- Signature drawing Modal dialog -->
    <div id="modal-sig-pad" class="modal-overlay">
      <div class="modal-card" style="max-width: 500px;">
        <div class="modal-header">
          <h3>Create Your Signature</h3>
          <button class="modal-close" id="sig-pad-close"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="modal-body" style="align-items:center; padding: 1.25rem;">
          
          <!-- Tab Navigation -->
          <div class="sig-tabs">
            <button class="sig-tab-btn active" data-tab="draw-sig">Draw</button>
            <button class="sig-tab-btn" data-tab="type-sig">Type</button>
            <button class="sig-tab-btn" data-tab="upload-sig">Upload</button>
          </div>

          <!-- Draw Signature Tab Content -->
          <div id="tab-draw-sig" class="sig-tab-content active">
            <div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 0.75rem; width: 100%;">
              <label style="margin:0; font-size:14px;">Ink Color:</label>
              <select id="sig-draw-color" class="form-control" style="width: 120px; height: 32px; padding: 2px 8px;">
                <option value="#000000" selected>Black</option>
                <option value="#0000ff">Blue</option>
                <option value="#ff0000">Red</option>
              </select>
            </div>
            <canvas id="sig-draw-canvas" width="440" height="200" style="background:#fff; border:2px dashed #ccc; border-radius:8px; cursor:crosshair;"></canvas>
            <p class="form-help" style="margin-top: 0.5rem;">Use your mouse, pen, or touchpad to draw your signature.</p>
          </div>

          <!-- Type Signature Tab Content -->
          <div id="tab-type-sig" class="sig-tab-content">
            <div class="form-group" style="width:100%; margin-bottom: 0.75rem;">
              <label for="sig-type-input">Type your name</label>
              <input type="text" id="sig-type-input" class="form-control" placeholder="e.g. John Doe" value="">
            </div>
            <div class="form-group" style="width:100%; margin-bottom: 0.75rem;">
              <label>Select Font Style</label>
              <div style="display:flex; flex-direction:column; gap:0.5rem; width:100%;">
                <label style="display:flex; align-items:center; gap:0.75rem; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; cursor:pointer;">
                  <input type="radio" name="sig-font-choice" value="sig-font-dancing" checked>
                  <span class="sig-font-dancing" id="preview-dancing" style="color:var(--text-main);">John Doe</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.75rem; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; cursor:pointer;">
                  <input type="radio" name="sig-font-choice" value="sig-font-greatvibes">
                  <span class="sig-font-greatvibes" id="preview-greatvibes" style="color:var(--text-main);">John Doe</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.75rem; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; cursor:pointer;">
                  <input type="radio" name="sig-font-choice" value="sig-font-pacifico">
                  <span class="sig-font-pacifico" id="preview-pacifico" style="color:var(--text-main);">John Doe</span>
                </label>
                <label style="display:flex; align-items:center; gap:0.75rem; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; cursor:pointer;">
                  <input type="radio" name="sig-font-choice" value="sig-font-alexbrush">
                  <span class="sig-font-alexbrush" id="preview-alexbrush" style="color:var(--text-main);">John Doe</span>
                </label>
              </div>
            </div>
          </div>

          <!-- Upload Signature Tab Content -->
          <div id="tab-upload-sig" class="sig-tab-content">
            <div class="form-group" style="width:100%; text-align:center;">
              <div id="sig-upload-dropzone" style="border: 2px dashed var(--border-card); border-radius: 8px; padding: 2rem; cursor: pointer; background: rgba(255,255,255,0.02);">
                <i class="bi bi-cloud-arrow-up" style="font-size: 2rem; color: var(--primary-color);"></i>
                <p style="margin: 0.5rem 0 0 0; font-size:14px;">Drag & Drop signature image, or click to browse</p>
                <span class="form-help">Supports PNG, JPG (transparent background works best)</span>
                <input type="file" id="sig-image-file-input" style="display:none;" accept="image/*">
              </div>
              <div id="sig-upload-preview-container" style="display:none; margin-top:1rem; padding:10px; background:#fff; border-radius:8px; text-align:center;">
                <img id="sig-upload-preview-img" style="max-height:100px; object-fit:contain; max-width:100%;">
              </div>
            </div>
          </div>

        </div>
        <div class="modal-footer">
          <button id="btn-clear-sig" class="btn btn-secondary">Clear</button>
          <button id="btn-save-sig" class="btn btn-primary">Create Signature</button>
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
    sigColorSelect: container.querySelector('#sig-draw-color'),
    sigTypeInput: container.querySelector('#sig-type-input'),
    stampSigBtn: container.querySelector('#btn-stamp-sig')
  };
}

// Helper: Convert hex to RGBA for transparent highlighters
function hexToRgbA(hex, alpha) {
  let c;
  if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
    c = hex.substring(1).split('');
    if (c.length === 3) {
      c = [c[0], c[0], c[1], c[1], c[2], c[2]];
    }
    c = '0x' + c.join('');
    return 'rgba(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',') + ',' + alpha + ')';
  }
  return hex;
}

// Global selected annotation elements management
let selectedElement = null;

function deselectAllElements() {
  document.querySelectorAll('.placed-element').forEach(el => {
    el.classList.remove('selected');
  });
  selectedElement = null;
}

function selectElement(el) {
  deselectAllElements();
  selectedElement = el;
  el.classList.add('selected');
}

function setupDragAndResize(el, pc) {
  let isDragging = false;
  let isResizing = false;
  let startX, startY;
  let startW, startH;
  let startLeft, startTop;

  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('resize-handle')) {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = el.offsetWidth;
      startH = el.offsetHeight;
    } else if (e.target.closest('.delete-handle')) {
      return;
    } else {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.offsetLeft;
      startTop = el.offsetTop;
    }
    e.preventDefault();
    e.stopPropagation();
    selectElement(el);
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxLeft = pc.overlayCanvas.width - el.offsetWidth;
      const maxTop = pc.overlayCanvas.height - el.offsetHeight;
      
      let newLeft = Math.max(0, Math.min(maxLeft, startLeft + dx));
      let newTop = Math.max(0, Math.min(maxTop, startTop + dy));
      
      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;
    } else if (isResizing) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      let newWidth = Math.max(40, startW + dx);
      let newHeight = Math.max(20, startH + dy);
      
      el.style.width = `${newWidth}px`;
      el.style.height = `${newHeight}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    isResizing = false;
  });
}

function createDraggableElement(pc, htmlContent, width, height, left, top, type) {
  const el = document.createElement('div');
  el.className = 'placed-element';
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.pointerEvents = 'auto';
  el.dataset.type = type; // 'text', 'image', 'signature'
  
  el.innerHTML = `
    ${htmlContent}
    <div class="delete-handle" title="Delete element"><i class="bi bi-x-lg"></i></div>
    <div class="resize-handle" title="Resize element"></div>
  `;
  
  pc.elementContainer.appendChild(el);
  
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    selectElement(el);
  });
  
  setupDragAndResize(el, pc);
  
  el.querySelector('.delete-handle').addEventListener('click', (e) => {
    e.stopPropagation();
    el.remove();
    if (selectedElement === el) {
      selectedElement = null;
    }
  });

  // Enable double-click to edit text content
  if (type === 'text') {
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const textDiv = el.querySelector('.text-content');
      const oldText = textDiv.dataset.val || textDiv.innerText;
      const newText = prompt("Edit text annotation:", oldText);
      if (newText !== null && newText.trim() !== "") {
        textDiv.innerText = newText.trim();
        textDiv.dataset.val = newText.trim();
      }
    });
  }

  return el;
}

// Bake drawings and DOM components into one overlay png per page
async function bakeElementsAndGetBlob(pc) {
  const oCanvas = pc.overlayCanvas;
  
  const bakeCanvas = document.createElement('canvas');
  bakeCanvas.width = oCanvas.width;
  bakeCanvas.height = oCanvas.height;
  const bakeCtx = bakeCanvas.getContext('2d');

  // 1. Draw drawings/shapes first
  bakeCtx.drawImage(oCanvas, 0, 0);

  // 2. Draw placed DOM elements (texts, images, signatures)
  const placedEls = pc.elementContainer.querySelectorAll('.placed-element');
  
  for (const el of placedEls) {
    const left = el.offsetLeft;
    const top = el.offsetTop;
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    if (el.dataset.type === 'text') {
      const textDiv = el.querySelector('.text-content');
      const text = textDiv.dataset.val || textDiv.innerText;
      const computed = window.getComputedStyle(textDiv);
      const color = computed.color || '#312e81';
      const font = computed.font || 'bold 16px Arial';
      
      bakeCtx.save();
      bakeCtx.fillStyle = color;
      bakeCtx.font = font;
      bakeCtx.textBaseline = 'top';
      bakeCtx.textAlign = 'left';
      bakeCtx.fillText(text, left + 4, top + 4);
      bakeCtx.restore();
    } else if (el.dataset.type === 'image' || el.dataset.type === 'signature') {
      const img = el.querySelector('img');
      if (img && img.src) {
        await new Promise((resolve) => {
          if (img.complete) {
            bakeCtx.drawImage(img, left, top, width, height);
            resolve();
          } else {
            img.onload = () => {
              bakeCtx.drawImage(img, left, top, width, height);
              resolve();
            };
            img.onerror = () => resolve();
          }
        });
      }
    }
  }

  return await canvasToBlob(bakeCanvas, 'image/png');
}

// ==========================================
// 1. EDIT PDF
// ==========================================
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
export function initSign(container) {
  const ui = createEditorUI(container, 'Drag & Drop PDF file to Sign', 'Place your signature or digital stamp securely onto document pages', true);

  let fileBuffer = null;
  let selectedFile = null;
  let pageContainers = [];

  // Signature state
  let signatureImgUrl = null;
  let signatureImgBlob = null;
  let isSigDrawing = false;
  let sigCtx = null;
  let activeInkColor = '#000000';

  // Draggable active signatures
  let placedSigEl = null;

  // Custom uploads
  let uploadedSigImgUrl = null;
  let uploadedSigBlob = null;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Rendering PDF document...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      const totalPages = pdf.numPages;
      ui.fileMeta.innerText = `Total Pages: ${totalPages}`;
      ui.workspaceGrid.innerHTML = '';
      pageContainers = [];

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const pCanvas = await renderPDFPageToCanvas(page, 1.5);
        
        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'editor-page-container';
        pageWrapper.style.position = 'relative';
        pageWrapper.dataset.page = pageNum;
        
        const badge = document.createElement('div');
        badge.className = 'page-badge';
        badge.innerText = `Page ${pageNum} of ${totalPages}`;
        pageWrapper.appendChild(badge);
        
        pageWrapper.appendChild(pCanvas);

        // Transparent canvas overlay
        const oCanvas = document.createElement('canvas');
        oCanvas.width = pCanvas.width;
        oCanvas.height = pCanvas.height;
        oCanvas.className = 'editor-canvas-overlay';
        oCanvas.style.pointerEvents = 'none'; // click goes through to click/place
        const oCtx = oCanvas.getContext('2d');
        pageWrapper.appendChild(oCanvas);

        // Absolute elements wrapper
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
          elementContainer
        };
        
        // Stamping click listener
        oCanvas.style.pointerEvents = 'auto';
        oCanvas.addEventListener('click', (e) => {
          if (!signatureImgUrl) {
            // If no signature yet, open creator modal
            ui.drawSigBtn.click();
            return;
          }
          const rect = oCanvas.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const clickY = e.clientY - rect.top;
          placeSignatureAt(pc, clickX, clickY);
        });

        pageContainers.push(pc);
      }

      setupSigDrawPad();

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF.';
    }
  }

  function setupSigDrawPad() {
    sigCtx = ui.sigDrawCanvas.getContext('2d');
    sigCtx.strokeStyle = activeInkColor;
    sigCtx.lineWidth = 3;
    sigCtx.lineCap = 'round';

    // Ink color changer
    ui.sigColorSelect.addEventListener('change', (e) => {
      activeInkColor = e.target.value;
      sigCtx.strokeStyle = activeInkColor;
    });

    // Tab Navigation controller
    const tabs = container.querySelectorAll('.sig-tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        container.querySelectorAll('.sig-tab-content').forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        const tabId = tab.dataset.tab;
        container.querySelector(`#tab-${tabId}`).classList.add('active');
      });
    });

    // Cursive Fonts preview binder
    ui.sigTypeInput.addEventListener('input', (e) => {
      const text = e.target.value.trim() || 'Your Signature';
      container.querySelector('#preview-dancing').innerText = text;
      container.querySelector('#preview-greatvibes').innerText = text;
      container.querySelector('#preview-pacifico').innerText = text;
      container.querySelector('#preview-alexbrush').innerText = text;
    });

    // Upload Signature Image binder
    const sigUploadDropzone = container.querySelector('#sig-upload-dropzone');
    const sigFileInput = container.querySelector('#sig-image-file-input');
    const sigUploadPreviewContainer = container.querySelector('#sig-upload-preview-container');
    const sigUploadPreviewImg = container.querySelector('#sig-upload-preview-img');

    sigUploadDropzone.addEventListener('click', () => sigFileInput.click());
    sigFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (evt) => {
          uploadedSigImgUrl = evt.target.result;
          sigUploadPreviewImg.src = uploadedSigImgUrl;
          sigUploadPreviewContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
        uploadedSigBlob = file;
      }
    });

    // Open/Close modal
    ui.drawSigBtn.addEventListener('click', () => {
      ui.sigModal.classList.add('active');
      // Reset
      sigCtx.clearRect(0, 0, ui.sigDrawCanvas.width, ui.sigDrawCanvas.height);
      sigCtx.strokeStyle = activeInkColor;
    });

    ui.sigClose.addEventListener('click', () => ui.sigModal.classList.remove('active'));

    // Canvas drawing binders
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
      ui.sigTypeInput.value = '';
      ui.sigTypeInput.dispatchEvent(new Event('input'));
      uploadedSigImgUrl = null;
      uploadedSigBlob = null;
      sigUploadPreviewContainer.style.display = 'none';
      sigFileInput.value = '';
    });

    ui.saveSig.addEventListener('click', async () => {
      const activeTab = container.querySelector('.sig-tab-btn.active').dataset.tab;

      if (activeTab === 'draw-sig') {
        signatureImgBlob = await canvasToBlob(ui.sigDrawCanvas, 'image/png');
        signatureImgUrl = URL.createObjectURL(signatureImgBlob);
      } else if (activeTab === 'type-sig') {
        const text = ui.sigTypeInput.value.trim();
        if (!text) {
          alert('Please type a name to generate signature.');
          return;
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 440;
        tempCanvas.height = 150;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

        const choice = container.querySelector('input[name="sig-font-choice"]:checked').value;
        let font = 'bold 36px "Dancing Script", cursive';
        if (choice === 'sig-font-greatvibes') font = '44px "Great Vibes", cursive';
        else if (choice === 'sig-font-pacifico') font = '30px "Pacifico", cursive';
        else if (choice === 'sig-font-alexbrush') font = '38px "Alex Brush", cursive';

        tempCtx.font = font;
        tempCtx.fillStyle = '#000000';
        tempCtx.textAlign = 'center';
        tempCtx.textBaseline = 'middle';
        tempCtx.fillText(text, 220, 75);

        signatureImgBlob = await canvasToBlob(tempCanvas, 'image/png');
        signatureImgUrl = URL.createObjectURL(signatureImgBlob);
      } else if (activeTab === 'upload-sig') {
        if (!uploadedSigImgUrl) {
          alert('Please upload a signature file.');
          return;
        }
        signatureImgBlob = uploadedSigBlob;
        signatureImgUrl = uploadedSigImgUrl;
      }

      ui.activeSigImg.src = signatureImgUrl;
      ui.activeSigBox.style.display = 'block';
      ui.sigModal.classList.remove('active');

      // Place default on first page
      if (pageContainers.length > 0) {
        placeSignatureAt(pageContainers[0], 100, 150);
      }
      ui.runBtn.disabled = false;
    });

    ui.stampSigBtn.addEventListener('click', () => {
      if (signatureImgUrl && pageContainers.length > 0) {
        const pc = pageContainers[0];
        placeSignatureAt(pc, 100, 150);
      }
    });
  }

  function placeSignatureAt(pc, x, y) {
    if (!signatureImgUrl) return;

    const html = `<img src="${signatureImgUrl}" style="width:100%; height:100%; pointer-events:none; object-fit:contain;">`;
    const w = 160;
    const h = 70;
    // Align centered on click coordinates
    const left = Math.max(0, Math.min(pc.overlayCanvas.width - w, x - w / 2));
    const top = Math.max(0, Math.min(pc.overlayCanvas.height - h, y - h / 2));

    const el = createDraggableElement(pc, html, w, h, left, top, 'signature');
    selectElement(el);
  }

  // Compiler for Sign PDF
  ui.runBtn.addEventListener('click', async () => {
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Baking signature onto PDF pages...</p>
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

        const embedSigImg = await pdfDoc.embedPng(overlayBuffer);
        const pageW = page.getWidth();
        const pageH = page.getHeight();

        page.drawImage(embedSigImg, {
          x: 0,
          y: 0,
          width: pageW,
          height: pageH
        });
      }

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_signed.pdf';

      if (signatureImgUrl && signatureImgUrl.startsWith('blob:')) {
        URL.revokeObjectURL(signatureImgUrl);
      }

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
