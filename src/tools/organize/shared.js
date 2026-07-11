import logoUrl from '../../assets/logo.png';

// --- Shared PDF Input UI helper for organize-family tools ---
export function createOrganizeUI(container, title, subtitle, icon) {
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div id="org-dropzone" class="dropzone">
        <i class="bi ${icon} dropzone-icon"></i>
        <h4>${title}</h4>
        <p>${subtitle}</p>
        <input type="file" id="org-file-input" class="file-input-hidden" accept="application/pdf">
        <button id="btn-load-test-pdf" type="button" class="btn btn-secondary" style="margin-top: 1rem; pointer-events: auto;">
          <i class="bi bi-file-earmark-pdf"></i> Load Test PDF
        </button>
      </div>
      
      <div id="org-preview-container" style="display: none; margin-top: 1.5rem; width: 100%;">
        <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h4 style="font-family: var(--font-title);" id="org-preview-title">PDF Preview</h4>
          <span id="org-file-meta" class="form-help"></span>
        </div>
        <div id="org-pages-grid" class="organizer-grid"></div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Settings</h3>
      <div id="org-settings-fields"></div>
      <button id="btn-run-org" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi bi-check-circle"></i> Apply Changes
      </button>
    </div>
  `;

  const dropzone = container.querySelector('#org-dropzone');
  const fileInput = container.querySelector('#org-file-input');
  const btnLoadTestPdf = container.querySelector('#btn-load-test-pdf');

  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('#btn-load-test-pdf')) return;
    fileInput.click();
  });

  btnLoadTestPdf.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      btnLoadTestPdf.innerText = 'Loading...';
      btnLoadTestPdf.disabled = true;
      const res = await fetch('/samples/Visit report 030726 Yk-54.pdf');
      if (!res.ok) throw new Error('Failed to fetch sample PDF');
      const blob = await res.blob();
      const file = new File([blob], 'Visit report 030726 Yk-54.pdf', { type: 'application/pdf' });
      
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {
      console.error(err);
      alert('Error loading test PDF: ' + err.message);
      btnLoadTestPdf.innerText = 'Load Test PDF';
      btnLoadTestPdf.disabled = false;
    }
  });

  return {
    dropzone: dropzone,
    fileInput: fileInput,
    previewContainer: container.querySelector('#org-preview-container'),
    pagesGrid: container.querySelector('#org-pages-grid'),
    fileMeta: container.querySelector('#org-file-meta'),
    settingsFields: container.querySelector('#org-settings-fields'),
    runBtn: container.querySelector('#btn-run-org'),
    previewTitle: container.querySelector('#org-preview-title')
  };
}

/** Cached ETSPL logo bytes (loaded once from PNG asset). */
let _etsplLogoBufferPromise = null;
export function loadEtsplLogoBuffer() {
  if (!_etsplLogoBufferPromise) {
    _etsplLogoBufferPromise = fetch(logoUrl).then(async (res) => {
      if (!res.ok) throw new Error('Failed to load ETSPL logo asset');
      return res.arrayBuffer();
    });
  }
  return _etsplLogoBufferPromise;
}
