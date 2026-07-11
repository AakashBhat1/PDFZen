/**
 * Shared dropzone + settings shell for security-family tools.
 */
export function createSecurityUI(container, title, subtitle, icon, isPasswordMode = false) {
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div id="sec-dropzone" class="dropzone">
        <i class="bi ${icon} dropzone-icon"></i>
        <h4>${title}</h4>
        <p>${subtitle}</p>
        <input type="file" id="sec-file-input" class="file-input-hidden" accept="application/pdf">
      </div>

      <div id="sec-preview" style="display: none; text-align: center; padding: 2rem;">
        <i class="bi bi-file-earmark-pdf text-danger" style="font-size: 4rem;"></i>
        <h4 id="sec-file-name" style="margin-top: 1rem; font-family: var(--font-title);"></h4>
        <p id="sec-file-meta" style="color: var(--text-muted); font-size: 0.9rem;"></p>
        
        <!-- Redaction canvas viewport -->
        <div id="redact-editor-root" class="editor-workspace" style="display:none; margin-top:1.5rem;"></div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Security Options</h3>
      <div id="sec-settings-fields">
        ${isPasswordMode ? `
          <div class="form-group">
            <label for="sec-password-input">Document Password</label>
            <input type="password" id="sec-password-input" class="form-control" placeholder="Enter password...">
          </div>
        ` : '<p class="form-help">No additional configuration required.</p>'}
      </div>
      <button id="btn-run-sec" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi bi-shield-check"></i> Apply Operation
      </button>
    </div>
  `;

  return {
    dropzone: container.querySelector('#sec-dropzone'),
    fileInput: container.querySelector('#sec-file-input'),
    preview: container.querySelector('#sec-preview'),
    fileName: container.querySelector('#sec-file-name'),
    fileMeta: container.querySelector('#sec-file-meta'),
    settingsFields: container.querySelector('#sec-settings-fields'),
    runBtn: container.querySelector('#btn-run-sec'),
    redactRoot: container.querySelector('#redact-editor-root'),
    passwordInput: container.querySelector('#sec-password-input')
  };
}
