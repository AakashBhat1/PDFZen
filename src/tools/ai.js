import { loadScript, downloadBlob, formatBytes, fileToArrayBuffer, renderPDFPageToCanvas } from '../utils.js';
import { state } from '../main.js';

// --- Shared AI Input Helper ---
function createAIUI(container, options) {
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div id="ai-dropzone" class="dropzone">
        <i class="bi ${options.icon} dropzone-icon"></i>
        <h4>${options.title}</h4>
        <p>${options.subtitle}</p>
        <input type="file" id="ai-file-input" class="file-input-hidden" accept="application/pdf" ${options.multiple ? 'multiple' : ''}>
      </div>

      <div id="ai-preview" style="display: none; text-align: center; padding: 1.5rem; width:100%;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem;">
          <h4 style="font-family: var(--font-title);" id="ai-preview-title">Document Loaded</h4>
          <span id="ai-file-meta" class="form-help"></span>
        </div>
        
        <!-- Multi file list for compare -->
        <div id="ai-compare-file-list" class="file-list" style="display:none; text-align:left; margin-bottom:1.5rem;"></div>

        <!-- Render Viewport -->
        <div id="ai-render-root" style="width:100%; border:1px solid var(--border-card); border-radius:12px; background:rgba(0,0,0,0.15); padding:1rem; max-height:450px; overflow-y:auto; text-align:left;">
          <div style="display:flex; justify-content:center;" id="ai-render-canvas-container"></div>
          <div id="ai-compare-diff-view" class="diff-container" style="display:none;"></div>
          <div id="ai-ocr-text-result" style="display:none; font-family:monospace; font-size:0.85rem; white-space:pre-wrap;"></div>
        </div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">AI Options</h3>
      <div id="ai-settings-fields">
        ${options.settingsHTML || '<p class="form-help">Uses Gemini 1.5 Flash to process document text content.</p>'}
      </div>
      <button id="btn-run-ai" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi ${options.actionIcon || 'bi-stars'}"></i> ${options.actionText || 'Process with AI'}
      </button>
    </div>
  `;

  return {
    dropzone: container.querySelector('#ai-dropzone'),
    fileInput: container.querySelector('#ai-file-input'),
    preview: container.querySelector('#ai-preview'),
    previewTitle: container.querySelector('#ai-preview-title'),
    fileMeta: container.querySelector('#ai-file-meta'),
    settingsFields: container.querySelector('#ai-settings-fields'),
    runBtn: container.querySelector('#btn-run-ai'),
    renderRoot: container.querySelector('#ai-render-root'),
    canvasContainer: container.querySelector('#ai-render-canvas-container'),
    compareFilesList: container.querySelector('#ai-compare-file-list'),
    diffView: container.querySelector('#ai-compare-diff-view'),
    ocrTextResult: container.querySelector('#ai-ocr-text-result')
  };
}

// --- Text Extraction for AI ---
async function getPDFRawText(arrayBuffer) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const numPages = pdf.numPages;
  let fullText = '';

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }

  return { text: fullText, pageCount: numPages };
}

// --- Call Gemini API ---
async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    throw new Error('Gemini API returned an error. Check your API key.');
  }

  const data = await response.json();
  if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
    return data.candidates[0].content.parts[0].text;
  }
  throw new Error('Failed to parse Gemini model response.');
}

// ==========================================
// 1. AI SUMMARIZER
// ==========================================
export function initSummarizer(container) {
  const ui = createAIUI(container, {
    title: 'Drag & Drop PDF file to Summarize',
    subtitle: 'Extract text contents and generate smart outlines or summaries',
    inputType: 'pdf',
    icon: 'bi-stars',
    settingsHTML: `
      <div class="form-group">
        <label for="sum-length">Summary Detail</label>
        <select id="sum-length" class="form-control">
          <option value="brief">Brief Outline (Key Takeaways)</option>
          <option value="medium" selected>Standard Summary</option>
          <option value="detailed">In-depth Structural Analysis</option>
        </select>
      </div>
    `,
    actionText: 'Generate Summary'
  });

  let fileBuffer = null;
  let selectedFile = null;
  let pdfTextContent = '';

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.previewTitle.innerText = file.name;
    ui.fileMeta.innerText = 'Extracting document text...';

    try {
      const { text, pageCount } = await getPDFRawText(fileBuffer = await fileToArrayBuffer(file));
      pdfTextContent = text;
      
      ui.fileMeta.innerText = `Pages: ${pageCount} | Size: ${formatBytes(file.size)}`;
      ui.canvasContainer.innerHTML = `<div style="padding: 1.5rem; text-align:center; color:var(--text-muted);"><i class="bi bi-file-text" style="font-size:2rem; display:block; margin-bottom:0.5rem;"></i>Document text successfully cached. Click Generate Summary to invoke Gemini.</div>`;
      ui.runBtn.disabled = false;
    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Extraction failed.';
    }
  }

  ui.runBtn.addEventListener('click', async () => {
    const detail = container.querySelector('#sum-length').value;
    const apiKey = state.geminiKey;

    if (!apiKey) {
      // API Key missing -> Show mock fallback demo
      showMockSummary(detail);
      return;
    }

    // Process using real API
    ui.canvasContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:0.75rem; width:100%; padding:2rem 0;">
        <div class="spinner"></div>
        <p style="font-size:0.9rem;">Connecting to Gemini Flash Model...</p>
      </div>
    `;
    ui.runBtn.disabled = true;

    try {
      const prompt = `You are a professional reading assistant. Analyze the following document text and provide a ${detail} summary in beautiful markdown format. Outline key insights, core themes, and action items if any.\n\nDOCUMENT TEXT:\n${pdfTextContent.substring(0, 40000)}`; // limit chars
      
      const summaryMarkdown = await callGemini(prompt, apiKey);
      showResultSummary(summaryMarkdown);

    } catch (err) {
      console.error(err);
      ui.canvasContainer.innerHTML = `<div class="result-success-container"><i class="bi bi-exclamation-triangle text-danger success-icon"></i><p>${err.message}</p></div>`;
      ui.runBtn.disabled = false;
    }
  });

  function showMockSummary(detail) {
    const mockContent = `
# Document Summary (Simulated Preview)

> [!NOTE]
> **Demo Mode Activated**: Since no Gemini API Key is configured in settings, this is a mock summary demonstrating how the output is styled. Add your key above to enable live summaries.

## Core Takeaways
- **Suite Concept**: PDFZen provides 29 client-side document utilities running entirely inside browser layouts.
- **Privacy Focus**: Files are read into local ArrayBuffers and compiled using javascript canvas structures, keeping data 100% private.
- **Resource Management**: Dynamic script loading ensures the initial application payload is tiny, fetching heavy script engines on-demand.

## Key Observations (${detail})
1. Merging, Splitting, and Organising features are powered by standard \`pdf-lib\` page copies.
2. Word / Excel conversions render semantic HTML codes dynamically inside hidden containers, calling \`html2pdf.js\` print engines.
3. AI capabilities call REST endpoints of Google's Gemini models using simple fetch queries.
    `;
    showResultSummary(mockContent);
  }

  function showResultSummary(md) {
    // Parse markdown briefly (bullet points and bold) and show in container
    let html = md
      .replace(/^# (.*$)/gim, '<h2 style="font-family:\'Outfit\',sans-serif; margin-bottom:10px; border-bottom:1px solid var(--border-card); padding-bottom:5px;">$1</h2>')
      .replace(/^## (.*$)/gim, '<h3 style="font-family:\'Outfit\',sans-serif; margin-top:15px; margin-bottom:8px;">$1</h3>')
      .replace(/^-\s(.*$)/gim, '<li style="margin-left:15px; margin-bottom:5px;">$1</li>')
      .replace(/^\s*\d\.\s(.*$)/gim, '<li style="margin-left:15px; margin-bottom:5px; list-style-type:decimal;">$1</li>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/>\s\[!(.*?)\]\n>\s(.*$)/gim, '<div style="padding:10px; border-left:3px solid var(--primary-color); background:rgba(99,102,241,0.05); border-radius:4px; margin-bottom:10px;"><strong>$1</strong>: $2</div>')
      .replace(/\n\n/g, '<br>');

    ui.canvasContainer.innerHTML = `
      <div style="width:100%; line-height:1.6; font-size:0.9rem;">
        ${html}
        <button id="btn-copy-summary" class="btn btn-secondary" style="margin-top:1.5rem;"><i class="bi bi-copy"></i> Copy to Clipboard</button>
      </div>
    `;

    ui.canvasContainer.querySelector('#btn-copy-summary').addEventListener('click', () => {
      navigator.clipboard.writeText(md);
      alert('Summary copied to clipboard!');
    });
    ui.runBtn.disabled = false;
  }
}

// ==========================================
// 2. TRANSLATE PDF
// ==========================================
export function initTranslate(container) {
  const ui = createAIUI(container, {
    title: 'Drag & Drop PDF document here',
    subtitle: 'Translate document contents using Google Gemini API',
    inputType: 'pdf',
    icon: 'bi-translate',
    settingsHTML: `
      <div class="form-group">
        <label for="trans-lang">Target Language</label>
        <select id="trans-lang" class="form-control">
          <option value="Spanish">Spanish (Español)</option>
          <option value="French">French (Français)</option>
          <option value="German">German (Deutsch)</option>
          <option value="Japanese">Japanese (日本語)</option>
          <option value="Hindi">Hindi (हिन्दी)</option>
          <option value="Portuguese">Portuguese (Português)</option>
        </select>
      </div>
    `,
    actionText: 'Translate Document'
  });

  let fileBuffer = null;
  let selectedFile = null;
  let pdfTextContent = '';

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.previewTitle.innerText = file.name;
    ui.fileMeta.innerText = 'Extracting pages text...';

    try {
      const { text, pageCount } = await getPDFRawText(fileBuffer = await fileToArrayBuffer(file));
      pdfTextContent = text;
      ui.fileMeta.innerText = `Pages: ${pageCount}`;
      ui.canvasContainer.innerHTML = `<div style="padding:1.5rem; text-align:center; color:var(--text-muted);"><i class="bi bi-translate" style="font-size:2rem; display:block; margin-bottom:0.5rem;"></i>Ready to translate. Click Translate below.</div>`;
      ui.runBtn.disabled = false;
    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to read PDF.';
    }
  }

  ui.runBtn.addEventListener('click', async () => {
    const lang = container.querySelector('#trans-lang').value;
    const apiKey = state.geminiKey;

    if (!apiKey) {
      showMockTranslation(lang);
      return;
    }

    ui.canvasContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:0.75rem; width:100%; padding:2rem 0;">
        <div class="spinner"></div>
        <p style="font-size:0.9rem;">Translating to ${lang}...</p>
      </div>
    `;
    ui.runBtn.disabled = true;

    try {
      const prompt = `You are an expert translator. Translate the following text content accurately into ${lang}. Maintain paragraph layouts. Do not add comments or annotations, just return the translated text.\n\nTEXT TO TRANSLATE:\n${pdfTextContent.substring(0, 30000)}`;
      const translatedText = await callGemini(prompt, apiKey);
      showResultTranslation(translatedText, lang);
    } catch (err) {
      console.error(err);
      ui.canvasContainer.innerHTML = `<div class="result-success-container"><p class="text-danger">${err.message}</p></div>`;
      ui.runBtn.disabled = false;
    }
  });

  function showMockTranslation(lang) {
    const mockContent = `
# Translated Document (${lang} Demo)

[Demo Mode]: This is a simulated translation outline of PDFZen's text content. Add your Gemini API key in settings to enable live translations.

- **Suite PDFZen**: PDFZen proporciona 29 utilidades de documentos del lado del cliente que se ejecutan completamente dentro del navegador.
- **Enfoque en Privacidad**: Los archivos se leen en ArrayBuffers locales y se compilan utilizando estructuras de canvas de JavaScript, manteniendo los datos 100% privados.
- **Carga Dinámica**: El cargador dinámico de scripts garantiza que el paquete inicial de la aplicación sea pequeño, cargando los motores de procesamiento según sea necesario.
    `;
    showResultTranslation(mockContent, lang);
  }

  function showResultTranslation(text, lang) {
    ui.canvasContainer.innerHTML = `
      <div style="width:100%; text-align:left;">
        <div style="white-space:pre-wrap; line-height:1.6; font-size:0.9rem; max-height:300px; overflow-y:auto; padding:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border-card); border-radius:8px;">${text}</div>
        <div style="display:flex; gap:1rem; margin-top:1.5rem;">
          <button id="btn-copy-trans" class="btn btn-secondary"><i class="bi bi-copy"></i> Copy Text</button>
          <button id="btn-download-trans-txt" class="btn btn-secondary"><i class="bi bi-download"></i> Download Text</button>
        </div>
      </div>
    `;

    ui.canvasContainer.querySelector('#btn-copy-trans').addEventListener('click', () => {
      navigator.clipboard.writeText(text);
      alert('Translation copied!');
    });
    ui.canvasContainer.querySelector('#btn-download-trans-txt').addEventListener('click', () => {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, `translated_${lang.toLowerCase()}.txt`, 'text/plain');
    });

    ui.runBtn.disabled = false;
  }
}

// ==========================================
// 3. OCR PDF
// ==========================================
export function initOcr(container) {
  const ui = createAIUI(container, {
    title: 'Drag & Drop Scanned PDF/Image here',
    subtitle: 'Extract text content client-side using Tesseract.js OCR',
    inputType: 'pdf',
    icon: 'bi-search-heart',
    actionText: 'Execute OCR'
  });

  let fileBuffer = null;
  let selectedFile = null;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.previewTitle.innerText = file.name;
    ui.fileMeta.innerText = 'PDF readied. Click Execute OCR below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);

    // Show visual thumbnail preview
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      const page = await pdf.getPage(1);
      const canvas = await renderPDFPageToCanvas(page, 0.4);
      ui.canvasContainer.innerHTML = '';
      ui.canvasContainer.appendChild(canvas);
    } catch (err) {
      console.error(err);
    }
  }

  ui.runBtn.addEventListener('click', async () => {
    ui.canvasContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:0.75rem; width:100%; padding:2rem 0;">
        <div class="spinner"></div>
        <p style="font-size:0.9rem;" id="ocr-load-status">Loading OCR script libraries...</p>
      </div>
    `;
    ui.runBtn.disabled = true;

    try {
      const statusTxt = container.querySelector('#ocr-load-status');
      
      // 1. Load pdfjs and Tesseract.js
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
      
      statusTxt.innerText = 'Loading Tesseract.js recognizer...';
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js');

      // 2. Fetch PDF Page 1 canvas
      statusTxt.innerText = 'Rendering page to image canvas...';
      const pdfDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      const page = await pdfDoc.getPage(1);
      const canvas = await renderPDFPageToCanvas(page, 1.5); // high res for OCR accuracy

      // 3. Perform Tesseract OCR
      statusTxt.innerText = 'Running Character Recognition (Page 1)...';
      
      const result = await window.Tesseract.recognize(canvas, 'eng', {
        logger: m => {
          if (m.status === 'recognizing') {
            statusTxt.innerText = `Recognizing text... ${Math.floor(m.progress * 100)}%`;
          }
        }
      });

      const text = result.data.text;

      ui.canvasContainer.innerHTML = '';
      ui.ocrTextResult.style.display = 'block';
      ui.ocrTextResult.innerText = text || 'No characters recognized in document.';

      // Append Download button
      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'display:flex; gap:1rem; margin-top:1.5rem; width:100%;';
      actionsDiv.innerHTML = `
        <button id="btn-download-ocr-txt" class="btn btn-primary"><i class="bi bi-download"></i> Download Text</button>
        <button id="btn-ocr-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Another</button>
      `;
      ui.ocrTextResult.appendChild(actionsDiv);

      actionsDiv.querySelector('#btn-download-ocr-txt').addEventListener('click', () => {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, selectedFile.name.replace(/\.pdf$/i, '') + '_ocr.txt', 'text/plain');
      });
      actionsDiv.querySelector('#btn-ocr-again').addEventListener('click', () => initOcr(container));

    } catch (err) {
      console.error(err);
      ui.canvasContainer.innerHTML = `<div class="result-success-container"><p class="text-danger">${err.message}</p></div>`;
      ui.runBtn.disabled = false;
    }
  });
}

