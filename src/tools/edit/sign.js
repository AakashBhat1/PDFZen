import {
  downloadBlob,
  fileToArrayBuffer,
  renderPDFPageToCanvas,
  pdfjsDataFromBuffer,
  canvasToBlob
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import { PDFDocument } from 'pdf-lib';
import { bakeElementsAndGetBlob, createDraggableElement, createEditorUI, selectElement } from './shared.js';

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
