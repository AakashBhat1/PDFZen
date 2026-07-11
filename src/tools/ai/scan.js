import {
  downloadBlob
} from '../../lib/utils.js';
import { PDFDocument } from 'pdf-lib';

export function initScan(container) {
  let scannedPages = []; // Array of { id, dataUrl, canvas }
  let scanCounter = 0;
  let localStream = null;

  container.innerHTML = `
    <div class="workspace-main-panel">
      <!-- Scanner Feed View -->
      <div class="scanner-feed-wrapper">
        <video id="scan-video-feed" class="scanner-video" autoplay playsinline muted></video>
        <div class="scanner-overlay-frame"></div>
      </div>

      <!-- Controls -->
      <div class="scanner-controls">
        <button id="btn-capture-scan" class="btn btn-primary"><i class="bi bi-camera"></i> Capture Page</button>
        <button id="btn-stop-camera" class="btn btn-secondary">Stop Camera</button>
      </div>

      <!-- Scanned Thumbnails Grid -->
      <div id="scan-thumbnails-container" style="display:none; margin-top: 1.5rem; width: 100%;">
        <h4 style="font-family: var(--font-title); margin-bottom: 0.5rem;">Scanned Pages</h4>
        <div id="scan-thumbnails-grid" class="organizer-grid"></div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Scanner Settings</h3>
      
      <div class="form-group">
        <label for="scan-filter">Image Filter</label>
        <select id="scan-filter" class="form-control">
          <option value="none">Color (Original)</option>
          <option value="grayscale">Grayscale</option>
          <option value="contrast">High Contrast Document (B&W)</option>
        </select>
      </div>

      <button id="btn-compile-scan" class="btn btn-primary" style="width: 100%; margin-top: 1.5rem;" disabled>
        <i class="bi bi-file-earmark-pdf"></i> Compile Scans to PDF
      </button>
    </div>
  `;

  const video = container.querySelector('#scan-video-feed');
  const captureBtn = container.querySelector('#btn-capture-scan');
  const stopBtn = container.querySelector('#btn-stop-camera');
  const compileBtn = container.querySelector('#btn-compile-scan');
  const thumbsContainer = container.querySelector('#scan-thumbnails-container');
  const thumbsGrid = container.querySelector('#scan-thumbnails-grid');
  const filterSelect = container.querySelector('#scan-filter');

  // Start video stream
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      localStream = stream;
      video.srcObject = stream;
    })
    .catch(err => {
      console.error(err);
      alert('Camera access denied. Please allow camera permissions to use Scan to PDF.');
    });

  // Stop camera stream on navigation
  stopBtn.addEventListener('click', stopCamera);
  
  function stopCamera() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
  }

  // Capture Page
  captureBtn.addEventListener('click', () => {
    if (!video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    // Draw current video frame on canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Apply Filter values
    applyImageFilter(canvas, filterSelect.value);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    scannedPages.push({
      id: scanCounter++,
      dataUrl: dataUrl,
      canvas: canvas
    });

    thumbsContainer.style.display = 'block';
    compileBtn.disabled = false;
    updateScanGrid();
  });

  function applyImageFilter(canvas, filterType) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    if (filterType === 'grayscale') {
      for (let i = 0; i < data.length; i += 4) {
        const val = (data[i] + data[i+1] + data[i+2]) / 3;
        data[i] = val;     // R
        data[i+1] = val;   // G
        data[i+2] = val;   // B
      }
      ctx.putImageData(imgData, 0, 0);
    } else if (filterType === 'contrast') {
      // B&W Document thresholding filter
      for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i+1] + data[i+2]) / 3;
        const val = gray > 120 ? 255 : 0; // high-contrast black/white threshold
        data[i] = val;
        data[i+1] = val;
        data[i+2] = val;
      }
      ctx.putImageData(imgData, 0, 0);
    }
  }

  function updateScanGrid() {
    thumbsGrid.innerHTML = '';
    scannedPages.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'page-thumbnail-card';
      card.innerHTML = `
        <img src="${item.dataUrl}" style="width:100%; height:100%; object-fit:cover;">
        <span class="page-number-badge">${index + 1}</span>
        <div class="page-action-overlay">
          <button class="btn-overlay btn-delete-scan" title="Delete"><i class="bi bi-trash"></i></button>
        </div>
      `;
      card.querySelector('.btn-delete-scan').addEventListener('click', (e) => {
        e.stopPropagation();
        scannedPages = scannedPages.filter(p => p.id !== item.id);
        updateScanGrid();
        if (scannedPages.length === 0) {
          thumbsContainer.style.display = 'none';
          compileBtn.disabled = true;
        }
      });
      thumbsGrid.appendChild(card);
    });
  }

  compileBtn.addEventListener('click', async () => {
    if (scannedPages.length === 0) return;
    
    stopCamera();

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Compiling camera frames into PDF pages...</p>
        </div>
      </div>
    `;

    try {


      const pdfDoc = await PDFDocument.create();

      for (let i = 0; i < scannedPages.length; i++) {
        const item = scannedPages[i];
        
        // Convert canvas to jpeg bytes
        const blob = await new Promise(res => item.canvas.toBlob(res, 'image/jpeg', 0.95));
        const imgBuffer = await blob.arrayBuffer();
        
        const embedImg = await pdfDoc.embedJpg(imgBuffer);
        const w = embedImg.width;
        const h = embedImg.height;

        const page = pdfDoc.addPage([w, h]);
        page.drawImage(embedImg, {
          x: 0,
          y: 0,
          width: w,
          height: h
        });
      }

      const outputBytes = await pdfDoc.save();
      const outputName = 'camera_scan.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-camera-fill success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Compiled Successfully!</h3>
              <p class="result-meta">Pages compiled: ${scannedPages.length}. File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-scan" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-scan-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-scan').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-scan-again').addEventListener('click', () => initScan(container));

    } catch (err) {
      console.error(err);
      alert('Compilation failed: ' + err.message);
      initScan(container);
    }
  });
}
