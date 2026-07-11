import { canvasToBlob } from '../../lib/utils.js';

export function createEditorUI(container, title, subtitle, isSignMode = false) {
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
export function hexToRgbA(hex, alpha) {
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

export function deselectAllElements() {
  document.querySelectorAll('.placed-element').forEach(el => {
    el.classList.remove('selected');
  });
  selectedElement = null;
}

export function selectElement(el) {
  deselectAllElements();
  selectedElement = el;
  el.classList.add('selected');
}

export function setupDragAndResize(el, pc) {
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

export function createDraggableElement(pc, htmlContent, width, height, left, top, type) {
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
export async function bakeElementsAndGetBlob(pc) {
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
