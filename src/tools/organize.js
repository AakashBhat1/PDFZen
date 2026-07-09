import { loadScript, downloadBlob, formatBytes, fileToArrayBuffer, renderPDFPageToCanvas } from '../utils.js';

// --- Shared PDF Input UI helper ---
function createOrganizeUI(container, title, subtitle, icon) {
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div id="org-dropzone" class="dropzone">
        <i class="bi ${icon} dropzone-icon"></i>
        <h4>${title}</h4>
        <p>${subtitle}</p>
        <input type="file" id="org-file-input" class="file-input-hidden" accept="application/pdf">
      </div>
      
      <div id="org-preview-container" style="display: none; margin-top: 1.5rem; width: 100%;">
        <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h4 style="font-family: var(--font-title);" id="org-preview-title">PDF Preview</h4>
          <span id="org-file-meta" class="form-help"></span>
        </div>
        <div id="org-pages-grid" class="organizer-grid"></div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Settings</h3>
      <div id="org-settings-fields"></div>
      <button id="btn-run-org" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi bi-check-circle"></i> Apply Changes
      </button>
    </div>
  `;

  return {
    dropzone: container.querySelector('#org-dropzone'),
    fileInput: container.querySelector('#org-file-input'),
    previewContainer: container.querySelector('#org-preview-container'),
    pagesGrid: container.querySelector('#org-pages-grid'),
    fileMeta: container.querySelector('#org-file-meta'),
    settingsFields: container.querySelector('#org-settings-fields'),
    runBtn: container.querySelector('#btn-run-org'),
    previewTitle: container.querySelector('#org-preview-title')
  };
}

// ==========================================
// 1. ORGANIZE PDF
// ==========================================
export function initOrganize(container) {
  const ui = createOrganizeUI(container, 'Drag & Drop PDF file to Organize', 'Sort, duplicate, or delete pages visually', 'bi-grid-3x3-gap');
  
  let fileBuffer = null;
  let selectedFile = null;
  let pageList = []; // Array of { originalIndex, id, canvasUrl }
  let pageCounter = 0;

  ui.settingsFields.innerHTML = `
    <p class="form-help">Drag page thumbnails or click actions to rearrange, duplicate, or remove pages.</p>
    <button id="btn-add-blank-page" class="btn btn-secondary" style="width:100%; margin-top: 1rem;">
      <i class="bi bi-file-earmark-plus"></i> Insert Blank Page
    </button>
  `;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Extracting pages...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      const count = pdf.numPages;
      pageList = [];

      for (let i = 1; i <= count; i++) {
        ui.fileMeta.innerText = `Loading thumbnails... Page ${i} of ${count}`;
        const page = await pdf.getPage(i);
        const canvas = await renderPDFPageToCanvas(page, 0.4);
        const canvasUrl = canvas.toDataURL();
        
        pageList.push({
          id: pageCounter++,
          originalIndex: i - 1, // 0-indexed
          type: 'original',
          canvasUrl: canvasUrl
        });
      }

      ui.fileMeta.innerText = `Pages: ${pageList.length} | Size: ${formatBytes(file.size)}`;
      ui.runBtn.disabled = false;
      renderGrid();

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF pages.';
    }
  }

  function renderGrid() {
    ui.pagesGrid.innerHTML = '';
    
    pageList.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'page-thumbnail-card';
      
      if (item.type === 'blank') {
        card.innerHTML = `
          <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:#fafafa; color:#ccc;">
            <i class="bi bi-file-earmark-plus" style="font-size:2rem;"></i>
          </div>
        `;
      } else {
        card.innerHTML = `<img src="${item.canvasUrl}" class="page-thumbnail-canvas">`;
      }

      card.innerHTML += `
        <span class="page-number-badge">${index + 1}</span>
        <div class="page-action-overlay">
          <button class="btn-overlay btn-move-left" title="Move Left"><i class="bi bi-arrow-left"></i></button>
          <button class="btn-overlay btn-move-right" title="Move Right"><i class="bi bi-arrow-right"></i></button>
          <button class="btn-overlay btn-duplicate" title="Duplicate"><i class="bi bi-copy"></i></button>
          <button class="btn-overlay btn-delete" title="Delete"><i class="bi bi-trash"></i></button>
        </div>
      `;

      card.querySelector('.btn-move-left').addEventListener('click', (e) => { e.stopPropagation(); shiftPage(index, -1); });
      card.querySelector('.btn-move-right').addEventListener('click', (e) => { e.stopPropagation(); shiftPage(index, 1); });
      card.querySelector('.btn-duplicate').addEventListener('click', (e) => { e.stopPropagation(); duplicatePage(index); });
      card.querySelector('.btn-delete').addEventListener('click', (e) => { e.stopPropagation(); deletePage(item.id); });

      ui.pagesGrid.appendChild(card);
    });
  }

  function shiftPage(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= pageList.length) return;
    const temp = pageList[index];
    pageList[index] = pageList[target];
    pageList[target] = temp;
    renderGrid();
  }

  function duplicatePage(index) {
    const clone = Object.assign({}, pageList[index]);
    clone.id = pageCounter++;
    pageList.splice(index + 1, 0, clone);
    renderGrid();
  }

  function deletePage(id) {
    pageList = pageList.filter(p => p.id !== id);
    renderGrid();
  }

  // Insert Blank page
  ui.settingsFields.querySelector('#btn-add-blank-page').addEventListener('click', () => {
    if (pageList.length === 0) return;
    pageList.push({
      id: pageCounter++,
      type: 'blank',
      originalIndex: -1
    });
    renderGrid();
  });

  ui.runBtn.addEventListener('click', async () => {
    if (pageList.length === 0) return;
    
    // Switch to loading
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Re-structuring PDF pages...</p>
        </div>
      </div>
    `;

    try {
      await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const { PDFDocument } = window.PDFLib;

      const srcDoc = await PDFDocument.load(fileBuffer);
      const newDoc = await PDFDocument.create();

      for (let i = 0; i < pageList.length; i++) {
        const item = pageList[i];
        if (item.type === 'blank') {
          newDoc.addPage([595.28, 841.89]); // Add blank A4 page
        } else {
          const [copiedPage] = await newDoc.copyPages(srcDoc, [item.originalIndex]);
          newDoc.addPage(copiedPage);
        }
      }

      const outputBytes = await newDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_organized.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-check-circle-fill success-icon"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Pages Organized Successfully!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong> (${formatBytes(outputBytes.length)})</p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-org" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-org-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Organize Again</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-org').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-org-again').addEventListener('click', () => initOrganize(container));

    } catch (err) {
      console.error(err);
      alert('Error organizing PDF: ' + err.message);
      initOrganize(container);
    }
  });
}

