import { createConvertUI, showSuccessView, showProgressView, showErrorView, pdfjsLib, fileToArrayBuffer, downloadBlob, renderPDFPageToCanvas } from './convert-shared.js';
import JSZip from 'jszip';

// ==========================================
// PDF TO JPG
// ==========================================
export function initPdfToJpg(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF document here',
    subtitle: 'Render each PDF page to individual JPG images',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-jpg',
    multiple: false
  });

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
    ui.fileMeta.innerText = 'PDF readied. Ready to render pages.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Loading render tools...');
    
    try {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      const totalPages = pdf.numPages;
      const filesToZip = [];

      for (let i = 1; i <= totalPages; i++) {
        progress.progressText.innerText = `Rendering page ${i} of ${totalPages} to image...`;
        progress.progressBar.style.width = `${15 + (i / totalPages) * 75}%`;
        
        const page = await pdf.getPage(i);
        const canvas = await renderPDFPageToCanvas(page, 2.0); // 2.0 scale for high resolution JPG
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const base64Data = dataUrl.split(',')[1];
        
        const pageNum = String(i).padStart(3, '0');
        filesToZip.push({
          name: `${file.name.replace(/\.pdf$/i, '')}_page_${pageNum}.jpg`,
          data: base64Data
        });
      }

      progress.progressText.innerText = 'Packaging images into ZIP...';
      progress.progressBar.style.width = '95%';
      
      const zipName = file.name.replace(/\.pdf$/i, '') + '_images.zip';
      
      const zip = new JSZip();
      filesToZip.forEach(f => {
        zip.file(f.name, f.data, { base64: true });
      });
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, zipName, 'application/zip');
      
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'PDF pages converted to JPG!',
        meta: `Images package: <strong>${zipName}</strong>`,
        icon: 'bi-file-earmark-zip-fill',
        downloadBtn: false,
        onReload: () => initPdfToJpg(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPdfToJpg(container));
    }
  });
}
