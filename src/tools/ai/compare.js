import {
  fileToArrayBuffer
} from '../../lib/utils.js';
import { createAIUI, getPDFRawText } from './shared.js';

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
