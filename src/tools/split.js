import {
  downloadBlob,
  formatBytes,
  fileToArrayBuffer,
  renderPDFPageToCanvas,
  downloadZipOfFiles,
  pdfjsDataFromBuffer,
  yieldToUI
} from '../utils.js';
import { PDFDocument } from 'pdf-lib';
import { pdfjsLib } from '../pdfjs-setup.js';

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
        <button id="btn-load-test-pdf" type="button" class="btn btn-secondary" style="margin-top: 1rem; pointer-events: auto;">
          <i class="bi bi-file-earmark-pdf"></i> Load Test PDF
        </button>
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
      <div id="split-range-options" class="form-group" style="display: flex; flex-direction: column; gap: 0.75rem;">
        <label>Custom Ranges</label>
        <div id="split-ranges-container" style="display: flex; flex-direction: column; gap: 0.5rem;">
          <!-- Dynamically populated range rows -->
        </div>
        <button id="btn-add-range" type="button" class="btn btn-secondary" style="width: 100%;" disabled>
          <i class="bi bi-plus-lg"></i> Add Range
        </button>
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem;">
          <input type="checkbox" id="split-merge-ranges" style="width: auto; cursor: pointer;" disabled>
          <label for="split-merge-ranges" style="margin-bottom: 0; cursor: pointer; font-size: 0.85rem; user-select: none;">Merge all ranges in one PDF file</label>
        </div>
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
  const chunkInput = container.querySelector('#split-chunk-input');
  const rangesContainer = container.querySelector('#split-ranges-container');
  const btnAddRange = container.querySelector('#btn-add-range');
  const mergeRangesCheckbox = container.querySelector('#split-merge-ranges');

  const btnLoadTestPdf = container.querySelector('#btn-load-test-pdf');

  // Trigger file selection
  dropzone.addEventListener('click', (e) => {
    // If they clicked the load test button, don't trigger file chooser
    if (e.target.closest('#btn-load-test-pdf')) return;
    fileInput.click();
  });

  btnLoadTestPdf.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      btnLoadTestPdf.innerText = 'Loading...';
      btnLoadTestPdf.disabled = true;
      const res = await fetch('/test/Visit report 030726 Yk-54.pdf');
      if (!res.ok) throw new Error('Failed to fetch test PDF');
      const blob = await res.blob();
      const file = new File([blob], 'Visit report 030726 Yk-54.pdf', { type: 'application/pdf' });
      processFile(file);
    } catch (err) {
      console.error(err);
      alert('Error loading test PDF: ' + err.message);
      btnLoadTestPdf.innerText = 'Load Test PDF';
      btnLoadTestPdf.disabled = false;
    }
  });

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

  function renderRangeRow(index, fromVal, toVal) {
    const row = document.createElement('div');
    row.className = 'range-row';
    row.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;';
    row.innerHTML = `
      <span style="font-size: 0.8rem; color: var(--text-muted); min-width: 50px; white-space: nowrap;">Range ${index}:</span>
      <input type="number" class="form-control range-from" style="padding: 0.4rem 0.5rem; text-align: center; width: 100%; min-width: 0;" value="${fromVal}" min="1" max="${pageCount}">
      <span style="font-size: 0.85rem; color: var(--text-muted);">to</span>
      <input type="number" class="form-control range-to" style="padding: 0.4rem 0.5rem; text-align: center; width: 100%; min-width: 0;" value="${toVal}" min="1" max="${pageCount}">
      <button type="button" class="btn btn-danger btn-remove-range" style="padding: 0.4rem 0.6rem;" title="Remove Range">
        <i class="bi bi-trash"></i>
      </button>
    `;
    
    const fromInput = row.querySelector('.range-from');
    const toInput = row.querySelector('.range-to');
    const removeBtn = row.querySelector('.btn-remove-range');

    fromInput.addEventListener('change', () => {
      let val = parseInt(fromInput.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      if (val > pageCount) val = pageCount;
      fromInput.value = val;
    });

    toInput.addEventListener('change', () => {
      let val = parseInt(toInput.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      if (val > pageCount) val = pageCount;
      toInput.value = val;
    });

    removeBtn.addEventListener('click', () => {
      row.remove();
      updateRangeLabels();
    });

    rangesContainer.appendChild(row);
    updateRangeLabels();
  }

  function updateRangeLabels() {
    const rows = rangesContainer.querySelectorAll('.range-row');
    rows.forEach((row, idx) => {
      row.querySelector('span').innerText = `Range ${idx + 1}:`;
      const removeBtn = row.querySelector('.btn-remove-range');
      removeBtn.disabled = (rows.length <= 1);
    });
  }

  btnAddRange.addEventListener('click', () => {
    const currentRows = rangesContainer.querySelectorAll('.range-row');
    renderRangeRow(currentRows.length + 1, 1, pageCount);
  });

  async function processFile(file) {
    if (file.type !== 'application/pdf') return;
    
    selectedFile = file;
    fileMeta.innerText = 'Reading file structure...';
    dropzone.style.display = 'none';
    previewContainer.style.display = 'block';
    
    try {
      fileBuffer = await fileToArrayBuffer(file);
      
      pdfDocInstance = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      pageCount = pdfDocInstance.numPages;
      fileMeta.innerText = `Pages: ${pageCount} | Size: ${formatBytes(file.size)}`;
      
      // Enable settings inputs
      runBtn.disabled = false;
      btnAddRange.disabled = false;
      mergeRangesCheckbox.disabled = false;
      chunkInput.disabled = false;
      
      // Initialize first range row
      rangesContainer.innerHTML = '';
      renderRangeRow(1, 1, pageCount);
      
      // 2. Generate Page Thumbnails
      pagesGrid.innerHTML = '';
      
      // Render only first 15 pages initially for performance in large PDFs
      const maxPreviews = Math.min(pageCount, 15);
      for (let i = 1; i <= maxPreviews; i++) {
        const page = await pdfDocInstance.getPage(i);
        const canvas = await renderPDFPageToCanvas(page, 0.4, { alpha: false });
        canvas.className = 'page-thumbnail-canvas';

        const card = document.createElement('div');
        card.className = 'page-thumbnail-card';
        card.appendChild(canvas);

        const badge = document.createElement('span');
        badge.className = 'page-number-badge';
        badge.innerText = `${i}`;
        card.appendChild(badge);

        pagesGrid.appendChild(card);
        if (i % 4 === 0) await yieldToUI();
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
      

      
      const srcDoc = await PDFDocument.load(fileBuffer);
      const mode = splitMode.value;
      
      progressBar.style.width = '30%';

      if (mode === 'range') {
        const rows = rangesContainer.querySelectorAll('.range-row');
        if (rows.length === 0) {
          throw new Error('Please add at least one range.');
        }

        const ranges = [];
        for (const row of rows) {
          const fromVal = parseInt(row.querySelector('.range-from').value, 10);
          const toVal = parseInt(row.querySelector('.range-to').value, 10);
          if (isNaN(fromVal) || isNaN(toVal) || fromVal < 1 || toVal < 1 || fromVal > pageCount || toVal > pageCount) {
            throw new Error('Please enter valid page numbers for all ranges.');
          }
          ranges.push({ from: fromVal, to: toVal });
        }

        const mergeAll = mergeRangesCheckbox.checked;

        if (mergeAll) {
          progressText.innerText = 'Copying pages for merged PDF...';
          progressBar.style.width = '50%';
          
          const newDoc = await PDFDocument.create();
          
          // Collect all pages in order, allowing duplicates if specified
          const pageIndices = [];
          for (const r of ranges) {
            const start = Math.min(r.from, r.to);
            const end = Math.max(r.from, r.to);
            for (let p = start; p <= end; p++) {
              pageIndices.push(p - 1);
            }
          }

          if (pageIndices.length === 0) {
            throw new Error('No valid pages found in the specified ranges.');
          }

          const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
          copiedPages.forEach(p => newDoc.addPage(p));

          progressText.innerText = 'Saving merged PDF...';
          progressBar.style.width = '80%';
          const outputBytes = await newDoc.save();
          progressBar.style.width = '100%';

          const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_merged.pdf';
          showSuccessSingle(outputBytes, outputName);

        } else {
          progressText.innerText = 'Creating separate PDFs for each range...';
          progressBar.style.width = '40%';

          const filesToZip = [];
          
          for (let idx = 0; idx < ranges.length; idx++) {
            const r = ranges[idx];
            const start = Math.min(r.from, r.to);
            const end = Math.max(r.from, r.to);
            
            const chunkIndices = [];
            for (let p = start; p <= end; p++) {
              chunkIndices.push(p - 1);
            }

            if (chunkIndices.length === 0) continue;

            progressText.innerText = `Generating range ${idx + 1} (${start}-${end})...`;
            const percent = Math.floor(40 + (idx / ranges.length) * 40);
            progressBar.style.width = `${percent}%`;

            const newDoc = await PDFDocument.create();
            const copiedPages = await newDoc.copyPages(srcDoc, chunkIndices);
            copiedPages.forEach(p => newDoc.addPage(p));
            
            const bytes = await newDoc.save();
            const rangeStr = `${start}-${end}`;
            filesToZip.push({
              name: `${selectedFile.name.replace(/\.pdf$/i, '')}-${rangeStr}.pdf`,
              data: bytes
            });
          }

          if (filesToZip.length === 0) {
            throw new Error('No valid ranges could be created.');
          }

          if (filesToZip.length === 1) {
            progressBar.style.width = '100%';
            showSuccessSingle(filesToZip[0].data, filesToZip[0].name);
          } else {
            progressText.innerText = 'Bundling PDF files into a ZIP archive...';
            progressBar.style.width = '90%';
            
            const zipName = selectedFile.name.replace(/\.pdf$/i, '') + '_split_ranges.zip';
            await downloadZipOfFiles(filesToZip, zipName);
            progressBar.style.width = '100%';
            
            showSuccessZip(zipName);
          }
        }
        
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
