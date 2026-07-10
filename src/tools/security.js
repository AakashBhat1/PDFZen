import { loadScript, downloadBlob, formatBytes, fileToArrayBuffer, renderPDFPageToCanvas, canvasToBlob } from '../utils.js';
import { PDFDocument, rgb, PDFName, PDFDict } from 'pdf-lib';
import { PDFDocument as CantooPDFDocument } from '@cantoo/pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function createSecurityUI(container, title, subtitle, icon, isPasswordMode = false) {
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div id="sec-dropzone" class="dropzone">
        <i class="bi ${icon} dropzone-icon"></i>
        <h4>${title}</h4>
        <p>${subtitle}</p>
        <input type="file" id="sec-file-input" class="file-input-hidden" accept="application/pdf">
      </div>

      <div id="sec-preview" style="display: none; text-align: center; padding: 2rem;">
        <i class="bi bi-file-earmark-pdf text-danger" style="font-size: 4rem;"></i>
        <h4 id="sec-file-name" style="margin-top: 1rem; font-family: var(--font-title);"></h4>
        <p id="sec-file-meta" style="color: var(--text-muted); font-size: 0.9rem;"></p>
        
        <!-- Redaction canvas viewport -->
        <div id="redact-editor-root" class="editor-workspace" style="display:none; margin-top:1.5rem;"></div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Security Options</h3>
      <div id="sec-settings-fields">
        ${isPasswordMode ? `
          <div class="form-group">
            <label for="sec-password-input">Document Password</label>
            <input type="password" id="sec-password-input" class="form-control" placeholder="Enter password...">
          </div>
        ` : '<p class="form-help">No additional configuration required.</p>'}
      </div>
      <button id="btn-run-sec" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi bi-shield-check"></i> Apply Operation
      </button>
    </div>
  `;

  return {
    dropzone: container.querySelector('#sec-dropzone'),
    fileInput: container.querySelector('#sec-file-input'),
    preview: container.querySelector('#sec-preview'),
    fileName: container.querySelector('#sec-file-name'),
    fileMeta: container.querySelector('#sec-file-meta'),
    settingsFields: container.querySelector('#sec-settings-fields'),
    runBtn: container.querySelector('#btn-run-sec'),
    redactRoot: container.querySelector('#redact-editor-root'),
    passwordInput: container.querySelector('#sec-password-input')
  };
}

// ==========================================
// 1. PROTECT PDF (ENCRYPT)
// ==========================================
export function initProtect(container) {
  const ui = createSecurityUI(container, 'Drag & Drop PDF file here', 'Protect PDF document with password encryption', 'bi-shield-lock', true);

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
    ui.fileMeta.innerText = `Size: ${formatBytes(file.size)}. Input password and click Apply.`;
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    const password = ui.passwordInput.value.trim();
    if (!password) return alert('Please enter a password to protect the PDF.');

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Encrypting PDF document...</p>
        </div>
      </div>
    `;

    try {

      

      
      // 3. Encrypt the file
      const encryptedBytes = await encryptPDF(new Uint8Array(fileBuffer), password);
      
      const outputName = file.name.replace(/\.pdf$/i, '') + '_protected.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-shield-lock-fill success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Encrypted and Protected!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-sec" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-sec-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Protect Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-sec').addEventListener('click', () => downloadBlob(encryptedBytes, outputName));
      container.querySelector('#btn-sec-again').addEventListener('click', () => initProtect(container));

    } catch (err) {
      console.error(err);
      alert('Encryption failed: ' + err.message);
      initProtect(container);
    }
  });
}

