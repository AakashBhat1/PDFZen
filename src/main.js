import { setToolCleanup, runToolCleanup } from './lib/tool-lifecycle.js';

// Global App State
const state = {
  currentTool: null,
  theme: localStorage.getItem('theme') || 'dark',
  accent: localStorage.getItem('app_accent') || 'indigo',
  uiFont: localStorage.getItem('app_font') || 'inter',
  geminiKey: localStorage.getItem('gemini_api_key') || '',
  aiProvider: localStorage.getItem('ai_provider') || 'gemini',
  ollamaUrl: localStorage.getItem('ollama_url') || 'http://localhost:11434',
  ollamaModel: localStorage.getItem('ollama_model') || 'huihui_ai/qwen3-vl-abliterated:8b'
};

// Tool Initializers (Dynamically imported for maximum speed)
const toolInitializers = {
  'merge': () => import('./tools/merge.js').then(m => m.initMerge),
  'split': () => import('./tools/split.js').then(m => m.initSplit),
  'compress': () => import('./tools/compress.js').then(m => m.initCompress),
  'organize': () => import('./tools/organize/organize.js').then(m => m.initOrganize),
  'rotate': () => import('./tools/organize/rotate.js').then(m => m.initRotate),
  'crop': () => import('./tools/organize/crop.js').then(m => m.initCrop),
  'pagenumbers': () => import('./tools/organize/page-numbers.js').then(m => m.initPageNumbers),
  'watermark': () => import('./tools/organize/watermark.js').then(m => m.initWatermark),
  'pdf-to-word': () => import('./tools/convert/pdf-to-word.js').then(m => m.initPdfToWord),
  'word-to-pdf': () => import('./tools/convert/word-to-pdf.js').then(m => m.initWordToPdf),
  'pdf-to-powerpoint': () => import('./tools/convert/pdf-to-powerpoint.js').then(m => m.initPdfToPowerpoint),
  'powerpoint-to-pdf': () => import('./tools/convert/powerpoint-to-pdf.js').then(m => m.initPowerpointToPdf),
  'pdf-to-excel': () => import('./tools/convert/pdf-to-excel.js').then(m => m.initPdfToExcel),
  'excel-to-pdf': () => import('./tools/convert/excel-to-pdf.js').then(m => m.initExcelToPdf),
  'pdf-to-jpg': () => import('./tools/convert/pdf-to-jpg.js').then(m => m.initPdfToJpg),
  'jpg-to-pdf': () => import('./tools/convert/jpg-to-pdf.js').then(m => m.initJpgToPdf),
  'pdf-to-markdown': () => import('./tools/convert/pdf-to-markdown.js').then(m => m.initPdfToMarkdown),
  'html-to-pdf': () => import('./tools/convert/html-to-pdf.js').then(m => m.initHtmlToPdf),
  'edit-pdf': () => import('./tools/edit/edit-pdf.js').then(m => m.initEditPdf),
  'sign': () => import('./tools/edit/sign.js').then(m => m.initSign),
  'unlock': () => import('./tools/security/unlock.js').then(m => m.initUnlock),
  'protect': () => import('./tools/security/protect.js').then(m => m.initProtect),
  'redact': () => import('./tools/security/redact.js').then(m => m.initRedact),
  'repair': () => import('./tools/security/repair.js').then(m => m.initRepair),
  'pdf-a': () => import('./tools/security/pdf-a.js').then(m => m.initPdfA),
  'ai-summarizer': () => import('./tools/ai/summarizer.js').then(m => m.initSummarizer),
  'translate': () => import('./tools/ai/translate.js').then(m => m.initTranslate),
  'ocr': () => import('./tools/ai/ocr.js').then(m => m.initOcr),
  'compare': () => import('./tools/ai/compare.js').then(m => m.initCompare),
  'forms': () => import('./tools/ai/forms.js').then(m => m.initForms),
  'scan': () => import('./tools/ai/scan.js').then(m => m.initScan),
};

