import {
  downloadBlob,
  formatBytes,
  fileToArrayBuffer
} from '../../lib/utils.js';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createSecurityUI } from './shared.js';

export function initRepair(container) {
  const ui = createSecurityUI(container, 'Drag & Drop corrupted PDF here', 'Fix cross-reference tables and recover broken layouts', 'bi-tools', false);

  ui.settingsFields.innerHTML = `
    <div class="form-group">
      <label style="display:flex; gap:0.5rem; align-items:center; font-weight:normal; cursor:pointer;">
        <input type="checkbox" id="repair-sanitize">
        <div>
          <strong>Sanitize Document</strong>
          <div style="font-size:0.75rem; color:var(--text-muted)">Strip JavaScript, metadata, attachments, and external links for security.</div>
        </div>
      </label>
    </div>
  `;

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
    ui.fileMeta.innerText = `Corrupt File Size: ${formatBytes(file.size)}. Click Repair below to execute restructuring.`;
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    const sanitize = container.querySelector('#repair-sanitize').checked;

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">${sanitize ? 'Sanitizing and repairing document...' : 'Rebuilding xref document tables...'}</p>
        </div>
      </div>
    `;

    try {
      // Loading with ignoreEncryption will skip errors and reconstruct file
      const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });

      if (sanitize) {
        // 1. Strip catalog-level actions & JavaScript
        pdfDoc.catalog.delete(PDFName.of('OpenAction'));
        pdfDoc.catalog.delete(PDFName.of('AA'));

        const names = pdfDoc.catalog.get(PDFName.of('Names'));
        if (names) {
          const namesDict = pdfDoc.context.lookup(names);
          if (namesDict && typeof namesDict.delete === 'function') {
            namesDict.delete(PDFName.of('JavaScript'));
            namesDict.delete(PDFName.of('EmbeddedFiles'));
          }
        }

        // 2. Strip page-level actions & Link/Attachment annotations
        const pages = pdfDoc.getPages();
        pages.forEach(page => {
          page.node.delete(PDFName.of('AA'));
          
          const annots = page.node.get(PDFName.of('Annots'));
          if (annots) {
            const arr = pdfDoc.context.lookup(annots);
            if (arr && typeof arr.size === 'function') {
              const newAnnots = [];
              for (let i = 0; i < arr.size(); i++) {
                const annot = arr.get(i);
                const annotDict = pdfDoc.context.lookup(annot);
                if (annotDict && typeof annotDict.get === 'function') {
                  const subtype = annotDict.get(PDFName.of('Subtype'));
                  const subtypeStr = subtype ? subtype.toString() : '';
                  if (subtypeStr === '/Link' || subtypeStr === '/FileAttachment') {
                    continue; // exclude links and files
                  }
                }
                newAnnots.push(annot);
              }
              const newArray = pdfDoc.context.obj(newAnnots);
              page.node.set(PDFName.of('Annots'), newArray);
            }
          }
        });

        // 3. Clear document metadata
        pdfDoc.setTitle('');
        pdfDoc.setAuthor('');
        pdfDoc.setSubject('');
        pdfDoc.setKeywords([]);
        pdfDoc.setProducer('PDFZen Sanitizer');
        pdfDoc.setCreator('PDFZen Suite');
      }

      const repairedBytes = await pdfDoc.save();
      const outputName = file.name.replace(/\.pdf$/i, '') + (sanitize ? '_sanitized.pdf' : '_repaired.pdf');

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi ${sanitize ? 'bi-shield-fill-check' : 'bi-tools'} success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">${sanitize ? 'PDF Sanitized and Repaired!' : 'PDF Structure Repaired!'}</h3>
              <p class="result-meta">File rebuilt. File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-sec" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-sec-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-sec').addEventListener('click', () => downloadBlob(repairedBytes, outputName));
      container.querySelector('#btn-sec-again').addEventListener('click', () => initRepair(container));

    } catch (err) {
      console.error(err);
      alert('Operation failed: ' + err.message);
      initRepair(container);
    }
  });
}

// ==========================================
// 5. PDF TO PDF/A
// ==========================================
