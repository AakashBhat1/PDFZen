import { showSuccessView, showProgressView, showErrorView, downloadBlob } from './convert-shared.js';
import html2pdf from 'html2pdf.js';

// ==========================================
// HTML TO PDF
// ==========================================
export function initHtmlToPdf(container) {
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div class="form-group">
        <label for="html-input-mode">Input Mode</label>
        <select id="html-input-mode" class="form-control">
          <option value="code">Write/Paste Raw HTML Code</option>
          <option value="url">Convert URL (Via Proxy)</option>
        </select>
      </div>

      <!-- Raw HTML Editor -->
      <div id="html-editor-wrapper" class="form-group" style="margin-top: 1rem; flex: 1; display: flex; flex-direction: column;">
        <label for="html-code-area">HTML Code</label>
        <textarea id="html-code-area" class="form-control" style="flex: 1; font-family: monospace; font-size: 0.85rem; min-height: 250px; resize: vertical;" placeholder="<!DOCTYPE html><html><body><h1>Hello World</h1></body></html>"><h1>Welcome to PDFZen</h1><p>Type or paste your HTML here to convert it into a beautiful PDF.</p></textarea>
      </div>

      <!-- URL Input -->
      <div id="html-url-wrapper" class="form-group" style="margin-top: 1rem; display: none;">
        <label for="html-url-input">Website URL</label>
        <input type="url" id="html-url-input" class="form-control" placeholder="https://example.com">
        <span class="form-help">Enter a URL. We will fetch and load the page using a client CORS proxy.</span>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Layout Settings</h3>
      
      <div class="form-group">
        <label for="html-layout-orient">Page Orientation</label>
        <select id="html-layout-orient" class="form-control">
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </div>

      <div class="form-group" style="margin-top: 0.75rem;">
        <label for="html-layout-margin">Page Margin</label>
        <select id="html-layout-margin" class="form-control">
          <option value="0.5">Normal (0.5 inch)</option>
          <option value="0">No Margins (0 inch)</option>
          <option value="1.0">Wide (1.0 inch)</option>
        </select>
      </div>

      <button id="btn-run-html-convert" class="btn btn-primary" style="width: 100%; margin-top: 1.5rem;">
        <i class="bi bi-globe"></i> Generate PDF
      </button>
    </div>
  `;

  const inputMode = container.querySelector('#html-input-mode');
  const editorWrapper = container.querySelector('#html-editor-wrapper');
  const urlWrapper = container.querySelector('#html-url-wrapper');
  const codeArea = container.querySelector('#html-code-area');
  const urlInput = container.querySelector('#html-url-input');
  const runBtn = container.querySelector('#btn-run-html-convert');

  inputMode.addEventListener('change', () => {
    const val = inputMode.value;
    if (val === 'code') {
      editorWrapper.style.display = 'flex';
      urlWrapper.style.display = 'none';
    } else {
      editorWrapper.style.display = 'none';
      urlWrapper.style.display = 'flex';
    }
  });

  runBtn.addEventListener('click', async () => {
    const mode = inputMode.value;
    const orientation = container.querySelector('#html-layout-orient').value;
    const margin = parseFloat(container.querySelector('#html-layout-margin').value);

    let htmlContent = '';
    let nameSuffix = 'webpage';

    if (mode === 'code') {
      htmlContent = codeArea.value.trim();
      if (!htmlContent) return alert('Please input some HTML content.');
      nameSuffix = 'markup';
    } else {
      const url = urlInput.value.trim();
      if (!url) return alert('Please enter a valid URL.');
      
      nameSuffix = url.replace(/https?:\/\/(www\.)?/, '').split('/')[0];
      
      const progress = showProgressView(container, `Fetching webpage via proxy...`);
      try {
        // Fetch URL via public proxy to bypass CORS
        const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
        if (!response.ok) throw new Error('Webpage could not be fetched. Check the URL.');
        
        const data = await response.json();
        htmlContent = data.contents;
      } catch (err) {
        console.error(err);
        return showErrorView(container, `Failed to load URL contents: ${err.message}`, () => initHtmlToPdf(container));
      }
    }

    const progress = showProgressView(container, 'Loading render tools...');
    
    try {

      
      progress.progressText.innerText = 'Generating PDF pages...';
      progress.progressBar.style.width = '70%';

      const renderContainer = document.createElement('div');
      renderContainer.innerHTML = htmlContent;
      renderContainer.style.position = 'fixed';
      renderContainer.style.left = '-9999px';
      // Basic print styles inside container
      renderContainer.style.cssText = 'padding: 40px; background:#fff; color:#000; width: 800px;';
      document.body.appendChild(renderContainer);

      const outputName = `${nameSuffix}_converted.pdf`;
      const opt = {
        margin: margin,
        filename: outputName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 1.5, useCORS: true },
        jsPDF: { unit: 'in', format: 'letter', orientation: orientation }
      };

      const pdfBlob = await html2pdf().set(opt).from(renderContainer).output('blob');
      document.body.removeChild(renderContainer);
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'HTML converted to PDF!',
        meta: `PDF document: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-pdf-fill',
        onDownload: () => downloadBlob(pdfBlob, outputName),
        onReload: () => initHtmlToPdf(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initHtmlToPdf(container));
    }
  });
}
