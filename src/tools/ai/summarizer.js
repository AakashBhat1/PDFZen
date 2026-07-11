import {
  formatBytes,
  fileToArrayBuffer
} from '../../lib/utils.js';
import { state } from '../../main.js';
import { callGemini, createAIUI, getPDFRawText } from './shared.js';

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