// ==========================================
// 2. ROTATE PDF
// ==========================================
export function initRotate(container) {
  const ui = createOrganizeUI(container, 'Drag & Drop PDF file to Rotate', 'Rotate individual pages or all pages at once', 'bi-arrow-clockwise');
  
  let fileBuffer = null;
  let selectedFile = null;
  let pageList = []; // Array of { id, originalIndex, rotationAngle, canvasUrl }

  ui.settingsFields.innerHTML = `
    <div class="form-group">
      <label>Batch Rotate</label>
      <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
        <button id="btn-rotate-all-95" class="btn btn-secondary" style="flex:1;"><i class="bi bi-arrow-clockwise"></i> +90° All</button>
        <button id="btn-rotate-all-180" class="btn btn-secondary" style="flex:1;"><i class="bi bi-arrow-repeat"></i> 180° All</button>
      </div>
    </div>
  `;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Extracting pages...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      const count = pdf.numPages;
      pageList = [];

      for (let i = 1; i <= count; i++) {
        const page = await pdf.getPage(i);
        const canvas = await renderPDFPageToCanvas(page, 0.4);
        
        pageList.push({
          id: i,
          originalIndex: i - 1,
          rotationAngle: 0, // In degrees (0, 90, 180, 270)
          canvasUrl: canvas.toDataURL()
        });
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
      await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const { PDFDocument, degrees } = window.PDFLib;

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
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

      pdfDocInstance = await window.pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
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

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Cropping PDF dimensions...</p>
        </div>
      </div>
    `;

    try {
      await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const { PDFDocument } = window.PDFLib;

      const pdfDoc = await PDFDocument.load(fileBuffer);
      const scope = container.querySelector('#crop-scope').value;

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

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
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
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      ui.fileMeta.innerText = `Pages: ${pdf.numPages} | Ready to stamp page numbers.`;
      
      // Load page 1 preview
      const page = await pdf.getPage(1);
      const canvas = await renderPDFPageToCanvas(page, 0.4);
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

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Stamping page numbers...</p>
        </div>
      </div>
    `;

    try {
      await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

      const pdfDoc = await PDFDocument.load(fileBuffer);
      const pages = pdfDoc.getPages();
      const count = pages.length;

      const position = container.querySelector('#num-pos').value;
      const format = container.querySelector('#num-format').value;
      const startNum = parseInt(container.querySelector('#num-start').value, 10) || 1;
      const skipFirst = container.querySelector('#num-skip-first').checked;

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

// ==========================================
// 5. WATERMARK PDF
// ==========================================
export function initWatermark(container) {
  const ui = createOrganizeUI(container, 'Drag & Drop PDF file here', 'Overlay text or images over pages', 'bi-textarea-t');
  
  let fileBuffer = null;
  let selectedFile = null;
  
  let watermarkImgBuffer = null;
  let watermarkImgType = 'jpeg';

  ui.settingsFields.innerHTML = `
    <div class="form-group">
      <label for="wm-type">Watermark Type</label>
      <select id="wm-type" class="form-control">
        <option value="text">Confidential Text</option>
        <option value="image">Custom Logo/Image</option>
      </select>
    </div>

    <!-- Text Group -->
    <div id="wm-text-group" class="form-group" style="margin-top:0.75rem;">
      <label for="wm-text">Text Stamp</label>
      <input type="text" id="wm-text" class="form-control" value="CONFIDENTIAL">
    </div>

    <!-- Image Group -->
    <div id="wm-image-group" class="form-group" style="margin-top:0.75rem; display:none;">
      <label for="wm-image-input">Upload Watermark Image</label>
      <input type="file" id="wm-image-input" class="form-control" accept="image/jpeg,image/png">
    </div>

    <div class="form-group" style="margin-top:0.75rem;">
      <label for="wm-opacity">Transparency (Opacity)</label>
      <select id="wm-opacity" class="form-control">
        <option value="0.2">High Transparency (20%)</option>
        <option value="0.4">Medium Transparency (40%)</option>
        <option value="0.6">Solid (60%)</option>
      </select>
    </div>
  `;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  const wmType = ui.settingsFields.querySelector('#wm-type');
  const textGroup = ui.settingsFields.querySelector('#wm-text-group');
  const imageGroup = ui.settingsFields.querySelector('#wm-image-group');
  const imgFileInput = ui.settingsFields.querySelector('#wm-image-input');

  wmType.addEventListener('change', () => {
    const val = wmType.value;
    textGroup.style.display = val === 'text' ? 'flex' : 'none';
    imageGroup.style.display = val === 'image' ? 'flex' : 'none';
  });

  imgFileInput.addEventListener('change', async (e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      watermarkImgType = file.type === 'image/png' ? 'png' : 'jpeg';
      watermarkImgBuffer = await fileToArrayBuffer(file);
    }
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Loading...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      ui.fileMeta.innerText = `Pages: ${pdf.numPages}`;
      
      const page = await pdf.getPage(1);
      const canvas = await renderPDFPageToCanvas(page, 0.4);
      ui.pagesGrid.innerHTML = '';
      ui.pagesGrid.appendChild(canvas);
      
      ui.runBtn.disabled = false;

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF.';
    }
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!fileBuffer) return;
    
    const type = wmType.value;
    if (type === 'image' && !watermarkImgBuffer) {
      return alert('Please upload a watermark logo image first.');
    }

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Stamping watermarks on PDF pages...</p>
        </div>
      </div>
    `;

    try {
      await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;

      const pdfDoc = await PDFDocument.load(fileBuffer);
      const pages = pdfDoc.getPages();
      
      const opacity = parseFloat(container.querySelector('#wm-opacity').value) || 0.2;

      if (type === 'text') {
        const textVal = container.querySelector('#wm-text').value.trim() || 'CONFIDENTIAL';
        const helvetica = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontSize = 48;
        const textWidth = helvetica.widthOfTextAtSize(textVal, fontSize);

        pages.forEach(page => {
          const w = page.getWidth();
          const h = page.getHeight();
          
          // Draw rotated diagonal watermark text in center
          page.drawText(textVal, {
            x: w / 2 - textWidth / 2 * Math.cos(45 * Math.PI / 180),
            y: h / 2 - 20,
            size: fontSize,
            font: helvetica,
            color: rgb(0.8, 0.2, 0.2), // Light Red stamp
            opacity: opacity,
            rotate: degrees(45)
          });
        });
      } else {
        // Image Logo stamp
        let embedImg;
        if (watermarkImgType === 'png') {
          embedImg = await pdfDoc.embedPng(watermarkImgBuffer);
        } else {
          embedImg = await pdfDoc.embedJpg(watermarkImgBuffer);
        }

        pages.forEach(page => {
          const w = page.getWidth();
          const h = page.getHeight();

          // Calculate central watermark bounding box size (say 30% page width)
          const scale = (w * 0.35) / embedImg.width;
          const drawW = embedImg.width * scale;
          const drawH = embedImg.height * scale;

          page.drawImage(embedImg, {
            x: w / 2 - drawW / 2,
            y: h / 2 - drawH / 2,
            width: drawW,
            height: drawH,
            opacity: opacity
          });
        });
      }

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_watermarked.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-textarea-t success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">Watermarks Stamped Successfully!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-wm" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-wm-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Again</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-wm').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-wm-again').addEventListener('click', () => initWatermark(container));

    } catch (err) {
      console.error(err);
      alert('Watermarking Failed: ' + err.message);
      initWatermark(container);
    }
  });
}
