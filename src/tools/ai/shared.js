import { pdfjsLib } from '../../lib/pdfjs-setup.js';

// --- Shared AI Input Helper ---
export function createAIUI(container, options) {
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
export async function getPDFRawText(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const numPages = pdf.numPages;
  let fullText = '';

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }

  return { text: fullText, pageCount: numPages };
}

// --- Call Gemini API ---
export async function callGemini(prompt, apiKey) {
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
