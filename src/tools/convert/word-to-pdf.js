import { createConvertUI, showSuccessView, showProgressView, showErrorView, fileToArrayBuffer, downloadBlob } from './convert-shared.js';
import mammoth from 'mammoth';
import html2pdf from 'html2pdf.js';

// ==========================================
// WORD TO PDF
// ==========================================
export function initWordToPdf(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop Word file here (.docx)',
    subtitle: 'Make DOCX files easy to read by converting them to PDF',
    inputType: 'word',
    icon: 'bi-file-word',
    fileIcon: 'bi-file-pdf',
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
    ui.fileMeta.innerText = 'File loaded. Click Convert below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Loading conversion tools...');
    
    try {
      // 1. Convert docx to HTML using mammoth
      progress.progressText.innerText = 'Extracting Word layout...';
      progress.progressBar.style.width = '30%';
      
      const result = await mammoth.convertToHtml({ arrayBuffer: fileBuffer });
      const htmlContent = result.value; // The rendered html string

      // 2. Render to PDF
      progress.progressText.innerText = 'Loading PDF render engine...';
      progress.progressBar.style.width = '60%';

      // 3. Render HTML in a structured paper format
      progress.progressText.innerText = 'Rendering layouts...';
      progress.progressBar.style.width = '85%';
      
      const renderContainer = document.createElement('div');
      renderContainer.id = 'word-pdf-render-root';
      renderContainer.style.cssText = 'padding: 40px; font-family: "Georgia", serif; line-height: 1.6; color: #111; background: #fff; width: 800px;';
      renderContainer.innerHTML = htmlContent;
      
      // Inject temporarily into document body (hidden)
      renderContainer.style.position = 'fixed';
      renderContainer.style.left = '-9999px';
      document.body.appendChild(renderContainer);

      // Save PDF via html2pdf
      const outputName = file.name.replace(/\.docx$/i, '') + '.pdf';
      const opt = {
        margin: 0.75,
        filename: outputName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
      };

      const pdfBlob = await html2pdf().set(opt).from(renderContainer).output('blob');
      
      // Cleanup
      document.body.removeChild(renderContainer);
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'Word converted to PDF!',
        meta: `PDF file: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-pdf-fill',
        onDownload: () => downloadBlob(pdfBlob, outputName),
        onReload: () => initWordToPdf(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initWordToPdf(container));
    }
  });
}
