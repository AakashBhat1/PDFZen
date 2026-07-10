import { showSuccessView, showProgressView, showErrorView, downloadBlob, refreshBackendStatus } from './convert-shared.js';
import { loadScript } from '../../utils.js';
import html2pdf from 'html2pdf.js';

// ==========================================
// CUSTOM HTML SANITIZER & CORS RESOLVER
// ==========================================
function preprocessHtml(html, originalUrl, backendOnline) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 1. Remove dangerous executable / embed elements
  const tagsToRemove = doc.querySelectorAll('script, iframe, object, embed, applet, form, meta, link');
  tagsToRemove.forEach(tag => tag.remove());

  // 2. Scan all nodes for inline scripts or dangerous protocols
  const allElements = doc.querySelectorAll('*');
  const dangerousSchemes = /^\s*(file|gopher|ftp|javascript):/i;

  allElements.forEach(el => {
    // Strip inline event listeners (onclick, onload, etc.)
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name);
      }
      // Strip links or sources pointing to local files or other unsafe protocols
      if ((attr.name === 'src' || attr.name === 'href' || attr.name === 'data') && dangerousSchemes.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  // 3. Resolve relative URLs using base website URL if originalUrl is provided
  if (originalUrl) {
    try {
      const baseUrl = new URL(originalUrl);
      const allUrls = doc.querySelectorAll('[src], [href]');
      allUrls.forEach(el => {
        const attr = el.hasAttribute('src') ? 'src' : 'href';
        const val = el.getAttribute(attr);
        if (val && !val.startsWith('data:') && !val.startsWith('javascript:') && !val.startsWith('#')) {
          try {
            const absoluteUrl = new URL(val, baseUrl).href;
            el.setAttribute(attr, absoluteUrl);
          } catch (e) {
            // ignore invalid URL
          }
        }
      });
    } catch (e) {
      console.error('Failed to parse base URL for relative link resolution:', e);
    }
  }

  // 4. Proxy external images through local backend to prevent tainted canvas
  if (backendOnline) {
    const allImages = doc.querySelectorAll('img');
    allImages.forEach(img => {
      const src = img.getAttribute('src');
      if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
        img.setAttribute('src', `http://127.0.0.1:5000/proxy/image?url=${encodeURIComponent(src)}`);
      }
    });
  }

  return doc.body.innerHTML;
}

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
          <option value="markdown">Write/Paste Markdown Code</option>
          <option value="url">Convert URL (Via Proxy)</option>
        </select>
      </div>

      <!-- Raw HTML / Markdown Editor -->
      <div id="html-editor-wrapper" class="form-group" style="margin-top: 1rem; flex: 1; display: flex; flex-direction: column;">
        <label for="html-code-area">HTML Code</label>
        <textarea id="html-code-area" class="form-control" style="flex: 1; font-family: monospace; font-size: 0.85rem; min-height: 250px; resize: vertical;" placeholder="<!DOCTYPE html><html><body><h1>Hello World</h1></body></html>"><h1>Welcome to PDFZen</h1><p>Type or paste your HTML here to convert it into a beautiful PDF.</p></textarea>
      </div>

      <!-- URL Input -->
      <div id="html-url-wrapper" class="form-group" style="margin-top: 1rem; display: none;">
        <label for="html-url-input">Website URL</label>
        <input type="url" id="html-url-input" class="form-control" placeholder="https://example.com">
        <span class="form-help">Enter a URL. We will fetch and load the page using a CORS proxy.</span>
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
      editorWrapper.querySelector('label').innerText = 'HTML Code';
      codeArea.placeholder = '<!DOCTYPE html><html><body><h1>Hello World</h1></body></html>';
      if (codeArea.value.trim() === '' || codeArea.value.includes('# Welcome to PDFZen')) {
        codeArea.value = '<h1>Welcome to PDFZen</h1>\n<p>Type or paste your HTML here to convert it into a beautiful PDF.</p>';
      }
    } else if (val === 'markdown') {
      editorWrapper.style.display = 'flex';
      urlWrapper.style.display = 'none';
      editorWrapper.querySelector('label').innerText = 'Markdown Code';
      codeArea.placeholder = '# Heading 1\n\nWrite your markdown text here...';
      if (codeArea.value.trim() === '' || codeArea.value.includes('Welcome to PDFZen')) {
        codeArea.value = '# Welcome to PDFZen\n\nType or paste your Markdown here to convert it into a beautiful PDF.';
      }
    } else {
      editorWrapper.style.display = 'none';
      urlWrapper.style.display = 'flex';
    }
  });

  runBtn.addEventListener('click', async () => {
    const mode = inputMode.value;
    const orientation = container.querySelector('#html-layout-orient').value;
    const margin = parseFloat(container.querySelector('#html-layout-margin').value);

    // Check backend connection status for image proxying
    const backend = await refreshBackendStatus(container);

    let htmlContent = '';
    let nameSuffix = 'webpage';

    if (mode === 'code') {
      const rawHtml = codeArea.value.trim();
      if (!rawHtml) return alert('Please input some HTML content.');
      htmlContent = preprocessHtml(rawHtml, null, backend.ok);
      nameSuffix = 'markup';
    } else if (mode === 'markdown') {
      const markdown = codeArea.value.trim();
      if (!markdown) return alert('Please input some Markdown content.');

      const progress = showProgressView(container, 'Loading markdown compiler...');
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
        const compiledHtml = typeof window.marked.parse === 'function' ? window.marked.parse(markdown) : window.marked(markdown);
        htmlContent = preprocessHtml(compiledHtml, null, backend.ok);
        nameSuffix = 'markdown';
      } catch (err) {
        console.error(err);
        return showErrorView(container, `Failed to compile Markdown: ${err.message}`, () => initHtmlToPdf(container));
      }
    } else {
      const url = urlInput.value.trim();
      if (!url) return alert('Please enter a valid URL.');
      
      nameSuffix = url.replace(/https?:\/\/(www\.)?/, '').split('/')[0];
      
      const progress = showProgressView(container, `Fetching webpage via proxy...`);
      try {
        let fetchedHtml = '';
        if (backend.ok) {
          const response = await fetch(`http://127.0.0.1:5000/proxy/webpage?url=${encodeURIComponent(url)}`);
          if (!response.ok) throw new Error(`Webpage could not be fetched by local backend: HTTP ${response.status}`);
          fetchedHtml = await response.text();
        } else {
          // Fallback to public CORS proxy if backend is offline
          const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
          if (!response.ok) throw new Error('Webpage could not be fetched by public proxy.');
          const data = await response.json();
          fetchedHtml = data.contents;
        }
        htmlContent = preprocessHtml(fetchedHtml, url, backend.ok);
      } catch (err) {
        console.error(err);
        return showErrorView(container, `Failed to load URL contents: ${err.message}`, () => initHtmlToPdf(container));
      }
    }

    const progress = showProgressView(container, 'Generating PDF pages...');
    
    try {
      progress.progressBar.style.width = '70%';

      const renderContainer = document.createElement('div');
      renderContainer.innerHTML = htmlContent;
      renderContainer.style.position = 'fixed';
      renderContainer.style.left = '-9999px';
      
      // Basic styled wrapper inside container
      renderContainer.style.cssText = 'padding: 40px; background:#fff; color:#000; width: 800px; font-family: sans-serif;';
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
        title: 'HTML/Markdown converted to PDF!',
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
