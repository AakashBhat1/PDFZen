import { createConvertUI, showSuccessView, showProgressView, showErrorView, extractPDFText, fileToArrayBuffer, downloadBlob, backendStatusFieldHTML, refreshBackendStatus, convertViaBackend } from './convert-shared.js';
import PptxGenJS from 'pptxgenjs';

// ==========================================
// PDF TO POWERPOINT
// ==========================================
export function initPdfToPowerpoint(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF document here',
    subtitle: 'Extract text lines into editing PowerPoint slides (.pptx)',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-pptx',
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
    ui.fileMeta.innerText = 'PDF readied. Click Convert below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
    refreshBackendStatus(container);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;

    const backend = await refreshBackendStatus(container);

    if (backend.ok) {
      if (backend.libreoffice) {
        const outputName = file.name.replace(/\.pdf$/i, '') + '.pptx';
        await convertViaBackend(container, file, {
          endpoint: '/convert/pdf-to-powerpoint',
          outName: outputName,
          mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          title: 'PDF Converted to Slides!',
          meta: `PowerPoint slide deck: <strong>${outputName}</strong> — Extracted via local Python engine (LibreOffice)`,
          icon: 'bi-file-earmark-ppt-fill',
          progressText: 'Converting slides (running LibreOffice)...',
          onReload: () => initPdfToPowerpoint(container)
        });
        return;
      } else {
        const statusEl = container.querySelector('#backend-status');
        if (statusEl) {
          statusEl.innerHTML = `<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #ffc107; margin-right: 0.5rem;"></span>Connected (LibreOffice Missing)`;
          statusEl.style.color = '#ffc107';
        }
      }
    }

    const progress = showProgressView(container, 'Parsing slides text...');
    
    try {
      const pagesText = await extractPDFText(fileBuffer, (current, total) => {
        progress.progressText.innerText = `Extracting PDF layouts... Page ${current} of ${total}`;
        progress.progressBar.style.width = `${10 + (current / total) * 50}%`;
      });

      progress.progressText.innerText = 'Creating presentation...';
      progress.progressBar.style.width = '85%';
      
      const pres = new PptxGenJS();
      
      pagesText.forEach((lines, pageIdx) => {
        const slide = pres.addSlide();
        
        // Define Slide Title
        let titleText = `Slide ${pageIdx + 1}`;
        let bodyLines = [];
        
        if (lines.length > 0) {
          titleText = lines[0]; // Heuristic: first line is slide header
          bodyLines = lines.slice(1);
        }

        // Add Slide Title
        slide.addText(titleText, {
          x: 0.5,
          y: 0.5,
          w: 9.0,
          h: 0.8,
          fontSize: 24,
          bold: true,
          color: '363636',
          fontFace: 'Arial'
        });

        // Add Slide Content
        if (bodyLines.length > 0) {
          slide.addText(bodyLines.join('\n'), {
            x: 0.5,
            y: 1.5,
            w: 9.0,
            h: 5.0,
            fontSize: 14,
            color: '666666',
            fontFace: 'Arial',
            valign: 'top'
          });
        }
      });

      // Write PPTX presentation
      progress.progressText.innerText = 'Saving slide deck...';
      progress.progressBar.style.width = '95%';
      
      const outputName = file.name.replace(/\.pdf$/i, '') + '.pptx';
      await pres.writeFile({ fileName: outputName });
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'PDF Converted to Slides!',
        meta: `PowerPoint slide deck: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-ppt-fill',
        downloadBtn: false, // Automatically saved/downloaded by pptxgen.js
        onReload: () => initPdfToPowerpoint(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPdfToPowerpoint(container));
    }
  });
}