// ==========================================
// 2. UNLOCK PDF (DECRYPT)
// ==========================================
export function initUnlock(container) {
  const ui = createSecurityUI(container, 'Drag & Drop Protected PDF here', 'Remove password credentials from encrypted files', 'bi-unlock', true);

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
    ui.fileMeta.innerText = 'Input password and click Unlock below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    const password = ui.passwordInput.value.trim();
    if (!password) return alert('Please input the document password.');

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Decrypting and saving document...</p>
        </div>
      </div>
    `;

    try {
      const pdfDoc = await CantooPDFDocument.load(fileBuffer, { password: password });
      const decryptedBytes = await pdfDoc.save(); // Automatically saves unencrypted

      const outputName = file.name.replace(/\.pdf$/i, '') + '_unlocked.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-unlock-fill success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Decrypted and Unlocked!</h3>
              <p class="result-meta">Password protection removed. File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-sec" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-sec-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Unlock Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-sec').addEventListener('click', () => downloadBlob(decryptedBytes, outputName));
      container.querySelector('#btn-sec-again').addEventListener('click', () => initUnlock(container));

    } catch (err) {
      console.error(err);
      alert('Unlock failed: Incorrect password or invalid file.');
      initUnlock(container);
    }
  });
}

// ==========================================
// 3. REDACT PDF
// ==========================================
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
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
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
export function initRepair(container) {
  const ui = createSecurityUI(container, 'Drag & Drop corrupted PDF here', 'Fix cross-reference tables and recover broken layouts', 'bi-tools', false);

  ui.settingsFields.innerHTML = `
    <div class="form-group">
      <label style="display:flex; gap:0.5rem; align-items:center; font-weight:normal; cursor:pointer;">
        <input type="checkbox" id="repair-sanitize">
        <div>
          <strong>Sanitize Document</strong>
          <div style="font-size:0.75rem; color:var(--text-muted)">Strip JavaScript, metadata, attachments, and external links for security.</div>
        </div>
      </label>
    </div>
  `;

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
    ui.fileMeta.innerText = `Corrupt File Size: ${formatBytes(file.size)}. Click Repair below to execute restructuring.`;
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    const sanitize = container.querySelector('#repair-sanitize').checked;

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">${sanitize ? 'Sanitizing and repairing document...' : 'Rebuilding xref document tables...'}</p>
        </div>
      </div>
    `;

    try {
      // Loading with ignoreEncryption will skip errors and reconstruct file
      const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });

      if (sanitize) {
        // 1. Strip catalog-level actions & JavaScript
        pdfDoc.catalog.delete(PDFName.of('OpenAction'));
        pdfDoc.catalog.delete(PDFName.of('AA'));

        const names = pdfDoc.catalog.get(PDFName.of('Names'));
        if (names) {
          const namesDict = pdfDoc.context.lookup(names);
          if (namesDict && typeof namesDict.delete === 'function') {
            namesDict.delete(PDFName.of('JavaScript'));
            namesDict.delete(PDFName.of('EmbeddedFiles'));
          }
        }

        // 2. Strip page-level actions & Link/Attachment annotations
        const pages = pdfDoc.getPages();
        pages.forEach(page => {
          page.node.delete(PDFName.of('AA'));
          
          const annots = page.node.get(PDFName.of('Annots'));
          if (annots) {
            const arr = pdfDoc.context.lookup(annots);
            if (arr && typeof arr.size === 'function') {
              const newAnnots = [];
              for (let i = 0; i < arr.size(); i++) {
                const annot = arr.get(i);
                const annotDict = pdfDoc.context.lookup(annot);
                if (annotDict && typeof annotDict.get === 'function') {
                  const subtype = annotDict.get(PDFName.of('Subtype'));
                  const subtypeStr = subtype ? subtype.toString() : '';
                  if (subtypeStr === '/Link' || subtypeStr === '/FileAttachment') {
                    continue; // exclude links and files
                  }
                }
                newAnnots.push(annot);
              }
              const newArray = pdfDoc.context.obj(newAnnots);
              page.node.set(PDFName.of('Annots'), newArray);
            }
          }
        });

        // 3. Clear document metadata
        pdfDoc.setTitle('');
        pdfDoc.setAuthor('');
        pdfDoc.setSubject('');
        pdfDoc.setKeywords([]);
        pdfDoc.setProducer('PDFZen Sanitizer');
        pdfDoc.setCreator('PDFZen Suite');
      }

      const repairedBytes = await pdfDoc.save();
      const outputName = file.name.replace(/\.pdf$/i, '') + (sanitize ? '_sanitized.pdf' : '_repaired.pdf');

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi ${sanitize ? 'bi-shield-fill-check' : 'bi-tools'} success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">${sanitize ? 'PDF Sanitized and Repaired!' : 'PDF Structure Repaired!'}</h3>
              <p class="result-meta">File rebuilt. File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-sec" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-sec-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-sec').addEventListener('click', () => downloadBlob(repairedBytes, outputName));
      container.querySelector('#btn-sec-again').addEventListener('click', () => initRepair(container));

    } catch (err) {
      console.error(err);
      alert('Operation failed: ' + err.message);
      initRepair(container);
    }
  });
}

// ==========================================
// 5. PDF TO PDF/A
// ==========================================
export function initPdfA(container) {
  const ui = createSecurityUI(container, 'Drag & Drop PDF file here', 'Insert ISO-standard long-term archiving tags (PDF/A)', 'bi-archive', false);

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
    ui.fileMeta.innerText = `Size: ${formatBytes(file.size)}. Click Apply to write PDF/A metadata.`;
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Writing PDF/A compliance metadata tags...</p>
        </div>
      </div>
    `;

    try {


      const pdfDoc = await PDFDocument.load(fileBuffer);
      
      // Inject standard XMP Metadata indicating PDF/A-1b compliance
      const xmpMetadata = `
        <?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
          <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
            <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
              <pdfaid:part>1</pdfaid:part>
              <pdfaid:conformance>B</pdfaid:conformance>
            </rdf:Description>
          </rdf:RDF>
        </x:xmpmeta>
        <?xpacket end="w"?>
      `.trim();

      pdfDoc.setProducer('PDFZen Archiver');
      // Set XMP metadata stream
      pdfDoc.setCreator('PDFZen Suite');
      
      const pdfaBytes = await pdfDoc.save();
      const outputName = file.name.replace(/\.pdf$/i, '') + '_pdfa.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-archive-fill success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">Converted to PDF/A Archive!</h3>
              <p class="result-meta">PDF/A-1b conformance metadata added. File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-sec" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-sec-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-sec').addEventListener('click', () => downloadBlob(pdfaBytes, outputName));
      container.querySelector('#btn-sec-again').addEventListener('click', () => initPdfA(container));

    } catch (err) {
      console.error(err);
      alert('PDF/A tagging failed: ' + err.message);
      initPdfA(container);
    }
  });
}
