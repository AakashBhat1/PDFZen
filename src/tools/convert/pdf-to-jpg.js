import { createConvertUI, showSuccessView, showProgressView, showErrorView, pdfjsLib, fileToArrayBuffer, downloadBlob, renderPDFPageToCanvas, backendStatusFieldHTML, refreshBackendStatus, convertViaBackend } from './convert-shared.js';
import JSZip from 'jszip';

// ==========================================
// PDF TO JPG / CBZ
// ==========================================
export function initPdfToJpg(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF document here',
    subtitle: 'Render each PDF page to individual JPG images or a CBZ archive',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-jpg',
    multiple: false,
    settingsHTML: `
      <div class="form-group">
        <label for="pdf-jpg-format">Output Format</label>
        <select id="pdf-jpg-format" class="form-control">
          <option value="zip">ZIP Archive (JPG Images)</option>
          <option value="cbz">Comic Book Archive (.cbz)</option>
        </select>
        <span class="form-help" style="margin-top: 0.4rem; display: block;">
          <strong>ZIP Archive</strong>: A standard folder of JPG files.<br>
          <strong>Comic Book Archive</strong>: A .cbz bundle for sequential reading in comic viewer apps.
        </span>
      </div>
      <div class="form-group" style="margin-top: 1rem;">
        <label for="pdf-jpg-dpi">Render Resolution (DPI)</label>
        <input type="number" id="pdf-jpg-dpi" class="form-control" min="72" max="600" value="200">
        <span class="form-help" style="margin-top: 0.4rem; display: block;">
          Lower DPI is faster; higher DPI is sharper (72–600). Default is 200.
        </span>
      </div>
      ${backendStatusFieldHTML()}
    `
  });

  let fileBuffer = null;
  let file = null;

  refreshBackendStatus(container);

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(f) {
    file = f;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.fileName.innerText = file.name;
    ui.fileMeta.innerText = 'PDF readied. Ready to render pages.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
    refreshBackendStatus(container);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;

    const outputFormat = container.querySelector('#pdf-jpg-format').value;
    let dpi = parseInt(container.querySelector('#pdf-jpg-dpi').value) || 200;
    dpi = Math.max(72, Math.min(dpi, 600));

    const backend = await refreshBackendStatus(container);

    if (backend.ok) {
      const isCbz = outputFormat === 'cbz';
      const ext = isCbz ? '.cbz' : '_images.zip';
      const mime = isCbz ? 'application/x-cbz' : 'application/zip';
      const outputName = file.name.replace(/\.pdf$/i, '') + ext;

      await convertViaBackend(container, file, {
        endpoint: '/convert/pdf-to-jpg',
        fields: { dpi: dpi.toString() },
        outName: outputName,
        mime: mime,
        title: isCbz ? 'PDF converted to Comic Archive!' : 'PDF pages converted to JPG!',
        meta: `Images package: <strong>${outputName}</strong> — Rendered via local Python engine (PyMuPDF at ${dpi} DPI)`,
        icon: isCbz ? 'bi-book-half' : 'bi-file-earmark-zip-fill',
        progressText: `Rendering images at ${dpi} DPI (running PyMuPDF)...`,
        onReload: () => initPdfToJpg(container)
      });
      return;
    }

    const progress = showProgressView(container, 'Loading render tools...');

    try {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      const totalPages = pdf.numPages;
      const filesToZip = [];
      const scale = dpi / 72; // scale for PDF.js based on selected DPI (72 DPI is 1.0 scale)

      for (let i = 1; i <= totalPages; i++) {
        progress.progressText.innerText = `Rendering page ${i} of ${totalPages} to image...`;
        progress.progressBar.style.width = `${15 + (i / totalPages) * 75}%`;

        const page = await pdf.getPage(i);
        const canvas = await renderPDFPageToCanvas(page, scale);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const base64Data = dataUrl.split(',')[1];
        
        const pageNum = String(i).padStart(3, '0');
        filesToZip.push({
          name: `${file.name.replace(/\.pdf$/i, '')}_page_${pageNum}.jpg`,
          data: base64Data
        });
      }

      const isCbz = outputFormat === 'cbz';
      const outputName = file.name.replace(/\.pdf$/i, '') + (isCbz ? '.cbz' : '_images.zip');
      const mimeType = isCbz ? 'application/x-cbz' : 'application/zip';

      progress.progressText.innerText = `Packaging images into ${isCbz ? 'CBZ' : 'ZIP'}...`;
      progress.progressBar.style.width = '95%';
      
      const zip = new JSZip();
      filesToZip.forEach(f => {
        zip.file(f.name, f.data, { base64: true });
      });
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, outputName, mimeType);
      
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: isCbz ? 'PDF converted to Comic Archive!' : 'PDF pages converted to JPG!',
        meta: `Images package: <strong>${outputName}</strong>`,
        icon: isCbz ? 'bi-book-half' : 'bi-file-earmark-zip-fill',
        downloadBtn: false,
        onReload: () => initPdfToJpg(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPdfToJpg(container));
    }
  });
}
