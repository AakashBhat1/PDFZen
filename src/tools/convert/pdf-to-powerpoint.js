import { createConvertUI, showSuccessView, showProgressView, showErrorView, extractPDFText, fileToArrayBuffer, downloadBlob } from './convert-shared.js';
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
    ui.fileMeta.innerText = 'PDF readied. Click Convert below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
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
