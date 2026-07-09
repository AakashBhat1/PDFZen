import { loadScript, downloadBlob, formatBytes, fileToArrayBuffer, renderPDFPageToCanvas, downloadZipOfFiles } from '../utils.js';

export function initSplit(container) {
  let selectedFile = null;
  let fileBuffer = null;
  let pdfDocInstance = null; // pdfjs doc reference
  let pageCount = 0;

  // Create Workspace layout
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div id="split-dropzone" class="dropzone">
        <i class="bi bi-scissors dropzone-icon"></i>
        <h4>Drag & Drop your PDF file here</h4>
        <p>or click to browse from your computer</p>
        <input type="file" id="split-file-input" class="file-input-hidden" accept="application/pdf">
      </div>
      
      <div id="split-preview-container" style="display: none; margin-top: 1.5rem; width: 100%;">
        <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h4 style="font-family: var(--font-title);">PDF Page Preview</h4>
          <span id="split-file-meta" class="form-help"></span>
        </div>
        <div id="split-pages-grid" class="organizer-grid"></div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Split Settings</h3>
      
      <div class="form-group">
        <label for="split-mode">Split Method</label>
        <select id="split-mode" class="form-control">
          <option value="range">Extract Custom Page Range</option>
          <option value="all">Split Every Page (Separate Files)</option>
          <option value="chunks">Split in Chunks of N Pages</option>
        </select>
      </div>

      <!-- Range Options -->
      <div id="split-range-options" class="form-group">
        <label for="split-range-input">Page Range</label>
        <input type="text" id="split-range-input" class="form-control" placeholder="e.g. 1-3, 5, 8-10" disabled>
        <span class="form-help">Enter comma-separated page numbers or ranges.</span>
      </div>

      <!-- Chunk Options -->
      <div id="split-chunk-options" class="form-group" style="display: none;">
        <label for="split-chunk-input">Pages per PDF</label>
        <input type="number" id="split-chunk-input" class="form-control" value="1" min="1" disabled>
      </div>

      <button id="btn-run-split" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi bi-scissors"></i> Split PDF
      </button>
    </div>
  `;

  // DOM Elements
  const dropzone = container.querySelector('#split-dropzone');
  const fileInput = container.querySelector('#split-file-input');
  const previewContainer = container.querySelector('#split-preview-container');
  const pagesGrid = container.querySelector('#split-pages-grid');
  const runBtn = container.querySelector('#btn-run-split');
  const fileMeta = container.querySelector('#split-file-meta');
  const splitMode = container.querySelector('#split-mode');
  const rangeOptions = container.querySelector('#split-range-options');
  const chunkOptions = container.querySelector('#split-chunk-options');
  const rangeInput = container.querySelector('#split-range-input');
  const chunkInput = container.querySelector('#split-chunk-input');

  // Trigger file selection
  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', handleFileSelection);

  // Drag & drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  });

  function handleFileSelection(e) {
    if (e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  }

  // Toggle options display depending on selected split mode
  splitMode.addEventListener('change', () => {
    const val = splitMode.value;
    if (val === 'range') {
      rangeOptions.style.display = 'flex';
      chunkOptions.style.display = 'none';
    } else if (val === 'chunks') {
      rangeOptions.style.display = 'none';
      chunkOptions.style.display = 'flex';
    } else {
      rangeOptions.style.display = 'none';
      chunkOptions.style.display = 'none';
    }
  });

  async function processFile(file) {
    if (file.type !== 'application/pdf') return;
    
    selectedFile = file;
    fileMeta.innerText = 'Reading file structure...';
    dropzone.style.display = 'none';
    previewContainer.style.display = 'block';
    
    try {
      fileBuffer = await fileToArrayBuffer(file);
      
      // 1. Load pdf.js to render thumbnails
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
      
      pdfDocInstance = await window.pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer) }).promise;
      pageCount = pdfDocInstance.numPages;
      fileMeta.innerText = `Pages: ${pageCount} | Size: ${formatBytes(file.size)}`;
      
      // Enable settings inputs
      runBtn.disabled = false;
      rangeInput.disabled = false;
      chunkInput.disabled = false;
      rangeInput.placeholder = `e.g. 1-${pageCount}, ${Math.ceil(pageCount/2)}`;
      
      // 2. Generate Page Thumbnails
      pagesGrid.innerHTML = '';
      
      // Render only first 15 pages initially for performance in large PDFs
      const maxPreviews = Math.min(pageCount, 15);
      for (let i = 1; i <= maxPreviews; i++) {
        const page = await pdfDocInstance.getPage(i);
        const canvas = await renderPDFPageToCanvas(page, 0.4); // Small scale
        canvas.className = 'page-thumbnail-canvas';
        
        const card = document.createElement('div');
        card.className = 'page-thumbnail-card';
        card.appendChild(canvas);
        
        const badge = document.createElement('span');
        badge.className = 'page-number-badge';
        badge.innerText = `${i}`;
        card.appendChild(badge);
        
        pagesGrid.appendChild(card);
      }
      
      if (pageCount > 15) {
        const placeholder = document.createElement('div');
        placeholder.style.cssText = 'grid-column: 1/-1; text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 1rem;';
        placeholder.innerText = `+ ${pageCount - 15} more pages loaded...`;
        pagesGrid.appendChild(placeholder);
      }

    } catch (err) {
      console.error(err);
      fileMeta.innerText = 'Failed to load PDF preview.';
    }
  }

  // Parse custom range string like "1-3, 5, 8-10" to array [0, 1, 2, 4, 7, 8, 9] (0-indexed)
  function parseRanges(rangeStr, maxPage) {
    const indices = [];
    const parts = rangeStr.split(',');
    
    for (let part of parts) {
      part = part.trim();
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          const s = Math.max(1, Math.min(start, maxPage));
          const e = Math.max(1, Math.min(end, maxPage));
          for (let p = Math.min(s, e); p <= Math.max(s, e); p++) {
            indices.push(p - 1);
          }
        }
      } else {
        const page = parseInt(part, 10);
        if (!isNaN(page)) {
          const p = Math.max(1, Math.min(page, maxPage));
          indices.push(p - 1);
        }
      }
    }
    
    // Sort and remove duplicates
    return [...new Set(indices)].sort((a, b) => a - b);
  }

  runBtn.addEventListener('click', async () => {
    if (!selectedFile || !fileBuffer) return;
    
    // Switch to loading
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text" id="split-progress-text">Splitting PDF... 0%</p>
          <div class="progress-bar-wrapper">
            <div class="progress-bar-fill" id="split-progress-bar"></div>
          </div>
        </div>
      </div>
    `;

    const progressBar = container.querySelector('#split-progress-bar');
    const progressText = container.querySelector('#split-progress-text');

    try {
      progressText.innerText = 'Loading PDF engine...';
      progressBar.style.width = '10%';
      
      await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const { PDFDocument } = window.PDFLib;
      
      const srcDoc = await PDFDocument.load(fileBuffer);
      const mode = splitMode.value;
      
      progressBar.style.width = '30%';

      if (mode === 'range') {
        const rangeText = rangeInput.value.trim();
        if (!rangeText) {
          throw new Error('Please enter a valid page range.');
        }
        
        progressText.innerText = 'Analyzing page indices...';
        const pageIndices = parseRanges(rangeText, pageCount);
        if (pageIndices.length === 0) {
          throw new Error('No valid pages found in range.');
        }

        progressText.innerText = 'Copying page structures...';
        progressBar.style.width = '50%';
        
        const newDoc = await PDFDocument.create();
        const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
        copiedPages.forEach(p => newDoc.addPage(p));
        
        progressText.innerText = 'Saving output PDF...';
        progressBar.style.width = '80%';
        const outputBytes = await newDoc.save();
        progressBar.style.width = '100%';

        const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_extracted.pdf';
        
        showSuccessSingle(outputBytes, outputName);
        
      } else if (mode === 'all') {
        // Split every page into separate files, compile in ZIP
        progressText.innerText = 'Splitting pages into individual files...';
        const filesToZip = [];
        
        for (let i = 0; i < pageCount; i++) {
          progressText.innerText = `Splitting page ${i+1} of ${pageCount}...`;
          const percent = Math.floor(30 + (i / pageCount) * 50);
          progressBar.style.width = `${percent}%`;
          
          const newDoc = await PDFDocument.create();
          const [page] = await newDoc.copyPages(srcDoc, [i]);
          newDoc.addPage(page);
          
          const bytes = await newDoc.save();
          const pageNum = String(i + 1).padStart(3, '0');
          filesToZip.push({
            name: `${selectedFile.name.replace(/\.pdf$/i, '')}_page_${pageNum}.pdf`,
            data: bytes
          });
        }
        
        progressText.innerText = 'Bundling PDF files into a ZIP archive...';
        progressBar.style.width = '90%';
        
        const zipName = selectedFile.name.replace(/\.pdf$/i, '') + '_split_pages.zip';
        await downloadZipOfFiles(filesToZip, zipName);
        progressBar.style.width = '100%';
        
        showSuccessZip(zipName);
        
      } else if (mode === 'chunks') {
        const size = parseInt(chunkInput.value, 10);
        if (isNaN(size) || size < 1) {
          throw new Error('Please enter a valid chunk size.');
        }

        progressText.innerText = 'Slicing document into chunks...';
        const filesToZip = [];
        let chunkIndex = 1;
        
        for (let i = 0; i < pageCount; i += size) {
          const sliceIndices = [];
          for (let j = i; j < i + size && j < pageCount; j++) {
            sliceIndices.push(j);
          }
          
          progressText.innerText = `Creating chunk ${chunkIndex} (pages ${sliceIndices[0]+1}-${sliceIndices[sliceIndices.length-1]+1})...`;
          const percent = Math.floor(30 + (i / pageCount) * 50);
          progressBar.style.width = `${percent}%`;
          
          const newDoc = await PDFDocument.create();
          const copiedPages = await newDoc.copyPages(srcDoc, sliceIndices);
          copiedPages.forEach(p => newDoc.addPage(p));
          
          const bytes = await newDoc.save();
          filesToZip.push({
            name: `${selectedFile.name.replace(/\.pdf$/i, '')}_part_${chunkIndex}.pdf`,
            data: bytes
          });
          chunkIndex++;
        }
        
        progressText.innerText = 'Bundling chunk files into ZIP...';
        progressBar.style.width = '90%';
        
        const zipName = selectedFile.name.replace(/\.pdf$/i, '') + '_chunks.zip';
        await downloadZipOfFiles(filesToZip, zipName);
        progressBar.style.width = '100%';
        
        showSuccessZip(zipName);
      }
      
    } catch (err) {
      console.error(err);
      showError(err.message);
    }
  });

  function showSuccessSingle(bytes, filename) {
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="result-success-container">
          <i class="bi bi-check-circle-fill success-icon"></i>
          <div class="result-info">
            <h3 class="result-title">PDF Split Successfully!</h3>
            <p class="result-meta">File: <strong>${filename}</strong> (${formatBytes(bytes.length)})</p>
          </div>
          <div style="display: flex; gap: 1rem; margin-top: 1rem;">
            <button id="btn-download-split" class="btn btn-primary">
              <i class="bi bi-download"></i> Download PDF
            </button>
            <button id="btn-split-again" class="btn btn-secondary">
              <i class="bi bi-arrow-counterclockwise"></i> Split Again
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btn-download-split').addEventListener('click', () => {
      downloadBlob(bytes, filename);
    });
    container.querySelector('#btn-split-again').addEventListener('click', () => {
      initSplit(container);
    });
  }

  function showSuccessZip(zipName) {
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="result-success-container">
          <i class="bi bi-file-earmark-zip-fill success-icon text-success"></i>
          <div class="result-info">
            <h3 class="result-title">PDF Splitted in Separate Files!</h3>
            <p class="result-meta">Files packed inside: <strong>${zipName}</strong></p>
          </div>
          <div style="display: flex; gap: 1rem; margin-top: 1rem;">
            <p style="color: var(--text-muted); font-size: 0.9rem;">Your download was triggered automatically. If not, click below.</p>
          </div>
          <button id="btn-split-again" class="btn btn-secondary" style="margin-top: 1rem;">
            <i class="bi bi-arrow-left"></i> Split Another File
          </button>
        </div>
      </div>
    `;
    container.querySelector('#btn-split-again').addEventListener('click', () => {
      initSplit(container);
    });
  }

  function showError(msg) {
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="result-success-container">
          <i class="bi bi-exclamation-triangle-fill text-danger success-icon"></i>
          <div class="result-info">
            <h3 class="result-title">Splitting Operation Failed</h3>
            <p class="result-meta">${msg}</p>
          </div>
          <button id="btn-split-retry" class="btn btn-secondary">
            <i class="bi bi-arrow-left"></i> Try Again
          </button>
        </div>
      </div>
    `;
    container.querySelector('#btn-split-retry').addEventListener('click', () => {
      initSplit(container);
    });
  }
}
