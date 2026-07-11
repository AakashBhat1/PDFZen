import {
  downloadBlob,
  fileToArrayBuffer
} from '../../lib/utils.js';
import { PDFDocument as CantooPDFDocument } from '@cantoo/pdf-lib';
import { createSecurityUI } from './shared.js';

export function initUnlock(container) {
  const ui = createSecurityUI(container, 'Drag & Drop Protected PDF here', 'Remove password credentials from encrypted files', 'bi-unlock', true);

  let fileBuffer = null;
  let file = null;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(f) {
    file = f;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.fileName.innerText = file.name;
    ui.fileMeta.innerText = 'Input password and click Unlock below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    const password = ui.passwordInput.value.trim();
    if (!password) return alert('Please input the document password.');

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Decrypting and saving document...</p>
        </div>
      </div>
    `;

    try {
      const pdfDoc = await CantooPDFDocument.load(fileBuffer, { password: password });
      const decryptedBytes = await pdfDoc.save(); // Automatically saves unencrypted

      const outputName = file.name.replace(/\.pdf$/i, '') + '_unlocked.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-unlock-fill success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Decrypted and Unlocked!</h3>
              <p class="result-meta">Password protection removed. File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-sec" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-sec-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Unlock Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-sec').addEventListener('click', () => downloadBlob(decryptedBytes, outputName));
      container.querySelector('#btn-sec-again').addEventListener('click', () => initUnlock(container));

    } catch (err) {
      console.error(err);
      alert('Unlock failed: Incorrect password or invalid file.');
      initUnlock(container);
    }
  });
}

// ==========================================
// 3. REDACT PDF
// ==========================================
