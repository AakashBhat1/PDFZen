import { fileToArrayBuffer, downloadBlob, formatBytes, renderPDFPageToCanvas } from '../../utils.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export { pdfjsLib, fileToArrayBuffer, downloadBlob, formatBytes, renderPDFPageToCanvas };

// --- Shared File Input & UI Builder Helper ---
export function createConvertUI(container, options) {
  const fileAccepts = {
    pdf: 'application/pdf',
    word: '.docx',
    excel: '.xlsx,.xls',
    powerpoint: '.pptx,.ppt',
    image: 'image/jpeg,image/png',
    html: 'text/html'
  };

  container.innerHTML = `
    <div class="workspace-main-panel">
      <!-- Input Mode -->
      <div id="convert-dropzone" class="dropzone">
        <i class="bi ${options.icon} dropzone-icon"></i>
        <h4>${options.title}</h4>
        <p>${options.subtitle}</p>
        <input type="file" id="convert-file-input" class="file-input-hidden" accept="${fileAccepts[options.inputType]}" ${options.multiple ? 'multiple' : ''}>
      </div>

      <!-- File info/preview (optional) -->
      <div id="convert-preview" style="display: none; text-align: center; padding: 2rem;">
        <i class="bi ${options.fileIcon}" style="font-size: 4rem; color: var(--color-blue);"></i>
        <h4 id="convert-file-name" style="margin-top: 1rem; font-family: var(--font-title);"></h4>
        <p id="convert-file-meta" style="color: var(--text-muted); font-size: 0.9rem;"></p>
        
        <!-- Image Preview Grid (Only for JPG to PDF) -->
        <div id="image-preview-grid" class="organizer-grid" style="display:none; margin-top: 1.5rem; text-align: left;"></div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Settings</h3>
      <div id="convert-settings-fields">
        ${options.settingsHTML || '<p class="form-help">No additional settings required for this tool.</p>'}
      </div>
      <button id="btn-run-convert" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi bi-arrow-right-circle"></i> Convert Document
      </button>
    </div>
  `;

  return {
    dropzone: container.querySelector('#convert-dropzone'),
    fileInput: container.querySelector('#convert-file-input'),
    preview: container.querySelector('#convert-preview'),
    fileName: container.querySelector('#convert-file-name'),
    fileMeta: container.querySelector('#convert-file-meta'),
    runBtn: container.querySelector('#btn-run-convert'),
    settingsFields: container.querySelector('#convert-settings-fields'),
    imgGrid: container.querySelector('#image-preview-grid')
  };
}

// --- Text Extractor Helper for PDF Parsing ---
export async function extractPDFText(arrayBuffer, progressCallback) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const numPages = pdf.numPages;
  const pagesText = []; // Array of arrays (lines of text)

  for (let i = 1; i <= numPages; i++) {
    if (progressCallback) progressCallback(i, numPages);
    
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Group text items by y-coordinate (lines)
    const lineMap = {};
    textContent.items.forEach(item => {
      const y = Math.round(item.transform[5]); // Y coordinate
      if (!lineMap[y]) {
        lineMap[y] = [];
      }
      lineMap[y].push(item);
    });

    // Sort lines from top to bottom
    const sortedY = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
    const pageLines = [];
    
    sortedY.forEach(y => {
      // Sort items within line from left to right
      const lineItems = lineMap[y].sort((a, b) => a.transform[4] - b.transform[4]);
      const lineStr = lineItems.map(item => item.str).join(' ').trim();
      if (lineStr) {
        pageLines.push(lineStr);
      }
    });

    pagesText.push(pageLines);
  }

  return pagesText;
}

// --- Showing Success Panel Helper ---
export function showSuccessView(container, options) {
  container.innerHTML = `
    <div class="workspace-main-panel" style="grid-column: span 2;">
      <div class="result-success-container">
        <i class="bi ${options.icon || 'bi-check-circle-fill'} success-icon text-success"></i>
        <div class="result-info">
          <h3 class="result-title">${options.title}</h3>
          <p class="result-meta">${options.meta}</p>
        </div>
        <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
          ${options.downloadBtn !== false ? `
          <button id="btn-download-result" class="btn btn-primary">
            <i class="bi bi-download"></i> Download File
          </button>` : ''}
          <button id="btn-convert-again" class="btn btn-secondary">
            <i class="bi bi-arrow-left"></i> Convert Another
          </button>
        </div>
      </div>
    </div>
  `;

  if (options.downloadBtn !== false && options.onDownload) {
    container.querySelector('#btn-download-result').addEventListener('click', options.onDownload);
  }
  container.querySelector('#btn-convert-again').addEventListener('click', options.onReload);
}

// --- Object URL Manager for Memory Leak Prevention ---
class ObjectUrlManager {
  constructor() {
    this.urls = new Set();
  }

  create(blobOrFile) {
    const url = URL.createObjectURL(blobOrFile);
    this.urls.add(url);
    return url;
  }

  revoke(url) {
    if (this.urls.has(url)) {
      URL.revokeObjectURL(url);
      this.urls.delete(url);
    }
  }

  revokeAll() {
    this.urls.forEach(url => {
      URL.revokeObjectURL(url);
    });
    this.urls.clear();
  }
}

export const objectUrlManager = new ObjectUrlManager();


// --- Showing Progress Panel Helper ---
export function showProgressView(container, text) {
  container.innerHTML = `
    <div class="workspace-main-panel" style="grid-column: span 2;">
      <div class="processing-container">
        <div class="spinner"></div>
        <p class="processing-text" id="convert-progress-text">${text}</p>
        <div class="progress-bar-wrapper">
          <div class="progress-bar-fill" id="convert-progress-bar" style="width: 10%;"></div>
        </div>
      </div>
    </div>
  `;
  return {
    progressBar: container.querySelector('#convert-progress-bar'),
    progressText: container.querySelector('#convert-progress-text')
  };
}

// --- Showing Error Panel Helper ---
export function showErrorView(container, msg, onReload) {
  container.innerHTML = `
    <div class="workspace-main-panel" style="grid-column: span 2;">
      <div class="result-success-container">
        <i class="bi bi-exclamation-triangle-fill text-danger success-icon"></i>
        <div class="result-info">
          <h3 class="result-title">Conversion Failed</h3>
          <p class="result-meta">${msg}</p>
        </div>
        <button id="btn-convert-retry" class="btn btn-secondary" style="margin-top: 1rem;">
          <i class="bi bi-arrow-left"></i> Try Again
        </button>
      </div>
    </div>
  `;
  container.querySelector('#btn-convert-retry').addEventListener('click', onReload);
}
