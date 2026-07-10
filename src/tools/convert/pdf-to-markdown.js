import { createConvertUI, showSuccessView, showProgressView, showErrorView, extractPDFText, fileToArrayBuffer, downloadBlob } from './convert-shared.js';

// ==========================================
// PDF TO MARKDOWN
// ==========================================
export function initPdfToMarkdown(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF file here',
    subtitle: 'Parse PDF structure and extract styled Markdown text (.md)',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-md',
    multiple: false
  });

  let fileBuffer = null;
  let file = null;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(f) {
    file = f;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.fileName.innerText = file.name;
    ui.fileMeta.innerText = 'PDF loaded. Ready to compile Markdown.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Parsing text layouts...');

    try {
      const pagesText = await extractPDFText(fileBuffer, (current, total) => {
        progress.progressText.innerText = `Reading PDF elements... Page ${current} of ${total}`;
        progress.progressBar.style.width = `${10 + (current / total) * 60}%`;
      });

      progress.progressText.innerText = 'Generating markdown structure...';
      progress.progressBar.style.width = '80%';
      
      let mdText = `# ${file.name.replace(/\.pdf$/i, '')}\n\n`;

      pagesText.forEach((lines, pageIdx) => {
        mdText += `<!-- Page ${pageIdx + 1} -->\n\n`;
        
        lines.forEach(line => {
          // Apply simple Markdown structural heuristics
          const trimmed = line.trim();
          
          if (trimmed.length < 50 && (trimmed.toUpperCase() === trimmed || /^[A-Z0-9\s:&-]+$/.test(trimmed))) {
            // Heuristic for Heading 2
            mdText += `## ${trimmed}\n\n`;
          } else if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
            // Heuristic for list item
            const itemText = trimmed.replace(/^[•\-\*]\s*/, '');
            mdText += `- ${itemText}\n`;
          } else {
            // Normal paragraph
            mdText += `${trimmed}\n\n`;
          }
        });
        
        mdText += '\n';
      });

      const mdBlob = new Blob([mdText], { type: 'text/markdown;charset=utf-8' });
      progress.progressBar.style.width = '100%';

      const outputName = file.name.replace(/\.pdf$/i, '') + '.md';
      showSuccessView(container, {
        title: 'PDF converted to Markdown!',
        meta: `Markdown file: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-code-fill',
        onDownload: () => downloadBlob(mdBlob, outputName, 'text/markdown'),
        onReload: () => initPdfToMarkdown(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPdfToMarkdown(container));
    }
  });
}
