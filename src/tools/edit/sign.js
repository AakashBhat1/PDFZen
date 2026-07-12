import {
  downloadBlob,
  fileToArrayBuffer,
  renderPDFPageToCanvas,
  pdfjsDataFromBuffer,
  canvasToBlob
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import { PDFDocument } from 'pdf-lib';
import {
  bakeElementsAndGetBlob,
  createDraggableElement,
  createEditorUI,
  getStageSize,
  selectElement
} from './shared.js';

const SIG_STORAGE_KEY = 'pdfzen_saved_signatures';
const SIG_ACTIVE_KEY = 'pdfzen_active_signature_id';
const MAX_SAVED_SIGNATURES = 12;

// ---------- Signature persistence ----------

function loadSavedSignatures() {
  try {
    const raw = localStorage.getItem(SIG_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persistSignatures(list) {
  localStorage.setItem(SIG_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED_SIGNATURES)));
}

function saveSignatureToStore({ dataUrl, label, source }) {
  const list = loadSavedSignatures().filter((s) => s.dataUrl !== dataUrl);
  const entry = {
    id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    dataUrl,
    label: label || `Signature ${list.length + 1}`,
    source: source || 'draw',
    createdAt: Date.now()
  };
  list.unshift(entry);
  persistSignatures(list);
  localStorage.setItem(SIG_ACTIVE_KEY, entry.id);
  return entry;
}

function deleteSavedSignature(id) {
  const list = loadSavedSignatures().filter((s) => s.id !== id);
  persistSignatures(list);
  if (localStorage.getItem(SIG_ACTIVE_KEY) === id) {
    localStorage.removeItem(SIG_ACTIVE_KEY);
  }
  return list;
}

function getActiveSavedSignature() {
  const id = localStorage.getItem(SIG_ACTIVE_KEY);
  const list = loadSavedSignatures();
  if (id) {
    const found = list.find((s) => s.id === id);
    if (found) return found;
  }
  return list[0] || null;
}

function isCanvasEffectivelyBlank(canvas) {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Any non-transparent pixel counts as ink
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 8) return false;
  }
  return true;
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = (header.match(/:(.*?);/) || [])[1] || 'image/png';
  const binary = atob(b64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ---------- Tool ----------

export function initSign(container) {
  const ui = createEditorUI(
    container,
    'Drag & Drop PDF file to Sign',
    'Place your signature or digital stamp securely onto document pages',
    true
  );

  let fileBuffer = null;
  let selectedFile = null;
  let pageContainers = [];

  let signatureImgUrl = null;
  let signatureImgBlob = null;
  let activeSigId = null;
  let isSigDrawing = false;
  let sigCtx = null;
  let activeInkColor = '#000000';
  let padWired = false;

  let uploadedSigImgUrl = null;
  let uploadedSigBlob = null;

  // Restore last-used signature immediately (even before a PDF is loaded)
  const restored = getActiveSavedSignature();
  if (restored) {
    setActiveSignature(restored.dataUrl, restored.id, false);
  }
  renderSavedSignatureList();

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  // Wire pad once (UI exists for the lifetime of this tool session)
  setupSigDrawPad();

  function setActiveSignature(dataUrl, id = null, updatePreviewSrc = true) {
    signatureImgUrl = dataUrl;
    signatureImgBlob = dataUrl.startsWith('data:') ? dataUrlToBlob(dataUrl) : null;
    activeSigId = id;
    if (id) localStorage.setItem(SIG_ACTIVE_KEY, id);

    if (ui.activeSigBox) ui.activeSigBox.style.display = 'block';
    if (ui.activeSigImg && updatePreviewSrc) ui.activeSigImg.src = dataUrl;
    if (ui.runBtn && pageContainers.length > 0) ui.runBtn.disabled = false;
  }

  function renderSavedSignatureList() {
    if (!ui.savedSigList) return;
    const list = loadSavedSignatures();
    if (list.length === 0) {
      ui.savedSigList.innerHTML =
        '<p class="form-help" style="margin:0.25rem 0 0.5rem;">No saved signatures yet. Create one below.</p>';
      return;
    }

    ui.savedSigList.innerHTML = list
      .map(
        (s) => `
      <div class="saved-sig-item ${s.id === activeSigId ? 'active' : ''}" data-id="${s.id}">
        <button type="button" class="saved-sig-pick" title="Use this signature">
          <img src="${s.dataUrl}" alt="${s.label}">
        </button>
        <button type="button" class="saved-sig-delete" title="Delete saved signature" data-id="${s.id}">
          <i class="bi bi-x"></i>
        </button>
      </div>`
      )
      .join('');

    ui.savedSigList.querySelectorAll('.saved-sig-item').forEach((item) => {
      const id = item.dataset.id;
      item.querySelector('.saved-sig-pick').addEventListener('click', () => {
        const entry = loadSavedSignatures().find((s) => s.id === id);
        if (!entry) return;
        setActiveSignature(entry.dataUrl, entry.id);
        renderSavedSignatureList();
      });
      item.querySelector('.saved-sig-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSavedSignature(id);
        if (activeSigId === id) {
          activeSigId = null;
          signatureImgUrl = null;
          signatureImgBlob = null;
          if (ui.activeSigBox) ui.activeSigBox.style.display = 'none';
          const next = getActiveSavedSignature();
          if (next) setActiveSignature(next.dataUrl, next.id);
        }
        renderSavedSignatureList();
      });
    });
  }

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Rendering PDF document...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      const totalPages = pdf.numPages;
      ui.fileMeta.innerText = `Total Pages: ${totalPages} — click a page to place your signature`;
      ui.workspaceGrid.innerHTML = '';
      pageContainers = [];

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const pCanvas = await renderPDFPageToCanvas(page, 1.5);

        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'editor-page-container';
        pageWrapper.dataset.page = pageNum;

        const badge = document.createElement('div');
        badge.className = 'page-badge';
        badge.innerText = `Page ${pageNum} of ${totalPages}`;
        pageWrapper.appendChild(badge);

        // Stage isolates canvas + overlays so placement coords match the page bitmap
        const stage = document.createElement('div');
        stage.className = 'editor-page-stage';
        stage.appendChild(pCanvas);

        const oCanvas = document.createElement('canvas');
        oCanvas.width = pCanvas.width;
        oCanvas.height = pCanvas.height;
        oCanvas.className = 'editor-canvas-overlay';
        oCanvas.style.cursor = signatureImgUrl ? 'crosshair' : 'pointer';
        const oCtx = oCanvas.getContext('2d');
        stage.appendChild(oCanvas);

        const elementContainer = document.createElement('div');
        elementContainer.className = 'editor-element-layer';
        stage.appendChild(elementContainer);

        pageWrapper.appendChild(stage);
        ui.workspaceGrid.appendChild(pageWrapper);

        const pc = {
          pageNum,
          wrapper: pageWrapper,
          stage,
          canvas: pCanvas,
          overlayCanvas: oCanvas,
          overlayCtx: oCtx,
          elementContainer
        };

        const placeFromEvent = (e) => {
          if (!signatureImgUrl) {
            ui.drawSigBtn.click();
            return;
          }
          const rect = stage.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const clickY = e.clientY - rect.top;
          placeSignatureAt(pc, clickX, clickY);
        };

        // Hit either the overlay canvas or empty stage area
        oCanvas.addEventListener('click', placeFromEvent);
        stage.addEventListener('click', (e) => {
          if (e.target === stage || e.target === pCanvas) placeFromEvent(e);
        });

        pageContainers.push(pc);
      }

      if (signatureImgUrl) {
        ui.runBtn.disabled = false;
        // Wait a frame so layout/max-width sizing is final, then show a stamp
        requestAnimationFrame(() => {
          if (!pageContainers[0]) return;
          const { width, height } = getStageSize(pageContainers[0]);
          placeSignatureAt(
            pageContainers[0],
            Math.min(160, width * 0.25),
            Math.max(80, height * 0.75)
          );
        });
      }
    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF.';
    }
  }

  function setupSigDrawPad() {
    if (padWired) return;
    padWired = true;

    sigCtx = ui.sigDrawCanvas.getContext('2d');
    sigCtx.strokeStyle = activeInkColor;
    sigCtx.lineWidth = 3;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';

    const getPadPos = (e) => {
      const canvas = ui.sigDrawCanvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(1, rect.width);
      const scaleY = canvas.height / Math.max(1, rect.height);
      const src = e.touches ? e.touches[0] : e;
      return {
        x: (src.clientX - rect.left) * scaleX,
        y: (src.clientY - rect.top) * scaleY
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      isSigDrawing = true;
      const { x, y } = getPadPos(e);
      sigCtx.beginPath();
      sigCtx.moveTo(x, y);
    };
    const moveDraw = (e) => {
      if (!isSigDrawing) return;
      e.preventDefault();
      const { x, y } = getPadPos(e);
      sigCtx.lineTo(x, y);
      sigCtx.stroke();
    };
    const endDraw = () => {
      isSigDrawing = false;
    };

    ui.sigDrawCanvas.addEventListener('mousedown', startDraw);
    ui.sigDrawCanvas.addEventListener('mousemove', moveDraw);
    ui.sigDrawCanvas.addEventListener('mouseup', endDraw);
    ui.sigDrawCanvas.addEventListener('mouseleave', endDraw);
    ui.sigDrawCanvas.addEventListener('touchstart', startDraw, { passive: false });
    ui.sigDrawCanvas.addEventListener('touchmove', moveDraw, { passive: false });
    ui.sigDrawCanvas.addEventListener('touchend', endDraw);

    ui.sigColorSelect.addEventListener('change', (e) => {
      activeInkColor = e.target.value;
      sigCtx.strokeStyle = activeInkColor;
    });

    const tabs = container.querySelectorAll('.sig-tab-btn');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        container.querySelectorAll('.sig-tab-content').forEach((c) => c.classList.remove('active'));
        tab.classList.add('active');
        container.querySelector(`#tab-${tab.dataset.tab}`).classList.add('active');
      });
    });

    ui.sigTypeInput.addEventListener('input', (e) => {
      const text = e.target.value.trim() || 'Your Signature';
      container.querySelector('#preview-dancing').innerText = text;
      container.querySelector('#preview-greatvibes').innerText = text;
      container.querySelector('#preview-pacifico').innerText = text;
      container.querySelector('#preview-alexbrush').innerText = text;
    });

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

    // Open modal — do NOT wipe existing pad ink (user may reopen by mistake)
    ui.drawSigBtn.addEventListener('click', () => {
      ui.sigModal.classList.add('active');
      sigCtx.strokeStyle = activeInkColor;
    });

    ui.sigClose.addEventListener('click', () => ui.sigModal.classList.remove('active'));

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
      let dataUrl = null;
      let label = 'Signature';
      let source = activeTab;

      if (activeTab === 'draw-sig') {
        if (isCanvasEffectivelyBlank(ui.sigDrawCanvas)) {
          alert('Please draw your signature before saving.');
          return;
        }
        const blob = await canvasToBlob(ui.sigDrawCanvas, 'image/png');
        dataUrl = await blobToDataUrl(blob);
        label = 'Drawn signature';
      } else if (activeTab === 'type-sig') {
        const text = ui.sigTypeInput.value.trim();
        if (!text) {
          alert('Please type a name to generate a signature.');
          return;
        }

        // Wait for web fonts so typed signatures render correctly
        if (document.fonts?.ready) {
          try {
            await document.fonts.ready;
          } catch {
            /* ignore */
          }
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

        const blob = await canvasToBlob(tempCanvas, 'image/png');
        dataUrl = await blobToDataUrl(blob);
        label = text;
      } else if (activeTab === 'upload-sig') {
        if (!uploadedSigImgUrl) {
          alert('Please upload a signature image.');
          return;
        }
        dataUrl = uploadedSigImgUrl;
        label = uploadedSigBlob?.name || 'Uploaded signature';
      }

      if (!dataUrl) return;

      const entry = saveSignatureToStore({ dataUrl, label, source });
      setActiveSignature(entry.dataUrl, entry.id);
      renderSavedSignatureList();
      ui.sigModal.classList.remove('active');

      // Show stamp on the document right away
      if (pageContainers.length > 0) {
        const { width, height } = getStageSize(pageContainers[0]);
        placeSignatureAt(pageContainers[0], Math.min(160, width * 0.25), Math.max(80, height * 0.75));
        ui.runBtn.disabled = false;
      }
    });

    ui.stampSigBtn.addEventListener('click', () => {
      if (!signatureImgUrl) {
        ui.drawSigBtn.click();
        return;
      }
      if (pageContainers.length > 0) {
        const { width, height } = getStageSize(pageContainers[0]);
        placeSignatureAt(pageContainers[0], Math.min(160, width * 0.25), Math.max(80, height * 0.75));
        ui.runBtn.disabled = false;
      }
    });
  }

  function placeSignatureAt(pc, x, y) {
    if (!signatureImgUrl) return;

    const { width: stageW, height: stageH } = getStageSize(pc);
    // Size relative to page so it remains readable on large/small canvases
    const w = Math.max(100, Math.min(220, stageW * 0.28));
    const h = Math.max(44, w * 0.4);

    const left = Math.max(0, Math.min(Math.max(0, stageW - w), x - w / 2));
    const top = Math.max(0, Math.min(Math.max(0, stageH - h), y - h / 2));

    const html = `<img src="${signatureImgUrl}" alt="Signature" draggable="false" style="width:100%;height:100%;pointer-events:none;object-fit:contain;display:block;">`;
    const el = createDraggableElement(pc, html, w, h, left, top, 'signature');
    selectElement(el);
    ui.runBtn.disabled = false;

    // Ensure image paints even if browser delayed decode
    const img = el.querySelector('img');
    if (img && !img.complete) {
      img.onload = () => {
        /* browser will repaint */
      };
    }
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!fileBuffer) return;

    const anyPlaced = pageContainers.some(
      (pc) => pc.elementContainer.querySelectorAll('.placed-element').length > 0
    );
    if (!anyPlaced) {
      alert('Place at least one signature on a page before saving.');
      return;
    }

    ui.runBtn.disabled = true;
    const originalLabel = ui.runBtn.innerHTML;
    ui.runBtn.innerHTML = '<span class="spinner" style="width:1rem;height:1rem;border-width:2px;"></span> Saving...';

    try {
      // CRITICAL: bake while the page DOM is still mounted.
      // Detached nodes report offsetWidth/offsetLeft as 0, which produced blank signatures.
      const bakedOverlays = [];
      for (const pc of pageContainers) {
        const hasMarks =
          pc.elementContainer.querySelectorAll('.placed-element').length > 0 ||
          !isCanvasEffectivelyBlank(pc.overlayCanvas);
        if (!hasMarks) continue;
        const overlayBlob = await bakeElementsAndGetBlob(pc);
        bakedOverlays.push({ pageIdx: pc.pageNum - 1, overlayBlob });
      }

      if (bakedOverlays.length === 0) {
        throw new Error('No signature overlay could be rendered. Try placing the signature again.');
      }

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="processing-container">
            <div class="spinner"></div>
            <p class="processing-text">Compiling signed PDF...</p>
          </div>
        </div>
      `;

      const pdfDoc = await PDFDocument.load(fileBuffer);
      const pages = pdfDoc.getPages();

      for (const { pageIdx, overlayBlob } of bakedOverlays) {
        if (pageIdx >= pages.length) continue;
        const page = pages[pageIdx];
        const overlayBuffer = await overlayBlob.arrayBuffer();
        const embedSigImg = await pdfDoc.embedPng(overlayBuffer);
        page.drawImage(embedSigImg, {
          x: 0,
          y: 0,
          width: page.getWidth(),
          height: page.getHeight()
        });
      }

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_signed.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-pen success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Signed Successfully!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
              <p class="form-help" style="margin-top:0.5rem;">Your signature was saved for next time.</p>
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
