import {
  downloadBlob,
  formatBytes,
  fileToArrayBuffer,
  renderPDFPageToObjectUrl,
  pdfjsDataFromBuffer,
  yieldToUI
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import { PDFDocument } from 'pdf-lib';
import { createOrganizeUI } from './shared.js';

export function initOrganize(container) {
  const ui = createOrganizeUI(container, 'Drag & Drop PDF file to Organize', 'Sort, duplicate, or delete pages visually', 'bi-grid-3x3-gap');
  
  let fileBuffer = null;
  let selectedFile = null;
  let pageList = []; // Array of { originalIndex, id, canvasUrl }
  let pageCounter = 0;

  function revokePageUrls(list) {
    for (const item of list) {
      if (item.canvasUrl && item.canvasUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.canvasUrl);
      }
    }
  }

  ui.settingsFields.innerHTML = `
    <p class="form-help">Drag page thumbnails or click actions to rearrange, duplicate, or remove pages.</p>
    <button id="btn-add-blank-page" class="btn btn-secondary" style="width:100%; margin-top: 1rem;">
      <i class="bi bi-file-earmark-plus"></i> Insert Blank Page
    </button>
  `;


  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Extracting pages...';

    try {
      revokePageUrls(pageList);
      fileBuffer = await fileToArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      const count = pdf.numPages;
      pageList = [];

      for (let i = 1; i <= count; i++) {
        ui.fileMeta.innerText = `Loading thumbnails... Page ${i} of ${count}`;
        const page = await pdf.getPage(i);
        // Object URLs are far cheaper than base64 data URLs for preview grids
        const canvasUrl = await renderPDFPageToObjectUrl(page, 0.4, 0.72);

        pageList.push({
          id: pageCounter++,
          originalIndex: i - 1, // 0-indexed
          type: 'original',
          canvasUrl
        });
        if (i % 3 === 0) await yieldToUI();
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
      card.setAttribute('draggable', true);
      
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

      // Drag and Drop Event Listeners
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', index);
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '0.4';
      });

      card.addEventListener('dragend', () => {
        card.style.opacity = '1';
        ui.pagesGrid.querySelectorAll('.page-thumbnail-card').forEach(c => {
          c.style.border = '2px solid transparent';
          c.style.transform = '';
          c.style.boxShadow = '';
        });
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });

      card.addEventListener('dragenter', () => {
        card.style.border = '2px dashed var(--primary-color)';
        card.style.transform = 'scale(1.03)';
        card.style.boxShadow = '0 0 12px rgba(99, 102, 241, 0.4)';
      });

      card.addEventListener('dragleave', () => {
        card.style.border = '2px solid transparent';
        card.style.transform = '';
        card.style.boxShadow = '';
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.style.border = '2px solid transparent';
        card.style.transform = '';
        card.style.boxShadow = '';
        
        const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(draggedIndex) && draggedIndex !== index) {
          const [draggedItem] = pageList.splice(draggedIndex, 1);
          pageList.splice(index, 0, draggedItem);
          renderGrid();
        }
      });

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
