// Global App State
const state = {
  currentTool: null,
  theme: 'dark',
  geminiKey: localStorage.getItem('gemini_api_key') || ''
};

// Tool Initializers (Dynamically imported for maximum speed)
const toolInitializers = {
  'merge': () => import('./tools/merge.js').then(m => m.initMerge),
  'split': () => import('./tools/split.js').then(m => m.initSplit),
  'compress': () => import('./tools/compress.js').then(m => m.initCompress),
  'organize': () => import('./tools/organize.js').then(m => m.initOrganize),
  'rotate': () => import('./tools/organize.js').then(m => m.initRotate),
  'crop': () => import('./tools/organize.js').then(m => m.initCrop),
  'pagenumbers': () => import('./tools/organize.js').then(m => m.initPageNumbers),
  'watermark': () => import('./tools/organize.js').then(m => m.initWatermark),
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
  'edit-pdf': () => import('./tools/edit.js').then(m => m.initEditPdf),
  'sign': () => import('./tools/edit.js').then(m => m.initSign),
  'unlock': () => import('./tools/security.js').then(m => m.initUnlock),
  'protect': () => import('./tools/security.js').then(m => m.initProtect),
  'redact': () => import('./tools/security.js').then(m => m.initRedact),
  'repair': () => import('./tools/security.js').then(m => m.initRepair),
  'pdf-a': () => import('./tools/security.js').then(m => m.initPdfA),
  'ai-summarizer': () => import('./tools/ai.js').then(m => m.initSummarizer),
  'translate': () => import('./tools/ai.js').then(m => m.initTranslate),
  'ocr': () => import('./tools/ai.js').then(m => m.initOcr),
  'compare': () => import('./tools/ai.js').then(m => m.initCompare),
  'forms': () => import('./tools/ai.js').then(m => m.initForms),
  'scan': () => import('./tools/ai.js').then(m => m.initScan),
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
  saveKeyBtn: document.getElementById('btn-save-settings')
};

// Initialize Application
function init() {
  setupEventListeners();
  loadSavedTheme();
  indexSearch();
}

// 1. Search Indexing and Instant Filter
function indexSearch() {
  const cards = dom.toolCards;
  
  dom.searchBar.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    
    // Reset category tabs to "All" when searching
    if (query !== '') {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.cat-btn[data-category="all"]').classList.add('active');
    }
    
    cards.forEach(card => {
      const title = card.querySelector('h3').textContent.toLowerCase();
      const desc = card.querySelector('p').textContent.toLowerCase();
      const tags = card.dataset.tags || '';
      
      const isMatch = title.includes(query) || desc.includes(query) || tags.includes(query);
      card.style.display = isMatch ? 'flex' : 'none';
    });
    
    // Hide empty sections
    dom.toolsSections.forEach(section => {
      const sectionCards = section.querySelectorAll('.tool-card');
      const visibleCount = Array.from(sectionCards).filter(c => c.style.display !== 'none').length;
      section.style.display = visibleCount > 0 ? 'block' : 'none';
    });
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

// 3. Theme Management
function loadSavedTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  state.theme = savedTheme;
  if (savedTheme === 'light') {
    dom.body.classList.remove('dark-theme');
    dom.body.classList.add('light-theme');
    dom.themeToggleBtn.innerHTML = '<i class="bi bi-sun"></i>';
  } else {
    dom.body.classList.remove('light-theme');
    dom.body.classList.add('dark-theme');
    dom.themeToggleBtn.innerHTML = '<i class="bi bi-moon-stars"></i>';
  }
}

function toggleTheme() {
  if (state.theme === 'dark') {
    state.theme = 'light';
    dom.body.classList.remove('dark-theme');
    dom.body.classList.add('light-theme');
    dom.themeToggleBtn.innerHTML = '<i class="bi bi-sun"></i>';
  } else {
    state.theme = 'dark';
    dom.body.classList.remove('light-theme');
    dom.body.classList.add('dark-theme');
    dom.themeToggleBtn.innerHTML = '<i class="bi bi-moon-stars"></i>';
  }
  localStorage.setItem('theme', state.theme);
}

// 4. Modal Events
function showSettingsModal() {
  dom.keyInput.value = state.geminiKey;
  dom.settingsModal.classList.add('active');
}

function hideSettingsModal() {
  dom.settingsModal.classList.remove('active');
}

// 5. Workspace Switcher (Route Controller)
async function selectTool(toolId, toolTitle) {
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
  
  // Modal key visibility toggle
  dom.toggleKeyVisibilityBtn.addEventListener('click', () => {
    const isPass = dom.keyInput.type === 'password';
    dom.keyInput.type = isPass ? 'text' : 'password';
    dom.toggleKeyVisibilityBtn.innerHTML = isPass ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
  });
  
  // Save Settings
  dom.saveKeyBtn.addEventListener('click', () => {
    const key = dom.keyInput.value.trim();
    state.geminiKey = key;
    localStorage.setItem('gemini_api_key', key);
    hideSettingsModal();
  });
  
  // Clear Settings
  dom.clearKeyBtn.addEventListener('click', () => {
    state.geminiKey = '';
    dom.keyInput.value = '';
    localStorage.removeItem('gemini_api_key');
    hideSettingsModal();
  });
}

// Start
document.addEventListener('DOMContentLoaded', init);
export { state };