// Document elements
const dom = {
  body: document.body,
  homeBtn: document.getElementById('btn-home'),
  searchBar: document.getElementById('tool-search'),
  apiSettingsBtn: document.getElementById('btn-api-settings'),
  themeToggleBtn: document.getElementById('theme-toggle'),
  dashboardView: document.getElementById('dashboard-view'),
  workspaceView: document.getElementById('workspace-view'),
  workspaceTitle: document.getElementById('workspace-title'),
  workspaceContainer: document.getElementById('workspace-container'),
  backBtn: document.getElementById('btn-back-dashboard'),
  categoriesNav: document.querySelector('.categories-nav'),
  toolCards: document.querySelectorAll('.tool-card'),
  toolsSections: document.querySelectorAll('.tools-section'),
  
  // Settings Modal
  settingsModal: document.getElementById('modal-settings'),
  settingsCloseBtn: document.getElementById('settings-close'),
  keyInput: document.getElementById('gemini-key-input'),
  toggleKeyVisibilityBtn: document.getElementById('btn-toggle-key-visibility'),
  clearKeyBtn: document.getElementById('btn-clear-settings'),
  saveKeyBtn: document.getElementById('btn-save-settings'),
  aiProviderSelect: document.getElementById('ai-provider-select'),
  geminiBlock: document.getElementById('settings-gemini-block'),
  ollamaBlock: document.getElementById('settings-ollama-block'),
  ollamaUrlInput: document.getElementById('ollama-url-input'),
  ollamaModelInput: document.getElementById('ollama-model-input'),
  appModeSelect: document.getElementById('app-mode-select'),
  appAccentSelect: document.getElementById('app-accent-select'),
  appFontSelect: document.getElementById('app-font-select'),
  logFileSelect: document.getElementById('log-file-select'),
  logView: document.getElementById('service-log-view'),
  logMeta: document.getElementById('service-log-meta'),
  refreshLogsBtn: document.getElementById('btn-refresh-logs'),
  openLogsFolderBtn: document.getElementById('btn-open-logs-folder')
};

const BACKEND_BASE = 'http://127.0.0.1:5000';

// Initialize Application
function init() {
  setupEventListeners();
  applyTheme(state.theme);
  applyAccent(state.accent);
  applyUiFont(state.uiFont);
  indexSearch();
  // Deep-link: start.bat opens /?tool=ai-summarizer
  openToolFromUrl();
}

/** Open a tool from ?tool=id or #tool=id (used by launcher). */
function openToolFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    let toolId = params.get('tool');
    if (!toolId && window.location.hash.startsWith('#tool=')) {
      toolId = decodeURIComponent(window.location.hash.slice('#tool='.length));
    }
    if (!toolId || !toolInitializers[toolId]) return;

    // Prefer title from the dashboard card
    const card = document.querySelector(`.tool-card[data-tool="${toolId}"]`);
    const title = card?.querySelector('h3')?.textContent || toolId;
    // Slight delay so DOM/listeners are ready
    setTimeout(() => {
      selectTool(toolId, title);
      // Clean URL without reloading
      const url = new URL(window.location.href);
      url.searchParams.delete('tool');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash.replace(/#tool=.*/, ''));
    }, 50);
  } catch (err) {
    console.warn('Deep-link tool open failed:', err);
  }
}

// 1. Search Indexing and Instant Filter (pre-indexed text + debounced filter)
function indexSearch() {
  const cards = Array.from(dom.toolCards).map((card) => ({
    el: card,
    section: card.closest('.tools-section'),
    haystack: [
      card.querySelector('h3')?.textContent || '',
      card.querySelector('p')?.textContent || '',
      card.dataset.tags || ''
    ].join(' ').toLowerCase()
  }));

  const allCatBtn = document.querySelector('.cat-btn[data-category="all"]');
  const catButtons = document.querySelectorAll('.cat-btn');
  let searchTimer = null;

  const applySearch = (rawQuery) => {
    const query = rawQuery.toLowerCase().trim();

    if (query !== '') {
      catButtons.forEach((b) => b.classList.remove('active'));
      allCatBtn?.classList.add('active');
    }

    const visibleSections = new Set();
    for (const item of cards) {
      const isMatch = !query || item.haystack.includes(query);
      item.el.style.display = isMatch ? 'flex' : 'none';
      if (isMatch && item.section) visibleSections.add(item.section);
    }

    dom.toolsSections.forEach((section) => {
      section.style.display = visibleSections.has(section) ? 'block' : 'none';
    });
  };

  dom.searchBar.addEventListener('input', (e) => {
    const value = e.target.value;
    if (searchTimer) clearTimeout(searchTimer);
    // Instant clear when emptied; slight debounce while typing
    if (!value.trim()) {
      applySearch('');
      return;
    }
    searchTimer = setTimeout(() => applySearch(value), 80);
  });
}

