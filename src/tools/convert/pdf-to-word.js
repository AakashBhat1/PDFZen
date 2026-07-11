import { createConvertUI, showSuccessView, showProgressView, showErrorView, pdfjsLib, fileToArrayBuffer, downloadBlob, renderPDFPageToCanvas, backendStatusFieldHTML, refreshBackendStatus, convertViaBackend } from './convert-shared.js';
import { Document, Paragraph, ImageRun, Packer, AlignmentType } from 'docx';
import { pdfjsDataFromBuffer, yieldToUI, releaseCanvas } from '../../lib/utils.js';

// ==========================================
// PDF TO WORD
// ==========================================

export function initPdfToWord(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF file here',
    subtitle: 'Convert to Microsoft Word (.docx) with preserved formatting',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-docx',
    multiple: false,
    settingsHTML: `
      <div class="form-group">
        <label for="pdf-word-mode">Conversion Mode</label>
        <select id="pdf-word-mode" class="form-control">
          <option value="rich">Rich Text (Preserves formatting)</option>
          <option value="image">Image-Based (Full page fidelity)</option>
        </select>
        <span class="form-help" style="margin-top: 0.4rem; display: block;">
          <strong>Rich Text</strong>: Extracts text with bold, italic, fonts, and sizing via the local Python backend (pdf2docx).<br>
          <strong>Image-Based</strong>: Renders each page as a high-res image in Word for pixel-perfect output (browser).
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

  ui.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); ui.dropzone.classList.add('dragover'); });
  ui.dropzone.addEventListener('dragleave', () => { ui.dropzone.classList.remove('dragover'); });
  ui.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    ui.dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) processFile(e.dataTransfer.files[0]);
  });

  async function processFile(f) {
    file = f;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.fileName.innerText = file.name;
    ui.fileMeta.innerText = 'File selected. Ready to convert.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
    refreshBackendStatus(container);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;

    const mode = container.querySelector('#pdf-word-mode').value;
    const backend = await refreshBackendStatus(container);

    if (!backend.ok) {
      showErrorView(container, "Local Python backend is offline. Please start it using 'start.bat' (or 'uv run server.py') to enable high-fidelity PDF to Word conversion.", () => initPdfToWord(container));
      return;
    }

    if (mode === 'rich') {
      const outputName = file.name.replace(/\.pdf$/i, '') + '.docx';
      await convertViaBackend(container, file, {
        endpoint: '/convert/pdf-to-word',
        outName: outputName,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        title: 'PDF Converted to Word (High Quality)!',
        meta: `Word document: <strong>${outputName}</strong> — Converted via local Python engine (pdf2docx)`,
        icon: 'bi-file-earmark-word-fill',
        progressText: 'Converting layout (running pdf2docx)...',
        onReload: () => initPdfToWord(container)
      });
    } else if (mode === 'image') {
      await convertImageBased(container, file, fileBuffer);
    }
  });
}

/**
 * Image-Based conversion — renders each PDF page as a high-res image and embeds into Word.
 */
async function convertImageBased(container, file, fileBuffer) {
  const progress = showProgressView(container, 'Rendering PDF pages...');

  try {
    const pdf = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
    const numPages = pdf.numPages;
    const docChildren = [];

    for (let i = 1; i <= numPages; i++) {
      progress.progressText.innerText = `Rendering page ${i} of ${numPages}...`;
      progress.progressBar.style.width = `${10 + (i / numPages) * 70}%`;

      const page = await pdf.getPage(i);
      // Keep scale 2.5 — same fidelity as before; free canvas after each page
      const canvas = await renderPDFPageToCanvas(page, 2.5);

      try {
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
        });
        const imgBuffer = await blob.arrayBuffer();

        const targetWidthPx = 600;
        const aspectRatio = canvas.height / canvas.width;
        const targetHeightPx = Math.round(targetWidthPx * aspectRatio);

        docChildren.push(new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: new Uint8Array(imgBuffer),
              transformation: {
                width: targetWidthPx,
                height: targetHeightPx
              }
            })
          ],
          alignment: AlignmentType.CENTER
        }));
      } finally {
        releaseCanvas(canvas);
      }

      if (i < numPages) {
        docChildren.push(new Paragraph({
          children: [],
          pageBreakBefore: true
        }));
      }
      if (i % 2 === 0) await yieldToUI();
    }

    progress.progressText.innerText = 'Packaging Word document...';
    progress.progressBar.style.width = '90%';

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: 360,
              bottom: 360,
              left: 360,
              right: 360
            }
          }
        },
        children: docChildren
      }]
    });

    const docxBlob = await Packer.toBlob(doc);
    progress.progressBar.style.width = '100%';

    const outputName = file.name.replace(/\.pdf$/i, '') + '.docx';
    showSuccessView(container, {
      title: 'PDF Converted to Word (Image Mode)!',
      meta: `Word document: <strong>${outputName}</strong> — Pages rendered as high-res images`,
      icon: 'bi-file-earmark-word-fill',
      onDownload: () => downloadBlob(docxBlob, outputName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      onReload: () => initPdfToWord(container)
    });

  } catch (err) {
    console.error(err);
    showErrorView(container, err.message, () => initPdfToWord(container));
  }
}
