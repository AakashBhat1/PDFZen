import {
  downloadBlob,
  formatBytes,
  fileToArrayBuffer
} from '../../lib/utils.js';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';
import { createSecurityUI } from './shared.js';

export function initProtect(container) {
  const ui = createSecurityUI(container, 'Drag & Drop PDF file here', 'Protect PDF document with password encryption', 'bi-shield-lock', true);

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
    ui.fileMeta.innerText = `Size: ${formatBytes(file.size)}. Input password and click Apply.`;
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    const password = ui.passwordInput.value.trim();
    if (!password) return alert('Please enter a password to protect the PDF.');

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Encrypting PDF document...</p>
        </div>
      </div>
    `;

    try {

      

      
      // 3. Encrypt the file
      const encryptedBytes = await encryptPDF(new Uint8Array(fileBuffer), password);
      
      const outputName = file.name.replace(/\.pdf$/i, '') + '_protected.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-shield-lock-fill success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Encrypted and Protected!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-sec" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-sec-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Protect Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-sec').addEventListener('click', () => downloadBlob(encryptedBytes, outputName));
      container.querySelector('#btn-sec-again').addEventListener('click', () => initProtect(container));

    } catch (err) {
      console.error(err);
      alert('Encryption failed: ' + err.message);
      initProtect(container);
    }
  });
}

// ==========================================
// 2. UNLOCK PDF (DECRYPT)
// ==========================================