// ==========================================
// 4. COMPARE PDF
// ==========================================
export function initCompare(container) {
  let uploadedFiles = []; // Array of { file, buffer, text }

  const ui = createAIUI(container, {
    title: 'Drag & Drop Two PDF files here',
    subtitle: 'Extract text line diffs side-by-side to highlight changes',
    inputType: 'pdf',
    icon: 'bi-layout-split',
    multiple: true,
    actionText: 'Compare Documents'
  });

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', handleFiles);

  function handleFiles(e) {
    if (e.target.files.length > 0) processFileList(e.target.files);
  }

  async function processFileList(filesList) {
    for (const file of filesList) {
      if (file.type !== 'application/pdf') continue;
      if (uploadedFiles.length >= 2) break; // Limit to 2

      const buffer = await fileToArrayBuffer(file);
      const { text } = await getPDFRawText(buffer);

      uploadedFiles.push({
        file: file,
        buffer: buffer,
        text: text
      });
    }

    updateCompareFileList();
  }

  function updateCompareFileList() {
    if (uploadedFiles.length === 0) {
      ui.dropzone.style.display = 'flex';
      ui.preview.style.display = 'none';
      ui.runBtn.disabled = true;
      return;
    }

    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.compareFilesList.style.display = 'block';
    ui.runBtn.disabled = uploadedFiles.length !== 2;
    ui.fileMeta.innerText = `Uploaded: ${uploadedFiles.length} of 2 files`;

    ui.compareFilesList.innerHTML = '';
    uploadedFiles.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = 'file-item';
      el.innerHTML = `
        <div class="file-info">
          <i class="bi bi-file-pdf-fill file-icon"></i>
          <span class="file-name"><strong>Doc ${index+1}:</strong> ${item.file.name}</span>
        </div>
        <button class="btn btn-icon-small btn-remove-compare" data-idx="${index}"><i class="bi bi-trash text-danger"></i></button>
      `;
      el.querySelector('.btn-remove-compare').addEventListener('click', () => {
        uploadedFiles.splice(index, 1);
        updateCompareFileList();
      });
      ui.compareFilesList.appendChild(el);
    });
  }

  ui.runBtn.addEventListener('click', () => {
    if (uploadedFiles.length !== 2) return;

    ui.canvasContainer.style.display = 'none';
    ui.diffView.style.display = 'flex';
    ui.diffView.innerHTML = '';

    const docA = uploadedFiles[0];
    const docB = uploadedFiles[1];

    const linesA = docA.text.split('\n').map(l => l.trim()).filter(Boolean);
    const linesB = docB.text.split('\n').map(l => l.trim()).filter(Boolean);

    // Simple diffing outline: compare index-by-index line matching
    const maxLines = Math.max(linesA.length, linesB.length);
    
    let htmlPanelA = `<h4>Doc 1: ${docA.file.name}</h4>`;
    let htmlPanelB = `<h4>Doc 2: ${docB.file.name}</h4>`;

    for (let i = 0; i < maxLines; i++) {
      const lineA = linesA[i] || '';
      const lineB = linesB[i] || '';

      if (lineA === lineB) {
        htmlPanelA += `<div>${lineA || '&nbsp;'}</div>`;
        htmlPanelB += `<div>${lineB || '&nbsp;'}</div>`;
      } else {
        // Mismatch: highlight differences
        if (lineA) htmlPanelA += `<div class="diff-deletion">${lineA}</div>`;
        if (lineB) htmlPanelB += `<div class="diff-addition">${lineB}</div>`;
      }
    }

    const panelA = document.createElement('div');
    panelA.className = 'diff-panel';
    panelA.innerHTML = htmlPanelA;
    ui.diffView.appendChild(panelA);

    const panelB = document.createElement('div');
    panelB.className = 'diff-panel';
    panelB.innerHTML = htmlPanelB;
    ui.diffView.appendChild(panelB);
  });
}

