import {
  downloadBlob,
  fileToArrayBuffer,
  renderPDFPageToCanvas,
  pdfjsDataFromBuffer,
  yieldToUI,
  releaseCanvas
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import Tesseract from 'tesseract.js';
import { createAIUI } from './shared.js';

export function initOcr(container) {
  const ui = createAIUI(container, {
    title: 'Drag & Drop Scanned PDF/Image here',
    subtitle: 'Extract text content client-side using Tesseract.js OCR',
    inputType: 'pdf',
    icon: 'bi-search-heart',
    actionText: 'Execute OCR',
    settingsHTML: `
      <div class="form-group">
        <label for="ocr-lang">Recognition Language</label>
        <select id="ocr-lang" class="form-control">
          <option value="eng" selected>English (eng)</option>
          <option value="spa">Spanish (spa)</option>
          <option value="fra">French (fra)</option>
          <option value="deu">German (deu)</option>
        </select>
      </div>
    `
  });

  let fileBuffer = null;
  let selectedFile = null;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.previewTitle.innerText = file.name;
    ui.fileMeta.innerText = 'PDF readied. Click Execute OCR below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);

    // Show visual thumbnail preview
    try {
      const pdf = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      const page = await pdf.getPage(1);
      const canvas = await renderPDFPageToCanvas(page, 0.4);
      ui.canvasContainer.innerHTML = '';
      ui.canvasContainer.appendChild(canvas);
    } catch (err) {
      console.error(err);
    }
  }

  ui.runBtn.addEventListener('click', async () => {
    const lang = container.querySelector('#ocr-lang').value;
    ui.canvasContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:0.75rem; width:100%; padding:2rem 0;">
        <div class="spinner"></div>
        <p style="font-size:0.9rem;" id="ocr-load-status">Loading OCR script libraries...</p>
      </div>
    `;
    ui.runBtn.disabled = true;

    try {
      const statusTxt = container.querySelector('#ocr-load-status');
      
      const pdfDoc = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      const totalPages = pdfDoc.numPages;
      let fullOcrText = '';

      for (let i = 1; i <= totalPages; i++) {
        statusTxt.innerText = `Rendering page ${i} of ${totalPages} to image canvas...`;
        const page = await pdfDoc.getPage(i);
        // Keep 1.5 scale for OCR accuracy; free canvas after each page
        const canvas = await renderPDFPageToCanvas(page, 1.5);

        try {
          statusTxt.innerText = `Running Character Recognition on page ${i} of ${totalPages}...`;
          const result = await Tesseract.recognize(canvas, lang, {
            logger: m => {
              if (m.status === 'recognizing') {
                statusTxt.innerText = `Page ${i}/${totalPages}: Recognizing text... ${Math.floor(m.progress * 100)}%`;
              }
            }
          });

          const text = result.data.text;
          fullOcrText += `--- Page ${i} ---\n${text}\n\n`;
        } finally {
          releaseCanvas(canvas);
        }
        await yieldToUI();
      }

      ui.canvasContainer.innerHTML = '';
      ui.ocrTextResult.style.display = 'block';
      ui.ocrTextResult.innerText = fullOcrText || 'No characters recognized in document.';

      // Append Download button
      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'display:flex; gap:1rem; margin-top:1.5rem; width:100%;';
      actionsDiv.innerHTML = `
        <button id="btn-download-ocr-txt" class="btn btn-primary"><i class="bi bi-download"></i> Download Text</button>
        <button id="btn-ocr-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Another</button>
      `;
      ui.ocrTextResult.appendChild(actionsDiv);

      actionsDiv.querySelector('#btn-download-ocr-txt').addEventListener('click', () => {
        const blob = new Blob([fullOcrText], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, selectedFile.name.replace(/\.pdf$/i, '') + '_ocr.txt', 'text/plain');
      });
      actionsDiv.querySelector('#btn-ocr-again').addEventListener('click', () => initOcr(container));

    } catch (err) {
      console.error(err);
      ui.canvasContainer.innerHTML = `<div class="result-success-container"><p class="text-danger">${err.message}</p></div>`;
      ui.runBtn.disabled = false;
    }
  });
}

// ==========================================
// 4. COMPARE PDF
// ==========================================
