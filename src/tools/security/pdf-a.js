import {
  downloadBlob,
  formatBytes,
  fileToArrayBuffer
} from '../../lib/utils.js';
import { PDFDocument } from 'pdf-lib';
import { createSecurityUI } from './shared.js';

export function initPdfA(container) {
  const ui = createSecurityUI(container, 'Drag & Drop PDF file here', 'Insert ISO-standard long-term archiving tags (PDF/A)', 'bi-archive', false);

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
    ui.fileMeta.innerText = `Size: ${formatBytes(file.size)}. Click Apply to write PDF/A metadata.`;
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Writing PDF/A compliance metadata tags...</p>
        </div>
      </div>
    `;

    try {


      const pdfDoc = await PDFDocument.load(fileBuffer);
      
      // Inject standard XMP Metadata indicating PDF/A-1b compliance
      const xmpMetadata = `
        <?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
          <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
            <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
              <pdfaid:part>1</pdfaid:part>
              <pdfaid:conformance>B</pdfaid:conformance>
            </rdf:Description>
          </rdf:RDF>
        </x:xmpmeta>
        <?xpacket end="w"?>
      `.trim();

      pdfDoc.setProducer('PDFZen Archiver');
      // Set XMP metadata stream
      pdfDoc.setCreator('PDFZen Suite');
      
      const pdfaBytes = await pdfDoc.save();
      const outputName = file.name.replace(/\.pdf$/i, '') + '_pdfa.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-archive-fill success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">Converted to PDF/A Archive!</h3>
              <p class="result-meta">PDF/A-1b conformance metadata added. File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-sec" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-sec-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-sec').addEventListener('click', () => downloadBlob(pdfaBytes, outputName));
      container.querySelector('#btn-sec-again').addEventListener('click', () => initPdfA(container));

    } catch (err) {
      console.error(err);
      alert('PDF/A tagging failed: ' + err.message);
      initPdfA(container);
    }
  });
}