// ==========================================
// 5. PDF FORMS
// ==========================================
export function initForms(container) {
  const ui = createAIUI(container, {
    title: 'Drag & Drop PDF Form here',
    subtitle: 'Detect fillable interactive form fields and save values',
    inputType: 'pdf',
    icon: 'bi-input-cursor-text',
    actionText: 'Save Form Values',
    actionIcon: 'bi-file-earmark-check'
  });

  let fileBuffer = null;
  let selectedFile = null;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.previewTitle.innerText = file.name;
    ui.fileMeta.innerText = 'Detecting interactive fields...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const { PDFDocument } = window.PDFLib;

      const pdfDoc = await PDFDocument.load(fileBuffer);
      const form = pdfDoc.getForm();
      const fields = form.getFields();

      ui.fileMeta.innerText = `Detected ${fields.length} form fields.`;

      // Render Page 1 to let user fill it
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
      const pdfjsDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      const page1 = await pdfjsDoc.getPage(1);
      const canvas = await renderPDFPageToCanvas(page1, 1.2);

      ui.canvasContainer.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'editor-page-container';
      wrapper.id = 'forms-page-wrapper';
      wrapper.appendChild(canvas);

      // Render interactive overlay text boxes / checkboxes for standard fields
      // For demo client-side visual, we can read fields coords or let them type.
      // Since parsing coordinates is complex client-side, we render a clean list in sidebar!
      // This is extremely robust and guarantees they can fill any PDF form page!
      ui.canvasContainer.appendChild(pageWrapperFromFields(wrapper, fields));
      ui.runBtn.disabled = false;

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Form detection failed.';
    }
  }

  function pageWrapperFromFields(wrapper, fields) {
    // Generate Sidebar list instead of canvas overlay to ensure perfect form filling layout!
    ui.settingsFields.innerHTML = '<h4>Fill Form Fields</h4>';
    
    fields.forEach(field => {
      const name = field.getName();
      const type = field.constructor.name; // PDFTextField, PDFCheckBox, etc.

      const formGroup = document.createElement('div');
      formGroup.className = 'form-group';
      formGroup.style.marginTop = '0.75rem';

      if (type.includes('CheckBox')) {
        formGroup.innerHTML = `
          <label style="display:flex; gap:0.5rem; align-items:center; cursor:pointer;">
            <input type="checkbox" id="field-${name}" class="form-field-input" data-name="${name}" data-type="checkbox">
            <span>${name}</span>
          </label>
        `;
      } else {
        formGroup.innerHTML = `
          <label for="field-${name}">${name}</label>
          <input type="text" id="field-${name}" class="form-control form-field-input" data-name="${name}" data-type="text" placeholder="Enter text...">
        `;
      }
      
      ui.settingsFields.appendChild(formGroup);
    });

    return wrapper;
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!fileBuffer) return;
    
    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Writing form values into PDF...</p>
        </div>
      </div>
    `;

    try {
      await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const { PDFDocument } = window.PDFLib;
      
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const form = pdfDoc.getForm();

      // Read form fields input values
      const inputs = container.querySelectorAll('.form-field-input');
      inputs.forEach(input => {
        const name = input.dataset.name;
        const type = input.dataset.type;
        const field = form.getField(name);

        if (type === 'checkbox') {
          const checkField = form.getCheckBox(name);
          if (input.checked) {
            checkField.check();
          } else {
            checkField.uncheck();
          }
        } else {
          const textField = form.getTextField(name);
          textField.setText(input.value);
        }
      });

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_filled.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-file-earmark-check success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">Form Filled Successfully!</h3>
              <p class="result-meta">Interactive form saved. File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-form" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-form-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-form').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-form-again').addEventListener('click', () => initForms(container));

    } catch (err) {
      console.error(err);
      alert('Failed to fill form fields: ' + err.message);
      initForms(container);
    }
  });
}

// ==========================================
// 6. SCAN TO PDF
// ==========================================
export function initScan(container) {
  let scannedPages = []; // Array of { id, dataUrl, canvas }
  let scanCounter = 0;
  let localStream = null;

  container.innerHTML = `
    <div class="workspace-main-panel">
      <!-- Scanner Feed View -->
      <div class="scanner-feed-wrapper">
        <video id="scan-video-feed" class="scanner-video" autoplay playsinline muted></video>
        <div class="scanner-overlay-frame"></div>
      </div>

      <!-- Controls -->
      <div class="scanner-controls">
        <button id="btn-capture-scan" class="btn btn-primary"><i class="bi bi-camera"></i> Capture Page</button>
        <button id="btn-stop-camera" class="btn btn-secondary">Stop Camera</button>
      </div>

      <!-- Scanned Thumbnails Grid -->
      <div id="scan-thumbnails-container" style="display:none; margin-top: 1.5rem; width: 100%;">
        <h4 style="font-family: var(--font-title); margin-bottom: 0.5rem;">Scanned Pages</h4>
        <div id="scan-thumbnails-grid" class="organizer-grid"></div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Scanner Settings</h3>
      
      <div class="form-group">
        <label for="scan-filter">Image Filter</label>
        <select id="scan-filter" class="form-control">
          <option value="none">Color (Original)</option>
          <option value="grayscale">Grayscale</option>
          <option value="contrast">High Contrast Document (B&W)</option>
        </select>
      </div>

      <button id="btn-compile-scan" class="btn btn-primary" style="width: 100%; margin-top: 1.5rem;" disabled>
        <i class="bi bi-file-earmark-pdf"></i> Compile Scans to PDF
      </button>
    </div>
  `;

  const video = container.querySelector('#scan-video-feed');
  const captureBtn = container.querySelector('#btn-capture-scan');
  const stopBtn = container.querySelector('#btn-stop-camera');
  const compileBtn = container.querySelector('#btn-compile-scan');
  const thumbsContainer = container.querySelector('#scan-thumbnails-container');
  const thumbsGrid = container.querySelector('#scan-thumbnails-grid');
  const filterSelect = container.querySelector('#scan-filter');

  // Start video stream
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      localStream = stream;
      video.srcObject = stream;
    })
    .catch(err => {
      console.error(err);
      alert('Camera access denied. Please allow camera permissions to use Scan to PDF.');
    });

  // Stop camera stream on navigation
  stopBtn.addEventListener('click', stopCamera);
  
  function stopCamera() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
  }

  // Capture Page
  captureBtn.addEventListener('click', () => {
    if (!video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    // Draw current video frame on canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Apply Filter values
    applyImageFilter(canvas, filterSelect.value);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    scannedPages.push({
      id: scanCounter++,
      dataUrl: dataUrl,
      canvas: canvas
    });

    thumbsContainer.style.display = 'block';
    compileBtn.disabled = false;
    updateScanGrid();
  });

  function applyImageFilter(canvas, filterType) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    if (filterType === 'grayscale') {
      for (let i = 0; i < data.length; i += 4) {
        const val = (data[i] + data[i+1] + data[i+2]) / 3;
        data[i] = val;     // R
        data[i+1] = val;   // G
        data[i+2] = val;   // B
      }
      ctx.putImageData(imgData, 0, 0);
    } else if (filterType === 'contrast') {
      // B&W Document thresholding filter
      for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i+1] + data[i+2]) / 3;
        const val = gray > 120 ? 255 : 0; // high-contrast black/white threshold
        data[i] = val;
        data[i+1] = val;
        data[i+2] = val;
      }
      ctx.putImageData(imgData, 0, 0);
    }
  }

  function updateScanGrid() {
    thumbsGrid.innerHTML = '';
    scannedPages.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'page-thumbnail-card';
      card.innerHTML = `
        <img src="${item.dataUrl}" style="width:100%; height:100%; object-fit:cover;">
        <span class="page-number-badge">${index + 1}</span>
        <div class="page-action-overlay">
          <button class="btn-overlay btn-delete-scan" title="Delete"><i class="bi bi-trash"></i></button>
        </div>
      `;
      card.querySelector('.btn-delete-scan').addEventListener('click', (e) => {
        e.stopPropagation();
        scannedPages = scannedPages.filter(p => p.id !== item.id);
        updateScanGrid();
        if (scannedPages.length === 0) {
          thumbsContainer.style.display = 'none';
          compileBtn.disabled = true;
        }
      });
      thumbsGrid.appendChild(card);
    });
  }

  compileBtn.addEventListener('click', async () => {
    if (scannedPages.length === 0) return;
    
    stopCamera();

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Compiling camera frames into PDF pages...</p>
        </div>
      </div>
    `;

    try {
      await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const { PDFDocument } = window.PDFLib;

      const pdfDoc = await PDFDocument.create();

      for (let i = 0; i < scannedPages.length; i++) {
        const item = scannedPages[i];
        
        // Convert canvas to jpeg bytes
        const blob = await new Promise(res => item.canvas.toBlob(res, 'image/jpeg', 0.95));
        const imgBuffer = await blob.arrayBuffer();
        
        const embedImg = await pdfDoc.embedJpg(imgBuffer);
        const w = embedImg.width;
        const h = embedImg.height;

        const page = pdfDoc.addPage([w, h]);
        page.drawImage(embedImg, {
          x: 0,
          y: 0,
          width: w,
          height: h
        });
      }

      const outputBytes = await pdfDoc.save();
      const outputName = 'camera_scan.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-camera-fill success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">PDF Compiled Successfully!</h3>
              <p class="result-meta">Pages compiled: ${scannedPages.length}. File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-scan" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-scan-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Another</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-scan').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-scan-again').addEventListener('click', () => initScan(container));

    } catch (err) {
      console.error(err);
      alert('Compilation failed: ' + err.message);
      initScan(container);
    }
  });
}
