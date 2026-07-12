import {
  formatBytes,
  fileToArrayBuffer,
  pdfjsDataFromBuffer,
  renderPDFPageToCanvas,
  yieldToUI
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import { state } from '../../main.js';
import {
  aiProviderLabel,
  callAI,
  createAIUI,
  isVisionModel,
  pdfPagesToBase64Images
} from './shared.js';

const SUM_APPEAR_KEY = 'pdfzen_summarizer_appearance';

function loadAppearance() {
  try {
    const raw = localStorage.getItem(SUM_APPEAR_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      mode: parsed.mode || 'light',
      theme: parsed.theme || 'indigo',
      font: parsed.font || 'inter'
    };
  } catch {
    return { mode: 'light', theme: 'indigo', font: 'inter' };
  }
}

function saveAppearance(cfg) {
  localStorage.setItem(SUM_APPEAR_KEY, JSON.stringify(cfg));
}

/**
 * Extract text for a single 1-based page number.
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfDoc
 * @param {number} pageNumber
 */
async function extractPageText(pdfDoc, pageNumber) {
  const page = await pdfDoc.getPage(pageNumber);
  const textContent = await page.getTextContent();
  return textContent.items
    .map((item) => item.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function initSummarizer(container) {
  const appear = loadAppearance();

  const ui = createAIUI(container, {
    title: 'Drag & Drop a PDF to analyze one page',
    subtitle: 'Pick a single page, then send only that page to Gemini or local Ollama',
    inputType: 'pdf',
    icon: 'bi-stars',
    settingsHTML: `
      <div class="form-group">
        <label for="sum-page-select">Page to analyze</label>
        <div style="display:flex; gap:0.4rem; align-items:center;">
          <button type="button" id="sum-page-prev" class="btn btn-secondary" style="padding:0.4rem 0.65rem;" disabled title="Previous page">
            <i class="bi bi-chevron-left"></i>
          </button>
          <input type="number" id="sum-page-select" class="form-control" min="1" value="1" disabled style="text-align:center;">
          <button type="button" id="sum-page-next" class="btn btn-secondary" style="padding:0.4rem 0.65rem;" disabled title="Next page">
            <i class="bi bi-chevron-right"></i>
          </button>
        </div>
        <span class="form-help" id="sum-page-hint" style="display:block;margin-top:0.35rem;">
          Load a PDF, click a page thumbnail, then generate.
        </span>
      </div>

      <div class="form-group" style="margin-top:0.85rem;">
        <label for="sum-length">Summary Detail</label>
        <select id="sum-length" class="form-control">
          <option value="brief">Brief Outline (Key Takeaways)</option>
          <option value="medium" selected>Standard Summary</option>
          <option value="detailed">In-depth Structural Analysis</option>
        </select>
      </div>

      <div class="form-group" style="margin-top:0.85rem;">
        <label for="sum-provider">AI Engine</label>
        <select id="sum-provider" class="form-control">
          <option value="auto">Use app Settings (${state.aiProvider === 'ollama' ? 'Ollama' : 'Gemini'})</option>
          <option value="gemini">Google Gemini (API key)</option>
          <option value="ollama">Local Ollama</option>
        </select>
        <span class="form-help" id="sum-provider-hint" style="display:block;margin-top:0.35rem;"></span>
      </div>

      <div class="form-group" style="margin-top:0.85rem;" id="sum-vision-group">
        <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-weight:normal;">
          <input type="checkbox" id="sum-include-vision" checked>
          <span>Include page image (vision)</span>
        </label>
        <span class="form-help" style="display:block;margin-top:0.35rem;">
          Sends a screenshot of the <strong>selected page only</strong> (VL models). Off = text only, lighter on RAM.
        </span>
      </div>

      <div class="form-group" style="margin-top:0.85rem; border-top:1px solid var(--border-card); padding-top:0.85rem;">
        <label>Summary appearance</label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-top:0.4rem;">
          <div>
            <span class="form-help">Mode</span>
            <select id="sum-mode" class="form-control">
              <option value="light" ${appear.mode === 'light' ? 'selected' : ''}>Light</option>
              <option value="dark" ${appear.mode === 'dark' ? 'selected' : ''}>Dark</option>
            </select>
          </div>
          <div>
            <span class="form-help">Color theme</span>
            <select id="sum-theme" class="form-control">
              <option value="indigo" ${appear.theme === 'indigo' ? 'selected' : ''}>Indigo</option>
              <option value="ocean" ${appear.theme === 'ocean' ? 'selected' : ''}>Ocean</option>
              <option value="forest" ${appear.theme === 'forest' ? 'selected' : ''}>Forest</option>
              <option value="sunset" ${appear.theme === 'sunset' ? 'selected' : ''}>Sunset</option>
              <option value="rose" ${appear.theme === 'rose' ? 'selected' : ''}>Rose</option>
              <option value="slate" ${appear.theme === 'slate' ? 'selected' : ''}>Slate</option>
            </select>
          </div>
        </div>
        <span class="form-help" style="display:block;margin-top:0.5rem;">Font</span>
        <select id="sum-font" class="form-control">
          <option value="inter" ${appear.font === 'inter' ? 'selected' : ''}>Inter</option>
          <option value="outfit" ${appear.font === 'outfit' ? 'selected' : ''}>Outfit</option>
          <option value="serif" ${appear.font === 'serif' ? 'selected' : ''}>Source Serif</option>
          <option value="merriweather" ${appear.font === 'merriweather' ? 'selected' : ''}>Merriweather</option>
          <option value="mono" ${appear.font === 'mono' ? 'selected' : ''}>JetBrains Mono</option>
          <option value="system" ${appear.font === 'system' ? 'selected' : ''}>System UI</option>
        </select>
      </div>
    `,
    actionText: 'Analyze Selected Page'
  });

  if (ui.renderRoot) {
    ui.renderRoot.style.maxHeight = '560px';
  }

  let fileBuffer = null;
  let selectedFile = null;
  /** @type {import('pdfjs-dist').PDFDocumentProxy | null} */
  let pdfDoc = null;
  let pageCount = 0;
  let selectedPage = 1;
  let lastMarkdown = '';

  const providerSelect = container.querySelector('#sum-provider');
  const providerHint = container.querySelector('#sum-provider-hint');
  const visionGroup = container.querySelector('#sum-vision-group');
  const visionCheck = container.querySelector('#sum-include-vision');
  const modeSelect = container.querySelector('#sum-mode');
  const themeSelect = container.querySelector('#sum-theme');
  const fontSelect = container.querySelector('#sum-font');
  const pageInput = container.querySelector('#sum-page-select');
  const pagePrev = container.querySelector('#sum-page-prev');
  const pageNext = container.querySelector('#sum-page-next');
  const pageHint = container.querySelector('#sum-page-hint');

  function resolveProvider() {
    const choice = providerSelect.value;
    if (choice === 'auto') return state.aiProvider || 'gemini';
    return choice;
  }

  function updateProviderHint() {
    const p = resolveProvider();
    const model = state.ollamaModel || 'huihui_ai/qwen3-vl-abliterated:8b';
    const visionCapable = isVisionModel(model);
    if (visionGroup) {
      visionGroup.style.display = p === 'ollama' ? 'block' : 'none';
    }
    if (p === 'ollama') {
      const uncensored =
        /abliterat|uncensor|heretic|dolphin|wizard.*uncensored/i.test(model);
      providerHint.innerHTML =
        `Using <strong>Ollama</strong> · <code>${model}</code> @ ${state.ollamaUrl}` +
        (uncensored ? ' · <span style="color:var(--color-orange)">abliterated</span>' : '') +
        (visionCapable
          ? ' · <span style="color:var(--color-green)">vision</span>'
          : ' · text-only');
      if (visionCheck) {
        visionCheck.checked = visionCapable;
        visionCheck.disabled = !visionCapable;
      }
    } else {
      providerHint.innerHTML = state.geminiKey
        ? 'Using <strong>Gemini 1.5 Flash</strong> on the selected page text.'
        : 'Gemini selected — add a key in <strong>Settings</strong> (or switch to Ollama).';
    }
  }

  function updatePageControls() {
    const hasDoc = pageCount > 0;
    if (pageInput) {
      pageInput.disabled = !hasDoc;
      pageInput.max = String(Math.max(1, pageCount));
      pageInput.value = String(selectedPage);
    }
    if (pagePrev) pagePrev.disabled = !hasDoc || selectedPage <= 1;
    if (pageNext) pageNext.disabled = !hasDoc || selectedPage >= pageCount;
    if (pageHint) {
      pageHint.innerHTML = hasDoc
        ? `Selected <strong>page ${selectedPage}</strong> of ${pageCount}. Only this page is sent to the model.`
        : 'Load a PDF, click a page thumbnail, then generate.';
    }
    ui.runBtn.disabled = !hasDoc;
  }

  function setSelectedPage(n, { scrollThumb = true } = {}) {
    if (!pageCount) return;
    const next = Math.min(pageCount, Math.max(1, Number(n) || 1));
    selectedPage = next;
    updatePageControls();

    const cards = ui.canvasContainer.querySelectorAll('.page-thumbnail-card[data-page]');
    cards.forEach((card) => {
      const p = Number(card.getAttribute('data-page'));
      card.classList.toggle('selected', p === selectedPage);
    });

    if (scrollThumb) {
      const active = ui.canvasContainer.querySelector(
        `.page-thumbnail-card[data-page="${selectedPage}"]`
      );
      if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  providerSelect.addEventListener('change', updateProviderHint);
  updateProviderHint();
  updatePageControls();

  pageInput?.addEventListener('change', () => setSelectedPage(pageInput.value));
  pagePrev?.addEventListener('click', () => setSelectedPage(selectedPage - 1));
  pageNext?.addEventListener('click', () => setSelectedPage(selectedPage + 1));

  const onAppearChange = () => {
    saveAppearance({
      mode: modeSelect.value,
      theme: themeSelect.value,
      font: fontSelect.value
    });
    if (lastMarkdown) showResultSummary(lastMarkdown);
  };
  modeSelect.addEventListener('change', onAppearChange);
  themeSelect.addEventListener('change', onAppearChange);
  fontSelect.addEventListener('change', onAppearChange);

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(file) {
    selectedFile = file;
    lastMarkdown = '';
    fileBuffer = null;
    pdfDoc = null;
    pageCount = 0;
    selectedPage = 1;

    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.previewTitle.innerText = file.name;
    ui.fileMeta.innerText = 'Loading PDF…';
    ui.runBtn.disabled = true;
    ui.canvasContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:0.75rem; width:100%; padding:2rem 0;">
        <div class="spinner"></div>
        <p style="font-size:0.9rem;">Rendering pages — click one to select…</p>
      </div>
    `;

    try {
      fileBuffer = await fileToArrayBuffer(file);
      pdfDoc = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      pageCount = pdfDoc.numPages;
      selectedPage = 1;

      ui.fileMeta.innerText = `Pages: ${pageCount} | Size: ${formatBytes(file.size)}`;
      await renderPagePicker();
      setSelectedPage(1, { scrollThumb: false });
    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF.';
      ui.canvasContainer.innerHTML = `<div class="result-success-container"><p class="text-danger">Could not open PDF: ${err.message || err}</p></div>`;
      updatePageControls();
    }
  }

  async function renderPagePicker() {
    if (!pdfDoc) return;

    ui.canvasContainer.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%; text-align:left;';

    const title = document.createElement('p');
    title.className = 'form-help';
    title.style.marginBottom = '0.75rem';
    title.innerHTML =
      'Click a page to select it. Only the highlighted page is sent to the AI (fast &amp; RAM-safe).';
    wrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'organizer-grid';
    grid.id = 'sum-page-grid';
    wrap.appendChild(grid);
    ui.canvasContainer.appendChild(wrap);

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfDoc.getPage(i);
      const canvas = await renderPDFPageToCanvas(page, 0.35, { alpha: false });
      canvas.className = 'page-thumbnail-canvas';

      const card = document.createElement('div');
      card.className = 'page-thumbnail-card';
      card.setAttribute('data-page', String(i));
      card.style.cursor = 'pointer';
      card.title = `Analyze page ${i}`;
      card.appendChild(canvas);

      const badge = document.createElement('span');
      badge.className = 'page-number-badge';
      badge.innerText = String(i);
      card.appendChild(badge);

      card.addEventListener('click', () => setSelectedPage(i, { scrollThumb: false }));
      grid.appendChild(card);

      // Free pdf.js page resources when possible
      try {
        page.cleanup?.();
      } catch {
        /* ignore */
      }

      if (i % 4 === 0) await yieldToUI();
    }
  }

  /** Restore picker after a result (same PDF). */
  async function showPagePickerAgain() {
    if (!pdfDoc) return;
    lastMarkdown = '';
    await renderPagePicker();
    setSelectedPage(selectedPage, { scrollThumb: true });
  }

  ui.runBtn.addEventListener('click', async () => {
    const detail = container.querySelector('#sum-length').value;
    const provider = resolveProvider();

    const canRun =
      (provider === 'gemini' && !!state.geminiKey) || provider === 'ollama';

    if (!canRun) {
      showMockSummary(detail);
      return;
    }

    if (!pdfDoc || !pageCount) {
      alert('Load a PDF first.');
      return;
    }

    const pageNo = Math.min(pageCount, Math.max(1, selectedPage));
    selectedPage = pageNo;

    const wantVision =
      provider === 'ollama' &&
      visionCheck?.checked &&
      isVisionModel(state.ollamaModel || '');

    ui.canvasContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:0.75rem; width:100%; padding:2rem 0;">
        <div class="spinner"></div>
        <p style="font-size:0.9rem;" id="sum-status">Preparing page ${pageNo}…</p>
      </div>
    `;
    ui.runBtn.disabled = true;
    const statusEl = () => container.querySelector('#sum-status');

    try {
      if (statusEl()) statusEl().innerText = `Extracting text from page ${pageNo}…`;
      let pageText = await extractPageText(pdfDoc, pageNo);
      if (!pageText) {
        pageText = '(No extractable text on this page — use vision or pick another page.)';
      }

      // Cap single page so huge text pages cannot OOM local models
      const textCap = provider === 'ollama' ? 6000 : 20000;
      if (pageText.length > textCap) {
        pageText =
          pageText.slice(0, textCap) +
          '\n\n[Page text truncated for model size limits.]';
      }

      let images;
      if (wantVision && fileBuffer) {
        if (statusEl()) statusEl().innerText = `Rendering page ${pageNo} image…`;
        images = await pdfPagesToBase64Images(fileBuffer, {
          maxPages: 1,
          startPage: pageNo,
          scale: 0.65,
          quality: 0.55
        });
      }

      if (statusEl()) {
        statusEl().innerText = `Analyzing page ${pageNo} via ${aiProviderLabel(provider)}…`;
      }

      const visionExtra = wantVision
        ? '\nYou may also receive a screenshot of this page — mention diagrams, tables, or layout if relevant.'
        : '';

      const prompt = `You are a professional reading assistant. Analyze ONLY the following single PDF page and provide a ${detail} summary in beautiful markdown.
Focus on key insights, facts, names/numbers, and action items on this page.${visionExtra}
Do not invent content from other pages.

PAGE ${pageNo} TEXT:
${pageText}`;

      const summaryMarkdown = await callAI(prompt, {
        provider,
        geminiKey: state.geminiKey,
        ollamaUrl: state.ollamaUrl,
        ollamaModel: state.ollamaModel,
        images: wantVision ? images : undefined,
        numCtx: provider === 'ollama' ? 4096 : undefined,
        numPredict: provider === 'ollama' ? 700 : undefined
      });

      const headed = `# Page ${pageNo} summary\n\n${summaryMarkdown}`;
      showResultSummary(headed);
    } catch (err) {
      console.error(err);
      const msg = err?.message || String(err);
      ui.canvasContainer.innerHTML = `
        <div class="result-success-container">
          <i class="bi bi-exclamation-triangle text-danger success-icon"></i>
          <p style="max-width:36rem; text-align:left;">${msg}</p>
          <button type="button" id="sum-back-picker" class="btn btn-secondary" style="margin-top:1rem;">
            <i class="bi bi-arrow-left"></i> Back to page picker
          </button>
        </div>
      `;
      ui.canvasContainer.querySelector('#sum-back-picker')?.addEventListener('click', () => {
        showPagePickerAgain();
      });
      ui.runBtn.disabled = false;
    }
  });

  function showMockSummary(detail) {
    const mockContent = `
# Page ${selectedPage || 1} summary (Simulated Preview)

> [!NOTE]
> **Demo Mode**: No Gemini key is set and Ollama is not selected. Open **Settings** to add a Gemini API key or enable local Ollama.

## Core Takeaways
- Single-page mode: only the page you select is sent to the model.
- Faster and safer for local Ollama RAM usage.
- Detail level selected: **${detail}**.
    `;
    showResultSummary(mockContent);
  }

  function showResultSummary(md) {
    lastMarkdown = md;
    const mode = modeSelect.value;
    const theme = themeSelect.value;
    const font = fontSelect.value;
    saveAppearance({ mode, theme, font });

    let html = md
      .replace(/^### (.*$)/gim, '<h4 class="sum-h4">$1</h4>')
      .replace(/^## (.*$)/gim, '<h3 class="sum-h3">$1</h3>')
      .replace(/^# (.*$)/gim, '<h2 class="sum-h2">$1</h2>')
      .replace(/^-\s(.*$)/gim, '<li class="sum-li">$1</li>')
      .replace(/^\s*\d+\.\s(.*$)/gim, '<li class="sum-li sum-li-num">$1</li>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(
        />\s*\[!(.*?)\]\s*\n>\s*(.*$)/gim,
        '<div class="sum-callout"><strong>$1</strong>: $2</div>'
      )
      .replace(/\n\n/g, '<br>');

    ui.canvasContainer.innerHTML = `
      <div class="summary-result sum-mode-${mode} sum-theme-${theme} sum-font-${font}">
        <div class="summary-result-body">
          ${html}
        </div>
        <div class="summary-result-actions">
          <button id="btn-copy-summary" class="btn btn-secondary"><i class="bi bi-copy"></i> Copy</button>
          <button id="btn-download-summary" class="btn btn-secondary"><i class="bi bi-download"></i> Download .md</button>
          <button id="btn-pick-another-page" class="btn btn-primary"><i class="bi bi-files"></i> Analyze another page</button>
        </div>
      </div>
    `;

    ui.canvasContainer.querySelector('#btn-copy-summary').addEventListener('click', () => {
      navigator.clipboard.writeText(md);
      alert('Summary copied to clipboard!');
    });
    ui.canvasContainer.querySelector('#btn-download-summary').addEventListener('click', () => {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download =
        (selectedFile?.name || 'document').replace(/\.pdf$/i, '') +
        `_page${selectedPage}_summary.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 200);
    });
    ui.canvasContainer.querySelector('#btn-pick-another-page').addEventListener('click', () => {
      showPagePickerAgain();
    });
    ui.runBtn.disabled = false;
    updatePageControls();
  }
}