// 2. Category Navigation Tabs
function filterCategory(category) {
  dom.searchBar.value = ''; // Reset search query
  
  dom.toolCards.forEach(card => {
    const cardCat = card.dataset.category;
    if (category === 'all' || cardCat === category) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
  
  // Manage Section Headers Visibility
  dom.toolsSections.forEach(section => {
    const sectionCat = section.dataset.section;
    if (category === 'all' || sectionCat === category) {
      section.style.display = 'block';
      // Make sure cards inside are correctly displayed
      section.querySelectorAll('.tool-card').forEach(card => {
        card.style.display = 'flex';
      });
    } else {
      section.style.display = 'none';
    }
  });
}

// 3. Theme / appearance
function applyTheme(theme) {
  state.theme = theme;
  const isLight = theme === 'light';
  dom.body.classList.toggle('light-theme', isLight);
  dom.body.classList.toggle('dark-theme', !isLight);
  dom.themeToggleBtn.innerHTML = isLight
    ? '<i class="bi bi-sun"></i>'
    : '<i class="bi bi-moon-stars"></i>';
}

function applyAccent(accent) {
  state.accent = accent || 'indigo';
  dom.body.dataset.accent = state.accent;
}

function applyUiFont(fontKey) {
  state.uiFont = fontKey || 'inter';
  dom.body.dataset.font = state.uiFont;
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  localStorage.setItem('theme', state.theme);
  if (dom.appModeSelect) dom.appModeSelect.value = state.theme;
}

function syncProviderBlocks() {
  const provider = dom.aiProviderSelect?.value || 'gemini';
  if (dom.geminiBlock) dom.geminiBlock.style.display = provider === 'gemini' ? 'block' : 'none';
  if (dom.ollamaBlock) dom.ollamaBlock.style.display = provider === 'ollama' ? 'block' : 'none';
}

// 4. Modal Events
function showSettingsModal() {
  if (dom.keyInput) dom.keyInput.value = state.geminiKey;
  if (dom.aiProviderSelect) dom.aiProviderSelect.value = state.aiProvider;
  if (dom.ollamaUrlInput) dom.ollamaUrlInput.value = state.ollamaUrl;
  if (dom.ollamaModelInput) dom.ollamaModelInput.value = state.ollamaModel;
  if (dom.appModeSelect) dom.appModeSelect.value = state.theme;
  if (dom.appAccentSelect) dom.appAccentSelect.value = state.accent;
  if (dom.appFontSelect) dom.appFontSelect.value = state.uiFont;
  syncProviderBlocks();
  dom.settingsModal.classList.add('active');
  // Load logs when opening settings (non-blocking)
  refreshServiceLogs().catch(() => {});
}

function hideSettingsModal() {
  dom.settingsModal.classList.remove('active');
}

/** Load service log tail from backend, or in-browser AI call log. */
async function refreshServiceLogs() {
  const which = dom.logFileSelect?.value || 'ollama';
  if (!dom.logView) return;

  if (which === 'client-ai') {
    try {
      const { getAiClientLog } = await import('./tools/ai/shared.js');
      const entries = getAiClientLog();
      if (!entries.length) {
        dom.logView.textContent =
          '(no AI calls in this browser session yet)\nRun AI Page Analyzer once, then Refresh.';
      } else {
        dom.logView.textContent = entries
          .map((e) => {
            const head = `[${e.t}] ${e.level || 'info'} ${e.source || ''} ${e.model || ''}`.trim();
            const extra = [
              e.message,
              e.promptChars != null ? `promptChars=${e.promptChars}` : '',
              e.images != null ? `images=${e.images}` : '',
              e.numCtx != null ? `num_ctx=${e.numCtx}` : '',
              e.think != null ? `think=${e.think}` : ''
            ]
              .filter(Boolean)
              .join(' · ');
            return `${head}\n  ${extra}`;
          })
          .join('\n\n');
      }
      if (dom.logMeta) {
        dom.logMeta.textContent = `${entries.length} recent AI call(s) in this tab only`;
      }
    } catch (err) {
      dom.logView.textContent = `Could not load client AI log: ${err.message || err}`;
    }
    return;
  }

  dom.logView.textContent = 'Loading…';
  try {
    const res = await fetch(`${BACKEND_BASE}/api/logs/${encodeURIComponent(which)}?tail=300`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    dom.logView.textContent = data.content || '(empty)';
    if (dom.logMeta) {
      const size = data.size != null ? `${Math.round(data.size / 1024)} KB` : '';
      dom.logMeta.textContent = data.exists
        ? `${data.name || which}${size ? ` · ${size}` : ''} · folder: ${data.dir || ''}`
        : `${data.name || which} not found yet · start with start.bat · ${data.dir || ''}`;
    }
  } catch (err) {
    dom.logView.textContent =
      `Backend not reachable at ${BACKEND_BASE}.\n` +
      `Start the app with start.bat, then Refresh.\n` +
      `Logs also live on disk under the project logs\\ folder.\n` +
      `(${err.message || err})`;
    if (dom.logMeta) dom.logMeta.textContent = 'Backend offline — cannot stream service logs';
  }
}

// 5. Workspace Switcher (Route Controller)
async function selectTool(toolId, toolTitle) {
  // Leave previous tool (releases camera, etc.)
  runToolCleanup();
  state.currentTool = toolId;

  // Set UI state
  dom.dashboardView.classList.remove('active');
  dom.workspaceView.classList.add('active');
  dom.workspaceTitle.innerText = toolTitle;
  dom.workspaceContainer.innerHTML = `
    <div class="processing-container">
      <div class="spinner"></div>
      <p class="processing-text">Loading tool workspace...</p>
    </div>
  `;

  try {
    const initializer = toolInitializers[toolId];
    if (!initializer) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    // Resolve module and get initialization function
    const initFunction = await initializer();

    // Clear spinner and run tool initializer
    dom.workspaceContainer.innerHTML = '';
    initFunction(dom.workspaceContainer);
  } catch (error) {
    runToolCleanup();
    dom.workspaceContainer.innerHTML = `
      <div class="result-success-container">
        <i class="bi bi-exclamation-triangle-fill text-danger success-icon"></i>
        <div class="result-info">
          <h4 class="result-title">Error Loading Tool</h4>
          <p class="result-meta">${error.message}</p>
        </div>
        <button class="btn btn-secondary" onclick="location.reload()">Reload App</button>
      </div>
    `;
    console.error(error);
  }
}

function goHome() {
  runToolCleanup();
  state.currentTool = null;
  dom.workspaceView.classList.remove('active');
  dom.dashboardView.classList.add('active');
  dom.workspaceContainer.innerHTML = '';
}

// Event Listeners Setup
function setupEventListeners() {
  // Navigation
  dom.homeBtn.addEventListener('click', goHome);
  dom.backBtn.addEventListener('click', goHome);
  
  // Category tabs click
  dom.categoriesNav.addEventListener('click', (e) => {
    if (e.target.classList.contains('cat-btn')) {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      filterCategory(e.target.dataset.category);
    }
  });
  
  // Tool Cards click
  dom.toolCards.forEach(card => {
    card.addEventListener('click', () => {
      const toolId = card.dataset.tool;
      const title = card.querySelector('h3').textContent;
      selectTool(toolId, title);
    });
  });
  
  // Theme toggle
  dom.themeToggleBtn.addEventListener('click', toggleTheme);
  
  // Settings modal toggle
  dom.apiSettingsBtn.addEventListener('click', showSettingsModal);
  dom.settingsCloseBtn.addEventListener('click', hideSettingsModal);
  dom.settingsModal.addEventListener('click', (e) => {
    if (e.target === dom.settingsModal) hideSettingsModal();
  });

  dom.refreshLogsBtn?.addEventListener('click', () => {
    refreshServiceLogs().catch(() => {});
  });
  dom.logFileSelect?.addEventListener('change', () => {
    refreshServiceLogs().catch(() => {});
  });
  dom.openLogsFolderBtn?.addEventListener('click', async () => {
    try {
      const res = await fetch(`${BACKEND_BASE}/api/logs`);
      const data = await res.json();
      const path = data.dir || 'logs';
      await navigator.clipboard.writeText(path);
      if (dom.logMeta) dom.logMeta.textContent = `Copied folder path: ${path}`;
      else alert(`Logs folder: ${path}`);
    } catch {
      const fallback = 'C:\\dev\\multi-tool\\logs';
      try {
        await navigator.clipboard.writeText(fallback);
      } catch {
        /* ignore */
      }
      if (dom.logMeta) {
        dom.logMeta.textContent = `Backend offline. Try opening: ${fallback}`;
      }
    }
  });
  
  // Modal key visibility toggle
  dom.toggleKeyVisibilityBtn?.addEventListener('click', () => {
    const isPass = dom.keyInput.type === 'password';
    dom.keyInput.type = isPass ? 'text' : 'password';
    dom.toggleKeyVisibilityBtn.innerHTML = isPass ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
  });

  dom.aiProviderSelect?.addEventListener('change', syncProviderBlocks);

  // Live appearance previews in the modal
  dom.appModeSelect?.addEventListener('change', (e) => {
    applyTheme(e.target.value);
    localStorage.setItem('theme', state.theme);
  });
  dom.appAccentSelect?.addEventListener('change', (e) => {
    applyAccent(e.target.value);
    localStorage.setItem('app_accent', state.accent);
  });
  dom.appFontSelect?.addEventListener('change', (e) => {
    applyUiFont(e.target.value);
    localStorage.setItem('app_font', state.uiFont);
  });

  // Save Settings
  dom.saveKeyBtn.addEventListener('click', () => {
    state.geminiKey = (dom.keyInput?.value || '').trim();
    state.aiProvider = dom.aiProviderSelect?.value || 'gemini';
    state.ollamaUrl = (dom.ollamaUrlInput?.value || 'http://localhost:11434').trim().replace(/\/$/, '');
    state.ollamaModel = (dom.ollamaModelInput?.value || 'huihui_ai/qwen3-vl-abliterated:8b').trim() || 'huihui_ai/qwen3-vl-abliterated:8b';
    state.theme = dom.appModeSelect?.value || state.theme;
    state.accent = dom.appAccentSelect?.value || state.accent;
    state.uiFont = dom.appFontSelect?.value || state.uiFont;

    localStorage.setItem('gemini_api_key', state.geminiKey);
    localStorage.setItem('ai_provider', state.aiProvider);
    localStorage.setItem('ollama_url', state.ollamaUrl);
    localStorage.setItem('ollama_model', state.ollamaModel);
    localStorage.setItem('theme', state.theme);
    localStorage.setItem('app_accent', state.accent);
    localStorage.setItem('app_font', state.uiFont);

    applyTheme(state.theme);
    applyAccent(state.accent);
    applyUiFont(state.uiFont);
    hideSettingsModal();
  });

  // Clear AI credentials only
  dom.clearKeyBtn.addEventListener('click', () => {
    state.geminiKey = '';
    state.aiProvider = 'gemini';
    state.ollamaUrl = 'http://localhost:11434';
    state.ollamaModel = 'huihui_ai/qwen3-vl-abliterated:8b';
    if (dom.keyInput) dom.keyInput.value = '';
    if (dom.aiProviderSelect) dom.aiProviderSelect.value = 'gemini';
    if (dom.ollamaUrlInput) dom.ollamaUrlInput.value = state.ollamaUrl;
    if (dom.ollamaModelInput) dom.ollamaModelInput.value = state.ollamaModel;
    localStorage.removeItem('gemini_api_key');
    localStorage.setItem('ai_provider', 'gemini');
    localStorage.setItem('ollama_url', state.ollamaUrl);
    localStorage.setItem('ollama_model', state.ollamaModel);
    syncProviderBlocks();
  });
}

// Start
document.addEventListener('DOMContentLoaded', init);

// Always release camera hardware when the page is unloading / frozen
window.addEventListener('pagehide', runToolCleanup);
window.addEventListener('beforeunload', runToolCleanup);
window.addEventListener('freeze', runToolCleanup);
export { state, setToolCleanup };
