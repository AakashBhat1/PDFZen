import { fileToArrayBuffer, downloadBlob, renderPDFPageToCanvas } from '../../utils.js';
import { pdfjsLib } from '../../pdfjs-setup.js';

export { pdfjsLib, fileToArrayBuffer, downloadBlob, renderPDFPageToCanvas };

// --- Shared File Input & UI Builder Helper ---
export function createConvertUI(container, options) {
  const fileAccepts = {
    pdf: 'application/pdf',
    word: '.docx',
    excel: '.xlsx,.xls',
    powerpoint: '.pptx,.ppt',
    image: 'image/jpeg,image/png',
    html: 'text/html'
  };

  container.innerHTML = `
    <div class="workspace-main-panel">
      <!-- Input Mode -->
      <div id="convert-dropzone" class="dropzone">
        <i class="bi ${options.icon} dropzone-icon"></i>
        <h4>${options.title}</h4>
        <p>${options.subtitle}</p>
        <input type="file" id="convert-file-input" class="file-input-hidden" accept="${fileAccepts[options.inputType]}" ${options.multiple ? 'multiple' : ''}>
      </div>

      <!-- File info/preview (optional) -->
      <div id="convert-preview" style="display: none; text-align: center; padding: 2rem;">
        <i class="bi ${options.fileIcon}" style="font-size: 4rem; color: var(--color-blue);"></i>
        <h4 id="convert-file-name" style="margin-top: 1rem; font-family: var(--font-title);"></h4>
        <p id="convert-file-meta" style="color: var(--text-muted); font-size: 0.9rem;"></p>
        
        <!-- Image Preview Grid (Only for JPG to PDF) -->
        <div id="image-preview-grid" class="organizer-grid" style="display:none; margin-top: 1.5rem; text-align: left;"></div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Settings</h3>
      <div id="convert-settings-fields">
        ${options.settingsHTML || '<p class="form-help">No additional settings required for this tool.</p>'}
      </div>
      <button id="btn-run-convert" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi bi-arrow-right-circle"></i> Convert Document
      </button>
    </div>
  `;

  return {
    dropzone: container.querySelector('#convert-dropzone'),
    fileInput: container.querySelector('#convert-file-input'),
    preview: container.querySelector('#convert-preview'),
    fileName: container.querySelector('#convert-file-name'),
    fileMeta: container.querySelector('#convert-file-meta'),
    runBtn: container.querySelector('#btn-run-convert'),
    settingsFields: container.querySelector('#convert-settings-fields'),
    imgGrid: container.querySelector('#image-preview-grid')
  };
}

// --- Showing Success Panel Helper ---
export function showSuccessView(container, options) {
  container.innerHTML = `
    <div class="workspace-main-panel" style="grid-column: span 2;">
      <div class="result-success-container">
        <i class="bi ${options.icon || 'bi-check-circle-fill'} success-icon text-success"></i>
        <div class="result-info">
          <h3 class="result-title">${options.title}</h3>
          <p class="result-meta">${options.meta}</p>
        </div>
        <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
          ${options.downloadBtn !== false ? `
          <button id="btn-download-result" class="btn btn-primary">
            <i class="bi bi-download"></i> Download File
          </button>` : ''}
          <button id="btn-convert-again" class="btn btn-secondary">
            <i class="bi bi-arrow-left"></i> Convert Another
          </button>
        </div>
      </div>
    </div>
  `;

  if (options.downloadBtn !== false && options.onDownload) {
    container.querySelector('#btn-download-result').addEventListener('click', options.onDownload);
  }
  container.querySelector('#btn-convert-again').addEventListener('click', options.onReload);
}

// --- Object URL Manager for Memory Leak Prevention ---
class ObjectUrlManager {
  constructor() {
    this.urls = new Set();
  }

  create(blobOrFile) {
    const url = URL.createObjectURL(blobOrFile);
    this.urls.add(url);
    return url;
  }

  revoke(url) {
    if (this.urls.has(url)) {
      URL.revokeObjectURL(url);
      this.urls.delete(url);
    }
  }

  revokeAll() {
    this.urls.forEach(url => {
      URL.revokeObjectURL(url);
    });
    this.urls.clear();
  }
}

export const objectUrlManager = new ObjectUrlManager();


// --- Showing Progress Panel Helper ---
export function showProgressView(container, text) {
  container.innerHTML = `
    <div class="workspace-main-panel" style="grid-column: span 2;">
      <div class="processing-container">
        <div class="spinner"></div>
        <p class="processing-text" id="convert-progress-text">${text}</p>
        <div class="progress-bar-wrapper">
          <div class="progress-bar-fill" id="convert-progress-bar" style="width: 10%;"></div>
        </div>
      </div>
    </div>
  `;
  return {
    progressBar: container.querySelector('#convert-progress-bar'),
    progressText: container.querySelector('#convert-progress-text')
  };
}

