import { createConvertUI, showSuccessView, showProgressView, showErrorView, fileToArrayBuffer, downloadBlob, backendStatusFieldHTML, refreshBackendStatus, convertViaBackend } from './convert-shared.js';
import JSZip from 'jszip';
import html2pdf from 'html2pdf.js';

// ==========================================
// POWERPOINT TO PDF
// ==========================================
export function initPowerpointToPdf(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PPTX slide deck here',
    subtitle: 'Extract text slides into PDF presentation slides',
    inputType: 'powerpoint',
    icon: 'bi-file-ppt',
    fileIcon: 'bi-file-pdf',
    multiple: false,
    settingsHTML: backendStatusFieldHTML('Start the local Python server with LibreOffice installed for high-fidelity conversion.')
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
    ui.fileMeta.innerText = 'PowerPoint loaded. Click Convert below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
    refreshBackendStatus(container);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;

    const backend = await refreshBackendStatus(container);

    if (backend.ok && backend.libreoffice) {
      const outputName = file.name.replace(/\.pptx$|\.ppt$/i, '') + '.pdf';
      await convertViaBackend(container, file, {
        endpoint: '/convert/powerpoint-to-pdf',
        outName: outputName,
        mime: 'application/pdf',
        title: 'PowerPoint Converted to PDF!',
        meta: `PDF file: <strong>${outputName}</strong> — Converted via local Python engine (LibreOffice)`,
        icon: 'bi-file-earmark-pdf-fill',
        progressText: 'Converting slides (running LibreOffice)...',
        onReload: () => initPowerpointToPdf(container)
      });
      return;
    }

    const progress = showProgressView(container, 'Unpacking PowerPoint slides...');
    
    try {
      const zip = await JSZip.loadAsync(fileBuffer);
      
      progress.progressText.innerText = 'Parsing slide XML content...';
      progress.progressBar.style.width = '40%';
      
      // PowerPoint slides are listed in ppt/slides/slide1.xml, etc.
      // Look for files matching this pattern
      const slideFiles = Object.keys(zip.files).filter(k => k.startsWith('ppt/slides/slide') && k.endsWith('.xml'));
      
      // Sort numerically by slide number
      slideFiles.sort((a, b) => {
        const numA = parseInt(a.replace(/[^\d]/g, ''), 10);
        const numB = parseInt(b.replace(/[^\d]/g, ''), 10);
        return numA - numB;
      });

      if (slideFiles.length === 0) {
        throw new Error('No slide files found in PPTX container structure.');
      }

      let slidesHtml = '';
      for (let i = 0; i < slideFiles.length; i++) {
        const slideXml = await zip.file(slideFiles[i]).async('text');
        
        // Simple XML parser to pull text within <a:t> elements
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(slideXml, 'text/xml');
        const textElements = xmlDoc.getElementsByTagName('a:t');
        
        const textLines = Array.from(textElements).map(el => el.textContent.trim()).filter(Boolean);
        
        let title = `Slide ${i + 1}`;
        let bullets = textLines;
        if (textLines.length > 0) {
          title = textLines[0];
          bullets = textLines.slice(1);
        }

        slidesHtml += `
          <div class="slide-page" style="page-break-after: always; width: 10in; height: 7.5in; padding: 0.75in; background: #fff; box-shadow: inset 0 0 10px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: flex-start; box-sizing: border-box;">
            <h1 style="font-family:'Outfit', sans-serif; font-size: 2.2rem; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 15px; margin-top:0;">${title}</h1>
            <ul style="font-family: sans-serif; font-size: 1.35rem; line-height: 1.8; color: #374151; margin-top: 30px; padding-left: 20px;">
              ${bullets.map(b => `<li style="margin-bottom: 10px;">${b}</li>`).join('')}
            </ul>
          </div>
        `;
      }

      progress.progressText.innerText = 'Creating PDF document...';
      progress.progressBar.style.width = '70%';

      const renderContainer = document.createElement('div');
      renderContainer.innerHTML = slidesHtml;
      renderContainer.style.position = 'fixed';
      renderContainer.style.left = '-9999px';
      document.body.appendChild(renderContainer);

      progress.progressText.innerText = 'Printing slides to PDF...';
      progress.progressBar.style.width = '85%';

      const outputName = file.name.replace(/\.pptx$|\.ppt$/i, '') + '.pdf';
      const opt = {
        margin: 0,
        filename: outputName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        // Standard presentation ratio: 10in x 7.5in (landscape)
        jsPDF: { unit: 'in', format: [10, 7.5], orientation: 'landscape' }
      };

      const pdfBlob = await html2pdf().set(opt).from(renderContainer).output('blob');
      document.body.removeChild(renderContainer);
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'PowerPoint converted to PDF!',
        meta: `PDF file: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-pdf-fill',
        onDownload: () => downloadBlob(pdfBlob, outputName),
        onReload: () => initPowerpointToPdf(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPowerpointToPdf(container));
    }
  });
}
