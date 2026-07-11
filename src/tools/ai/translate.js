import {
  downloadBlob,
  fileToArrayBuffer
} from '../../lib/utils.js';
import { state } from '../../main.js';
import { callGemini, createAIUI, getPDFRawText } from './shared.js';

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
