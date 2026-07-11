import { downloadBlob, formatBytes, fileToArrayBuffer, yieldToUI } from '../lib/utils.js';
import { PDFDocument } from 'pdf-lib';

export function initMerge(container) {
  let uploadedFiles = []; // Array of { id, file, arrayBuffer, sizeFormatted }
  let fileCounter = 0;

  // Create Workspace layout
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div id="merge-dropzone" class="dropzone">
        <i class="bi bi-file-earmark-plus dropzone-icon"></i>
        <h4>Drag & Drop PDF files here</h4>
        <p>or click to browse from your computer</p>
        <input type="file" id="merge-file-input" class="file-input-hidden" accept="application/pdf" multiple>
      </div>
      
      <div id="merge-file-list-container" style="display: none; margin-top: 1.5rem; width: 100%;">
        <h4 style="font-family: var(--font-title); margin-bottom: 0.5rem;">Files to Merge (reorder below)</h4>
        <div id="merge-file-list" class="file-list"></div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Merge Options</h3>
      
      <div class="form-group">
        <label for="merge-output-name">Output Filename</label>
        <input type="text" id="merge-output-name" class="form-control" value="merged_document.pdf">
      </div>

      <button id="btn-run-merge" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi bi-file-earmark-plus"></i> Merge PDFs
      </button>
    </div>
  `;

  // DOM Elements
  const dropzone = container.querySelector('#merge-dropzone');
  const fileInput = container.querySelector('#merge-file-input');
  const fileListContainer = container.querySelector('#merge-file-list-container');
  const fileList = container.querySelector('#merge-file-list');
  const runBtn = container.querySelector('#btn-run-merge');
  const outputNameInput = container.querySelector('#merge-output-name');

  // Trigger file selection
  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', handleFileSelection);

  // Drag and Drop events
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
      processFiles(e.dataTransfer.files);
    }
  });

  function handleFileSelection(e) {
    if (e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  }

  async function processFiles(files) {
    for (const file of files) {
      if (file.type !== 'application/pdf') continue;
      
      try {
        const arrayBuffer = await fileToArrayBuffer(file);
        uploadedFiles.push({
          id: fileCounter++,
          file: file,
          arrayBuffer: arrayBuffer,
          name: file.name,
          sizeFormatted: formatBytes(file.size)
        });
      } catch (err) {
        console.error('Error reading file:', file.name, err);
      }
    }
    
    updateFileList();
  }

  function updateFileList() {
    if (uploadedFiles.length === 0) {
      fileListContainer.style.display = 'none';
      runBtn.disabled = true;
      return;
    }

    fileListContainer.style.display = 'block';
    runBtn.disabled = uploadedFiles.length < 2; // Need at least 2 files to merge
    
    fileList.innerHTML = '';
    uploadedFiles.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = 'file-item';
      el.innerHTML = `
        <div class="file-info">
          <i class="bi bi-file-pdf-fill file-icon"></i>
          <span class="file-name" title="${item.name}">${item.name}</span>
          <span class="file-size">(${item.sizeFormatted})</span>
        </div>
        <div class="file-actions">
          <button class="btn btn-icon-small btn-move-up" data-id="${item.id}" title="Move Up" ${index === 0 ? 'disabled' : ''}>
            <i class="bi bi-arrow-up"></i>
          </button>
          <button class="btn btn-icon-small btn-move-down" data-id="${item.id}" title="Move Down" ${index === uploadedFiles.length - 1 ? 'disabled' : ''}>
            <i class="bi bi-arrow-down"></i>
          </button>
          <button class="btn btn-icon-small btn-delete" data-id="${item.id}" title="Remove">
            <i class="bi bi-trash text-danger"></i>
          </button>
        </div>
      `;
      
      // Bind reordering click events
      el.querySelector('.btn-move-up').addEventListener('click', () => moveFile(index, -1));
      el.querySelector('.btn-move-down').addEventListener('click', () => moveFile(index, 1));
      el.querySelector('.btn-delete').addEventListener('click', () => deleteFile(item.id));
      
      fileList.appendChild(el);
    });
  }

  function moveFile(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= uploadedFiles.length) return;
    
    // Swap items
    const temp = uploadedFiles[index];
    uploadedFiles[index] = uploadedFiles[targetIndex];
    uploadedFiles[targetIndex] = temp;
    
    updateFileList();
  }

  function deleteFile(id) {
    uploadedFiles = uploadedFiles.filter(item => item.id !== id);
    updateFileList();
  }

  // Execute Merge Operation
  runBtn.addEventListener('click', async () => {
    if (uploadedFiles.length < 2) return;
    
    // Switch to loading view
    const originalWorkspaceContent = container.innerHTML;
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text" id="merge-progress-text">Merging PDFs... 0%</p>
          <div class="progress-bar-wrapper">
            <div class="progress-bar-fill" id="merge-progress-bar"></div>
          </div>
        </div>
      </div>
    `;

    const progressBar = container.querySelector('#merge-progress-bar');
    const progressText = container.querySelector('#merge-progress-text');

    try {
      progressText.innerText = 'Loading PDF processing libraries...';
      progressBar.style.width = '10%';
      
      // 2. Create Merged Document
      progressText.innerText = 'Initializing new PDF document...';
      progressBar.style.width = '20%';
      const mergedPdf = await PDFDocument.create();
      
      // 3. Process documents and copy pages
      const totalDocs = uploadedFiles.length;
      for (let i = 0; i < totalDocs; i++) {
        const item = uploadedFiles[i];
        progressText.innerText = `Reading file: ${item.name}...`;
        
        // Update progress bar proportionally
        const percent = Math.floor(20 + (i / totalDocs) * 60);
        progressBar.style.width = `${percent}%`;
        
        const donorPdf = await PDFDocument.load(item.arrayBuffer, { updateMetadata: false });
        const copiedPages = await mergedPdf.copyPages(donorPdf, donorPdf.getPageIndices());
        for (const page of copiedPages) {
          mergedPdf.addPage(page);
        }
        if (i % 2 === 1) await yieldToUI();
      }
      
      // 4. Save and compile
      progressText.innerText = 'Compiling and saving merged PDF...';
      progressBar.style.width = '90%';
      const mergedPdfBytes = await mergedPdf.save();
      progressBar.style.width = '100%';

      // 5. Success Screen
      let outputName = outputNameInput.value.trim();
      if (!outputName.toLowerCase().endsWith('.pdf')) {
        outputName += '.pdf';
      }

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-check-circle-fill success-icon"></i>
            <div class="result-info">
              <h3 class="result-title">PDFs Merged Successfully!</h3>
              <p class="result-meta">Output file: <strong>${outputName}</strong> (${formatBytes(mergedPdfBytes.length)})</p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-merge" class="btn btn-primary">
                <i class="bi bi-download"></i> Download PDF
              </button>
              <button id="btn-merge-again" class="btn btn-secondary">
                <i class="bi bi-arrow-counterclockwise"></i> Merge More
              </button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-merge').addEventListener('click', () => {
        downloadBlob(mergedPdfBytes, outputName);
      });

      container.querySelector('#btn-merge-again').addEventListener('click', () => {
        initMerge(container);
      });
      
    } catch (err) {
      console.error(err);
      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-exclamation-triangle-fill text-danger success-icon"></i>
            <div class="result-info">
              <h3 class="result-title">Merge Process Failed</h3>
              <p class="result-meta">${err.message}</p>
            </div>
            <button id="btn-merge-retry" class="btn btn-secondary">
              <i class="bi bi-arrow-left"></i> Try Again
            </button>
          </div>
        </div>
      `;
      container.querySelector('#btn-merge-retry').addEventListener('click', () => {
        initMerge(container);
      });
    }
  });
}