// --- Local Python Backend Integration (high-fidelity conversion) ---

// Base URL of the optional local FastAPI conversion backend (see server.py).
export const BACKEND_URL = 'http://localhost:5000';

/**
 * Settings-panel HTML for the "Local Server Status" pill. Each converter that
 * can use the backend embeds this and then wires it with `bindBackendStatus`.
 * @param {string} [helpText]
 * @returns {string}
 */
export function backendStatusFieldHTML(helpText = 'Start the local Python server with <code>start.bat</code> (or <code>uv run server.py</code>) for high-fidelity conversion.') {
  return `
    <div class="form-group" style="margin-top: 1rem; border-top: 1px solid #3f3f46; padding-top: 1rem;">
      <label>Local Server Status</label>
      <div id="backend-status" style="display: flex; align-items: center; gap: 0.5rem; font-weight: 500; font-size: 0.9rem; margin-top: 0.2rem; color: #ffc107;">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #ffc107; transition: background-color 0.3s;"></span>
        Checking connection...
      </div>
      <span class="form-help" style="margin-top: 0.4rem; display: block;">${helpText}</span>
    </div>
  `;
}

/**
 * Probe the backend's /health endpoint.
 * @returns {Promise<{ ok: boolean, libreoffice: boolean }>}
 */
export async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return { ok: false, libreoffice: false };
    const data = await res.json();
    return { ok: data.status === 'ok', libreoffice: !!data.libreoffice };
  } catch {
    return { ok: false, libreoffice: false };
  }
}

/**
 * Paint a `#backend-status` element based on a backend state.
 * @param {HTMLElement | null} el
 * @param {{ ok: boolean }} state
 */
export function updateBackendStatusEl(el, state) {
  if (!el) return;
  const dot = (color) => `<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${color}; margin-right: 0.5rem;"></span>`;
  if (state.ok) {
    el.innerHTML = `${dot('#28a745')}Connected (High-Quality)`;
    el.style.color = '#28a745';
  } else {
    el.innerHTML = `${dot('#dc3545')}Offline (Using browser engine)`;
    el.style.color = '#e0a800';
  }
}

/**
 * Convenience: probe the backend and update the `#backend-status` element inside
 * `container`, returning the state.
 * @param {HTMLElement} container
 * @returns {Promise<{ ok: boolean, libreoffice: boolean }>}
 */
export async function refreshBackendStatus(container) {
  const state = await checkBackend();
  updateBackendStatusEl(container.querySelector('#backend-status'), state);
  return state;
}

/**
 * Generic upload -> POST -> download flow against the local backend. Renders the
 * progress, success, and error panels for the caller.
 * @param {HTMLElement} container
 * @param {File} file
 * @param {{
 *   endpoint: string, outName: string, mime: string,
 *   title: string, meta: string, icon: string, onReload: () => void,
 *   progressText?: string, fields?: Record<string, string>
 * }} opts
 * @returns {Promise<boolean>} true on success
 */
export async function convertViaBackend(container, file, opts) {
  const progress = showProgressView(container, 'Uploading to local Python backend...');
  progress.progressBar.style.width = '20%';

  try {
    const formData = new FormData();
    formData.append('file', file);
    for (const [key, value] of Object.entries(opts.fields || {})) {
      formData.append(key, value);
    }

    progress.progressText.innerText = opts.progressText || 'Converting via local Python engine...';
    progress.progressBar.style.width = '60%';

    const response = await fetch(`${BACKEND_URL}${opts.endpoint}`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ detail: 'Unknown backend error' }));
      throw new Error(errData.detail || 'Backend conversion failed');
    }

    progress.progressText.innerText = 'Downloading converted file...';
    progress.progressBar.style.width = '90%';

    const blob = await response.blob();
    progress.progressBar.style.width = '100%';

    showSuccessView(container, {
      title: opts.title,
      meta: opts.meta,
      icon: opts.icon,
      onDownload: () => downloadBlob(blob, opts.outName, opts.mime),
      onReload: opts.onReload
    });
    return true;
  } catch (err) {
    console.error(err);
    showErrorView(container, `Backend Error: ${err.message}`, opts.onReload);
    return false;
  }
}

// --- Showing Error Panel Helper ---
export function showErrorView(container, msg, onReload) {
  container.innerHTML = `
    <div class="workspace-main-panel" style="grid-column: span 2;">
      <div class="result-success-container">
        <i class="bi bi-exclamation-triangle-fill text-danger success-icon"></i>
        <div class="result-info">
          <h3 class="result-title">Conversion Failed</h3>
          <p class="result-meta">${msg}</p>
        </div>
        <button id="btn-convert-retry" class="btn btn-secondary" style="margin-top: 1rem;">
          <i class="bi bi-arrow-left"></i> Try Again
        </button>
      </div>
    </div>
  `;
  container.querySelector('#btn-convert-retry').addEventListener('click', onReload);
}
