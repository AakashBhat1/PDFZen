import { loadScript, downloadBlob, formatBytes, fileToArrayBuffer, renderPDFPageToCanvas, canvasToBlob } from '../utils.js';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export function initCompress(container) {
  let selectedFile = null;
  let fileBuffer = null;
  let pageCount = 0;

  container.innerHTML = `
    <div class="workspace-main-panel">
      <div id="compress-dropzone" class="dropzone">
        <i class="bi bi-file-earmark-zip dropzone-icon"></i>
        <h4>Drag & Drop PDF file to Compress</h4>
        <p>or click to browse from your computer</p>
        <input type="file" id="compress-file-input" class="file-input-hidden" accept="application/pdf">
        <button id="btn-load-test-pdf" type="button" class="btn btn-secondary" style="margin-top: 1rem; pointer-events: auto;">
          <i class="bi bi-file-earmark-pdf"></i> Load Test PDF
        </button>
      </div>
      
      <div id="compress-preview-container" style="display: none; text-align: center; padding: 2rem;">
        <i class="bi bi-file-pdf text-danger" style="font-size: 4rem;"></i>
        <h4 id="compress-file-name" style="margin-top: 1rem; font-family: var(--font-title);"></h4>
        <p id="compress-file-meta" style="color: var(--text-muted); font-size: 0.9rem;"></p>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Compression Level</h3>
      
      <div class="form-group">
        <label>Select Optimization Preset</label>
        
        <label style="display:flex; gap:0.5rem; align-items:center; margin-top:0.5rem; font-weight:normal; cursor:pointer;">
          <input type="radio" name="comp-level" value="extreme">
          <div>
            <strong>Extreme Compression</strong>
            <div style="font-size:0.75rem; color:var(--text-muted)">Low quality, high file size reduction.</div>
          </div>
        </label>

        <label style="display:flex; gap:0.5rem; align-items:center; margin-top:0.75rem; font-weight:normal; cursor:pointer;">
          <input type="radio" name="comp-level" value="recommended" checked>
          <div>
            <strong>Recommended Compression</strong>
            <div style="font-size:0.75rem; color:var(--text-muted)">Medium quality, good file size reduction.</div>
          </div>
        </label>

        <label style="display:flex; gap:0.5rem; align-items:center; margin-top:0.75rem; font-weight:normal; cursor:pointer;">
          <input type="radio" name="comp-level" value="low">
          <div>
            <strong>Low Compression</strong>
            <div style="font-size:0.75rem; color:var(--text-muted)">High quality, low file size reduction.</div>
          </div>
        </label>
      </div>

      <button id="btn-run-compress" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi bi-file-earmark-zip"></i> Compress PDF
      </button>
    </div>
  `;

  const dropzone = container.querySelector('#compress-dropzone');
  const fileInput = container.querySelector('#compress-file-input');
  const previewContainer = container.querySelector('#compress-preview-container');
  const fileNameEl = container.querySelector('#compress-file-name');
  const fileMetaEl = container.querySelector('#compress-file-meta');
  const runBtn = container.querySelector('#btn-run-compress');
  const btnLoadTestPdf = container.querySelector('#btn-load-test-pdf');

  // Trigger file selection
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('#btn-load-test-pdf')) return;
    fileInput.click();
  });

  btnLoadTestPdf.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      btnLoadTestPdf.innerText = 'Loading...';
      btnLoadTestPdf.disabled = true;
      const res = await fetch('/test/MyDefence_Digital_Catalogue_June_2026.pdf');
      if (!res.ok) throw new Error('Failed to fetch test PDF');
      const blob = await res.blob();
      const file = new File([blob], 'MyDefence_Digital_Catalogue_June_2026.pdf', { type: 'application/pdf' });
      processFile(file);
    } catch (err) {
      console.error(err);
      alert('Error loading test PDF: ' + err.message);
      btnLoadTestPdf.innerText = 'Load Test PDF';
      btnLoadTestPdf.disabled = false;
    }
  });

  fileInput.addEventListener('change', handleFileSelection);

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

  async function processFile(file) {
    if (file.type !== 'application/pdf') return;
    selectedFile = file;
    
    dropzone.style.display = 'none';
    previewContainer.style.display = 'block';
    fileNameEl.innerText = file.name;
    fileMetaEl.innerText = 'Analyzing pages...';
    
    try {
      fileBuffer = await fileToArrayBuffer(file);
      
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      pageCount = pdf.numPages;
      fileMetaEl.innerText = `Pages: ${pageCount} | Current Size: ${formatBytes(file.size)}`;
      runBtn.disabled = false;
    } catch (err) {
      console.error(err);
      fileMetaEl.innerText = 'Failed to analyze PDF.';
    }
  }

  runBtn.addEventListener('click', async () => {
    if (!selectedFile || !fileBuffer) return;
    
    const radio = container.querySelector('input[name="comp-level"]:checked');
    const level = radio ? radio.value : 'recommended';
    
    // Quality & Scale settings based on level
    let scale = 1.1;
    let jpegQuality = 0.5;
    if (level === 'extreme') {
      scale = 0.8;
      jpegQuality = 0.3;
    } else if (level === 'low') {
      scale = 1.4;
      jpegQuality = 0.65;
    }

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text" id="compress-progress-text">Initializing compressor...</p>
          <div class="progress-bar-wrapper">
            <div class="progress-bar-fill" id="compress-progress-bar"></div>
          </div>
        </div>
      </div>
    `;

    const progressBar = container.querySelector('#compress-progress-bar');
    const progressText = container.querySelector('#compress-progress-text');

    try {
      progressBar.style.width = '20%';
      
      const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      const pdfLibDoc = await PDFDocument.create();
      
      // 2. Process page-by-page
      for (let i = 1; i <= pageCount; i++) {
        progressText.innerText = `Optimizing page ${i} of ${pageCount}...`;
        const percent = Math.floor(20 + (i / pageCount) * 70);
        progressBar.style.width = `${percent}%`;
        
        // Render PDF page to Canvas
        const page = await pdfjsDoc.getPage(i);
        const canvas = await renderPDFPageToCanvas(page, scale);
        
        // Downsample/Compress Canvas to JPEG Blob
        const blob = await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
        const imgBuffer = await blob.arrayBuffer();
        
        // Add to new PDF Document
        const embedImg = await pdfLibDoc.embedJpg(imgBuffer);
        const { width, height } = embedImg.scale(1 / scale);
        
        const newPage = pdfLibDoc.addPage([width, height]);
        newPage.drawImage(embedImg, {
          x: 0,
          y: 0,
          width: width,
          height: height
        });
      }
      
      // 3. Compile PDF
      progressText.innerText = 'Saving compressed PDF...';
      progressBar.style.width = '95%';
      const compressedBytes = await pdfLibDoc.save();
      progressBar.style.width = '100%';

      // 4. Success View with Ratio calculations
      const oldSize = selectedFile.size;
      const newSize = compressedBytes.length;
      const reduction = ((oldSize - newSize) / oldSize) * 100;
      const ratioText = reduction > 0 
        ? `Reduced file size by <strong>${reduction.toFixed(1)}%</strong>!` 
        : `PDF optimized. Size matches original closely.`;

      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_compressed.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-file-zip-fill success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Compressed Successfully!</h3>
              <p class="result-meta" style="margin-top: 0.5rem; font-size: 1rem; color: var(--text-main);">${ratioText}</p>
              <p class="result-meta" style="margin-top: 0.25rem;">
                Original: ${formatBytes(oldSize)} | Compressed: <strong>${formatBytes(newSize)}</strong>
              </p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-compress" class="btn btn-primary">
                <i class="bi bi-download"></i> Download PDF
              </button>
              <button id="btn-compress-again" class="btn btn-secondary">
                <i class="bi bi-arrow-left"></i> Compress Another
              </button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-compress').addEventListener('click', () => {
        downloadBlob(compressedBytes, outputName);
      });
      container.querySelector('#btn-compress-again').addEventListener('click', () => {
        initCompress(container);
      });

    } catch (err) {
      console.error(err);
      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-exclamation-triangle-fill text-danger success-icon"></i>
            <div class="result-info">
              <h3 class="result-title">Compression Failed</h3>
              <p class="result-meta">${err.message}</p>
            </div>
            <button id="btn-compress-retry" class="btn btn-secondary">
              <i class="bi bi-arrow-left"></i> Try Again
            </button>
          </div>
        </div>
      `;
      container.querySelector('#btn-compress-retry').addEventListener('click', () => {
        initCompress(container);
      });
    }
  });
}
