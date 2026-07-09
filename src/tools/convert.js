import { loadScript, downloadBlob, formatBytes, fileToArrayBuffer, renderPDFPageToCanvas, downloadZipOfFiles } from '../utils.js';

// --- Shared File Input & UI Builder Helper ---
function createConvertUI(container, options) {
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

// --- Text Extractor Helper for PDF Parsing ---
async function extractPDFText(arrayBuffer, progressCallback) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const numPages = pdf.numPages;
  const pagesText = []; // Array of arrays (lines of text)

  for (let i = 1; i <= numPages; i++) {
    if (progressCallback) progressCallback(i, numPages);
    
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Group text items by y-coordinate (lines)
    const lineMap = {};
    textContent.items.forEach(item => {
      const y = Math.round(item.transform[5]); // Y coordinate
      if (!lineMap[y]) {
        lineMap[y] = [];
      }
      lineMap[y].push(item);
    });

    // Sort lines from top to bottom
    const sortedY = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
    const pageLines = [];
    
    sortedY.forEach(y => {
      // Sort items within line from left to right
      const lineItems = lineMap[y].sort((a, b) => a.transform[4] - b.transform[4]);
      const lineStr = lineItems.map(item => item.str).join(' ').trim();
      if (lineStr) {
        pageLines.push(lineStr);
      }
    });

    pagesText.push(pageLines);
  }

  return pagesText;
}

// --- Showing Success Panel Helper ---
function showSuccessView(container, options) {
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

// --- Showing Progress Panel Helper ---
function showProgressView(container, text) {
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

// --- Showing Error Panel Helper ---
function showErrorView(container, msg, onReload) {
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


// ==========================================
// 1. PDF TO WORD
// ==========================================
export function initPdfToWord(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF file here',
    subtitle: 'Extract pages text content to Microsoft Word (.docx)',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-docx',
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
    ui.fileMeta.innerText = 'File selected. Ready to convert.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Loading PDF parser...');
    
    try {
      // 1. Extract text
      const pagesText = await extractPDFText(fileBuffer, (current, total) => {
        progress.progressText.innerText = `Parsing PDF structure... Page ${current} of ${total}`;
        progress.progressBar.style.width = `${10 + (current / total) * 50}%`;
      });

      // 2. Load docx.js
      progress.progressText.innerText = 'Loading Word generating engine...';
      progress.progressBar.style.width = '70%';
      await loadScript('https://cdn.jsdelivr.net/npm/docx@8.2.0/build/index.umd.min.js');

      // 3. Create document
      progress.progressText.innerText = 'Creating Word file...';
      progress.progressBar.style.width = '85%';
      
      const { Document, Paragraph, TextRun, Packer } = window.docx;
      
      const docChildren = [];
      pagesText.forEach((lines, pageIdx) => {
        lines.forEach(line => {
          docChildren.push(new Paragraph({
            children: [new TextRun(line)]
          }));
        });
        
        // Add Page Break if not the last page
        if (pageIdx < pagesText.length - 1) {
          docChildren.push(new Paragraph({
            children: [],
            pageBreakBefore: true
          }));
        }
      });

      const doc = new Document({
        sections: [{ children: docChildren }]
      });

      // 4. Save
      const docxBlob = await Packer.toBlob(doc);
      progress.progressBar.style.width = '100%';

      const outputName = file.name.replace(/\.pdf$/i, '') + '.docx';
      showSuccessView(container, {
        title: 'PDF to Word Converted!',
        meta: `Word document: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-word-fill',
        onDownload: () => downloadBlob(docxBlob, outputName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        onReload: () => initPdfToWord(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPdfToWord(container));
    }
  });
}

// ==========================================
// 2. WORD TO PDF
// ==========================================
export function initWordToPdf(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop Word file here (.docx)',
    subtitle: 'Make DOCX files easy to read by converting them to PDF',
    inputType: 'word',
    icon: 'bi-file-word',
    fileIcon: 'bi-file-pdf',
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
    ui.fileMeta.innerText = 'File loaded. Click Convert below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Loading conversion tools...');
    
    try {
      // 1. Load mammoth.js to convert docx to HTML
      progress.progressText.innerText = 'Extracting Word layout...';
      progress.progressBar.style.width = '30%';
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
      
      const result = await window.mammoth.convertToHtml({ arrayBuffer: fileBuffer });
      const htmlContent = result.value; // The rendered html string

      // 2. Load html2pdf.js
      progress.progressText.innerText = 'Loading PDF render engine...';
      progress.progressBar.style.width = '60%';
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');

      // 3. Render HTML in a structured paper format
      progress.progressText.innerText = 'Rendering layouts...';
      progress.progressBar.style.width = '85%';
      
      const renderContainer = document.createElement('div');
      renderContainer.id = 'word-pdf-render-root';
      renderContainer.style.cssText = 'padding: 40px; font-family: "Georgia", serif; line-height: 1.6; color: #111; background: #fff; width: 800px;';
      renderContainer.innerHTML = htmlContent;
      
      // Inject temporarily into document body (hidden)
      renderContainer.style.position = 'fixed';
      renderContainer.style.left = '-9999px';
      document.body.appendChild(renderContainer);

      // Save PDF via html2pdf
      const outputName = file.name.replace(/\.docx$/i, '') + '.pdf';
      const opt = {
        margin: 0.75,
        filename: outputName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
      };

      const pdfBlob = await window.html2pdf().set(opt).from(renderContainer).output('blob');
      
      // Cleanup
      document.body.removeChild(renderContainer);
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'Word converted to PDF!',
        meta: `PDF file: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-pdf-fill',
        onDownload: () => downloadBlob(pdfBlob, outputName),
        onReload: () => initWordToPdf(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initWordToPdf(container));
    }
  });
}

// ==========================================
// 3. PDF TO EXCEL
// ==========================================
export function initPdfToExcel(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF file here',
    subtitle: 'Pull tabular layouts to Excel spreadsheets (.xlsx)',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-xlsx',
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
    ui.fileMeta.innerText = 'File selected. Ready to extract sheets.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Parsing PDF grids...');
    
    try {
      const pagesText = await extractPDFText(fileBuffer, (current, total) => {
        progress.progressText.innerText = `Extracting PDF text structures... Page ${current} of ${total}`;
        progress.progressBar.style.width = `${10 + (current / total) * 50}%`;
      });

      // Load SheetJS xlsx.js
      progress.progressText.innerText = 'Loading SheetJS engine...';
      progress.progressBar.style.width = '70%';
      await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');

      // Create workbook
      progress.progressText.innerText = 'Structuring Excel columns...';
      progress.progressBar.style.width = '85%';
      
      const XLSX = window.XLSX;
      const wb = XLSX.utils.book_new();

      pagesText.forEach((lines, pageIdx) => {
        // Map line text: if lines contain multiple spacing, split into table cells
        const sheetData = lines.map(line => {
          // Split by 2 or more spaces (heuristic to isolate columns)
          return line.split(/\s{2,}/);
        });

        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        XLSX.utils.book_append_sheet(wb, ws, `Page ${pageIdx + 1}`);
      });

      // Write workbook bytes
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const excelBlob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      progress.progressBar.style.width = '100%';

      const outputName = file.name.replace(/\.pdf$/i, '') + '.xlsx';
      showSuccessView(container, {
        title: 'PDF converted to Excel!',
        meta: `Spreadsheet: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-excel-fill',
        onDownload: () => downloadBlob(excelBlob, outputName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        onReload: () => initPdfToExcel(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPdfToExcel(container));
    }
  });
}

// ==========================================
// 4. EXCEL TO PDF
// ==========================================
export function initExcelToPdf(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop Excel spreadsheet here (.xlsx, .xls)',
    subtitle: 'Render spreadsheet sheets into PDF layout pages',
    inputType: 'excel',
    icon: 'bi-file-excel',
    fileIcon: 'bi-file-pdf',
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
    ui.fileMeta.innerText = 'Spreadsheet parsed. Ready to print.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Parsing Excel workbook...');
    
    try {
      // 1. Load XLSX parser
      await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
      const XLSX = window.XLSX;
      
      progress.progressText.innerText = 'Extracting sheet values...';
      progress.progressBar.style.width = '40%';
      
      const wb = XLSX.read(fileBuffer, { type: 'array' });
      
      // Build HTML output of sheets tables
      let sheetsHtml = '';
      wb.SheetNames.forEach((name, idx) => {
        const ws = wb.Sheets[name];
        const htmlTable = XLSX.utils.sheet_to_html(ws);
        sheetsHtml += `
          <div class="sheet-container" style="page-break-after: always; padding: 20px 0;">
            <h2 style="font-family:'Outfit', sans-serif; font-size:1.5rem; margin-bottom:10px; color:#4f46e5;">Sheet: ${name}</h2>
            <div style="overflow-x:auto;">
              ${htmlTable}
            </div>
          </div>
        `;
      });

      // 2. Load PDF Renderer
      progress.progressText.innerText = 'Configuring layout...';
      progress.progressBar.style.width = '70%';
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');

      const renderContainer = document.createElement('div');
      renderContainer.style.cssText = 'padding: 40px; background:#fff; color:#333; font-family:sans-serif; font-size:11px;';
      renderContainer.innerHTML = `
        <style>
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
          tr:nth-child(even) { background-color: #f9f9f9; }
        </style>
        ${sheetsHtml}
      `;

      renderContainer.style.position = 'fixed';
      renderContainer.style.left = '-9999px';
      document.body.appendChild(renderContainer);

      progress.progressText.innerText = 'Printing sheets to PDF...';
      progress.progressBar.style.width = '85%';

      const outputName = file.name.replace(/\.xlsx$|\.xls$/i, '') + '.pdf';
      const opt = {
        margin: 0.5,
        filename: outputName,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 1.5, useCORS: true },
        // Render in landscape mode for sheets tables
        jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
      };

      const pdfBlob = await window.html2pdf().set(opt).from(renderContainer).output('blob');
      document.body.removeChild(renderContainer);
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'Excel sheets converted to PDF!',
        meta: `PDF document: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-pdf-fill',
        onDownload: () => downloadBlob(pdfBlob, outputName),
        onReload: () => initExcelToPdf(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initExcelToPdf(container));
    }
  });
}

// ==========================================
// 5. PDF TO POWERPOINT
// ==========================================
export function initPdfToPowerpoint(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF document here',
    subtitle: 'Extract text lines into editing PowerPoint slides (.pptx)',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-pptx',
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
    ui.fileMeta.innerText = 'PDF readied. Click Convert below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Parsing slides text...');
    
    try {
      const pagesText = await extractPDFText(fileBuffer, (current, total) => {
        progress.progressText.innerText = `Extracting PDF layouts... Page ${current} of ${total}`;
        progress.progressBar.style.width = `${10 + (current / total) * 50}%`;
      });

      // Load PptxGenJS
      progress.progressText.innerText = 'Loading PowerPoint slide engine...';
      progress.progressBar.style.width = '70%';
      await loadScript('https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js');

      progress.progressText.innerText = 'Creating presentation...';
      progress.progressBar.style.width = '85%';
      
      const pres = new window.PptxGenJS();
      
      pagesText.forEach((lines, pageIdx) => {
        const slide = pres.addSlide();
        
        // Define Slide Title
        let titleText = `Slide ${pageIdx + 1}`;
        let bodyLines = [];
        
        if (lines.length > 0) {
          titleText = lines[0]; // Heuristic: first line is slide header
          bodyLines = lines.slice(1);
        }

        // Add Slide Title
        slide.addText(titleText, {
          x: 0.5,
          y: 0.5,
          w: 9.0,
          h: 0.8,
          fontSize: 24,
          bold: true,
          color: '363636',
          fontFace: 'Arial'
        });

        // Add Slide Content
        if (bodyLines.length > 0) {
          slide.addText(bodyLines.join('\n'), {
            x: 0.5,
            y: 1.5,
            w: 9.0,
            h: 5.0,
            fontSize: 14,
            color: '666666',
            fontFace: 'Arial',
            valign: 'top'
          });
        }
      });

      // Write PPTX presentation
      progress.progressText.innerText = 'Saving slide deck...';
      progress.progressBar.style.width = '95%';
      
      const outputName = file.name.replace(/\.pdf$/i, '') + '.pptx';
      await pres.writeFile({ fileName: outputName });
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'PDF Converted to Slides!',
        meta: `PowerPoint slide deck: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-ppt-fill',
        downloadBtn: false, // Automatically saved/downloaded by pptxgen.js
        onReload: () => initPdfToPowerpoint(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPdfToPowerpoint(container));
    }
  });
}

// ==========================================
// 6. POWERPOINT TO PDF
// ==========================================
export function initPowerpointToPdf(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PPTX slide deck here',
    subtitle: 'Extract text slides into PDF presentation slides',
    inputType: 'powerpoint',
    icon: 'bi-file-ppt',
    fileIcon: 'bi-file-pdf',
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
    ui.fileMeta.innerText = 'PowerPoint loaded. Click Convert below.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Unpacking PowerPoint slides...');
    
    try {
      // Load JSZip
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      const zip = await window.JSZip.loadAsync(fileBuffer);
      
      progress.progressText.innerText = 'Parsing slide XML content...';
      progress.progressBar.style.width = '40%';
      
      // PowerPoint slides are listed in ppt/slides/slide1.xml, etc.
      // Look for files matching this pattern
      const slideFiles = Object.keys(zip.files).filter(k => k.startsWith('ppt/slides/slide') && k.endsWith('.xml'));
      
      // Sort numerically by slide number
      slideFiles.sort((a, b) => {
        const numA = parseInt(a.replace(/[^\d]/g, ''), 10);
        const numB = parseInt(b.replace(/[^\d]/g, ''), 10);
        return numA - numB;
      });

      if (slideFiles.length === 0) {
        throw new Error('No slide files found in PPTX container structure.');
      }

      let slidesHtml = '';
      for (let i = 0; i < slideFiles.length; i++) {
        const slideXml = await zip.file(slideFiles[i]).async('text');
        
        // Simple XML parser to pull text within <a:t> elements
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(slideXml, 'text/xml');
        const textElements = xmlDoc.getElementsByTagName('a:t');
        
        const textLines = Array.from(textElements).map(el => el.textContent.trim()).filter(Boolean);
        
        let title = `Slide ${i + 1}`;
        let bullets = textLines;
        if (textLines.length > 0) {
          title = textLines[0];
          bullets = textLines.slice(1);
        }

        slidesHtml += `
          <div class="slide-page" style="page-break-after: always; width: 10in; height: 7.5in; padding: 0.75in; background: #fff; box-shadow: inset 0 0 10px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: flex-start; box-sizing: border-box;">
            <h1 style="font-family:'Outfit', sans-serif; font-size: 2.2rem; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 15px; margin-top:0;">${title}</h1>
            <ul style="font-family: sans-serif; font-size: 1.35rem; line-height: 1.8; color: #374151; margin-top: 30px; padding-left: 20px;">
              ${bullets.map(b => `<li style="margin-bottom: 10px;">${b}</li>`).join('')}
            </ul>
          </div>
        `;
      }

      // Load PDF Renderer
      progress.progressText.innerText = 'Creating PDF document...';
      progress.progressBar.style.width = '70%';
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');

      const renderContainer = document.createElement('div');
      renderContainer.innerHTML = slidesHtml;
      renderContainer.style.position = 'fixed';
      renderContainer.style.left = '-9999px';
      document.body.appendChild(renderContainer);

      progress.progressText.innerText = 'Printing slides to PDF...';
      progress.progressBar.style.width = '85%';

      const outputName = file.name.replace(/\.pptx$|\.ppt$/i, '') + '.pdf';
      const opt = {
        margin: 0,
        filename: outputName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        // Standard presentation ratio: 10in x 7.5in (landscape)
        jsPDF: { unit: 'in', format: [10, 7.5], orientation: 'landscape' }
      };

      const pdfBlob = await window.html2pdf().set(opt).from(renderContainer).output('blob');
      document.body.removeChild(renderContainer);
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'PowerPoint converted to PDF!',
        meta: `PDF file: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-pdf-fill',
        onDownload: () => downloadBlob(pdfBlob, outputName),
        onReload: () => initPowerpointToPdf(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPowerpointToPdf(container));
    }
  });
}

// ==========================================
// 7. PDF TO JPG
// ==========================================
export function initPdfToJpg(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF document here',
    subtitle: 'Render each PDF page to individual JPG images',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-jpg',
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
    ui.fileMeta.innerText = 'PDF readied. Ready to render pages.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;
    const progress = showProgressView(container, 'Loading render tools...');
    
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
      
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      const totalPages = pdf.numPages;
      const filesToZip = [];

      for (let i = 1; i <= totalPages; i++) {
        progress.progressText.innerText = `Rendering page ${i} of ${totalPages} to image...`;
        progress.progressBar.style.width = `${15 + (i / totalPages) * 75}%`;
        
        const page = await pdf.getPage(i);
        const canvas = await renderPDFPageToCanvas(page, 2.0); // 2.0 scale for high resolution JPG
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const base64Data = dataUrl.split(',')[1];
        
        const pageNum = String(i).padStart(3, '0');
        filesToZip.push({
          name: `${file.name.replace(/\.pdf$/i, '')}_page_${pageNum}.jpg`,
          data: base64Data
        });
      }

      progress.progressText.innerText = 'Packaging images into ZIP...';
      progress.progressBar.style.width = '95%';
      
      const zipName = file.name.replace(/\.pdf$/i, '') + '_images.zip';
      
      // Download ZIP via JSZip Base64 method
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      const zip = new window.JSZip();
      filesToZip.forEach(f => {
        zip.file(f.name, f.data, { base64: true });
      });
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, zipName, 'application/zip');
      
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'PDF pages converted to JPG!',
        meta: `Images package: <strong>${zipName}</strong>`,
        icon: 'bi-file-earmark-zip-fill',
        downloadBtn: false,
        onReload: () => initPdfToJpg(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPdfToJpg(container));
    }
  });
}

// ==========================================
// 8. JPG TO PDF
// ==========================================
export function initJpgToPdf(container) {
  let images = []; // Array of { id, file, base64/buffer, name, sizeFormatted }
  let imageCounter = 0;

  const ui = createConvertUI(container, {
    title: 'Drag & Drop JPG/PNG images here',
    subtitle: 'Convert images to PDF in seconds. Easily adjust layout settings.',
    inputType: 'image',
    icon: 'bi-images',
    fileIcon: 'bi-file-pdf',
    multiple: true,
    settingsHTML: `
      <div class="form-group">
        <label for="jpg-layout-size">Page Size</label>
        <select id="jpg-layout-size" class="form-control">
          <option value="a4">A4 (210 x 297 mm)</option>
          <option value="letter">US Letter (8.5 x 11 in)</option>
          <option value="fit">Fit Image (No Borders)</option>
        </select>
      </div>

      <div class="form-group" style="margin-top:0.75rem;">
        <label for="jpg-layout-orient">Page Orientation</label>
        <select id="jpg-layout-orient" class="form-control">
          <option value="auto">Auto (Best Match)</option>
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </div>

      <div class="form-group" style="margin-top:0.75rem;">
        <label for="jpg-layout-margin">Margins</label>
        <select id="jpg-layout-margin" class="form-control">
          <option value="none">No Margins (0px)</option>
          <option value="small">Small Margins (20px)</option>
          <option value="large">Large Margins (40px)</option>
        </select>
      </div>
    `
  });

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', handleFiles);

  ui.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); ui.dropzone.classList.add('dragover'); });
  ui.dropzone.addEventListener('dragleave', () => { ui.dropzone.classList.remove('dragover'); });
  ui.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    ui.dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFileList(e.dataTransfer.files);
  });

  function handleFiles(e) {
    if (e.target.files.length > 0) handleFileList(e.target.files);
  }

  async function handleFileList(filesList) {
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.imgGrid.style.display = 'grid';

    for (const file of filesList) {
      if (!file.type.startsWith('image/')) continue;
      
      const buffer = await fileToArrayBuffer(file);
      const url = URL.createObjectURL(file);
      
      images.push({
        id: imageCounter++,
        file: file,
        arrayBuffer: buffer,
        name: file.name,
        url: url
      });
    }

    updateImageGrid();
  }

  function updateImageGrid() {
    ui.imgGrid.innerHTML = '';
    
    if (images.length === 0) {
      ui.preview.style.display = 'none';
      ui.dropzone.style.display = 'flex';
      ui.runBtn.disabled = true;
      return;
    }

    ui.runBtn.disabled = false;
    ui.fileMeta.innerText = `Uploaded: ${images.length} image(s)`;

    images.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'page-thumbnail-card';
      card.innerHTML = `
        <img src="${item.url}" style="width:100%; height:100%; object-fit:cover;">
        <span class="page-number-badge">${index + 1}</span>
        <div class="page-action-overlay">
          <button class="btn-overlay btn-move-left" title="Move Left"><i class="bi bi-arrow-left"></i></button>
          <button class="btn-overlay btn-move-right" title="Move Right"><i class="bi bi-arrow-right"></i></button>
          <button class="btn-overlay btn-delete-img" title="Delete"><i class="bi bi-trash"></i></button>
        </div>
      `;

      card.querySelector('.btn-move-left').addEventListener('click', (e) => { e.stopPropagation(); shiftImg(index, -1); });
      card.querySelector('.btn-move-right').addEventListener('click', (e) => { e.stopPropagation(); shiftImg(index, 1); });
      card.querySelector('.btn-delete-img').addEventListener('click', (e) => { e.stopPropagation(); removeImg(item.id); });

      ui.imgGrid.appendChild(card);
    });
  }

  function shiftImg(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= images.length) return;
    const temp = images[index];
    images[index] = images[target];
    images[target] = temp;
    updateImageGrid();
  }

  function removeImg(id) {
    const item = images.find(img => img.id === id);
    if (item) URL.revokeObjectURL(item.url);
    images = images.filter(img => img.id !== id);
    updateImageGrid();
  }

  ui.runBtn.addEventListener('click', async () => {
    if (images.length === 0) return;
    const progress = showProgressView(container, 'Loading PDF creation engine...');

    try {
      await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
      const { PDFDocument } = window.PDFLib;
      
      const pdfDoc = await PDFDocument.create();
      
      const pageSizeSelect = container.querySelector('#jpg-layout-size').value;
      const orientSelect = container.querySelector('#jpg-layout-orient').value;
      const marginSelect = container.querySelector('#jpg-layout-margin').value;

      // Map margins
      let margin = 0;
      if (marginSelect === 'small') margin = 20;
      if (marginSelect === 'large') margin = 40;

      for (let i = 0; i < images.length; i++) {
        const item = images[i];
        progress.progressText.innerText = `Embedding image ${i + 1} of ${images.length}...`;
        progress.progressBar.style.width = `${10 + (i / images.length) * 80}%`;

        // Embed png or jpeg
        let embedImg;
        if (item.file.type === 'image/png') {
          embedImg = await pdfDoc.embedPng(item.arrayBuffer);
        } else {
          embedImg = await pdfDoc.embedJpg(item.arrayBuffer);
        }

        const imgWidth = embedImg.width;
        const imgHeight = embedImg.height;

        let pageWidth = imgWidth;
        let pageHeight = imgHeight;

        // Resolve Page Dimensions
        if (pageSizeSelect === 'a4') {
          pageWidth = 595.28; // standard A4 pt
          pageHeight = 841.89;
        } else if (pageSizeSelect === 'letter') {
          pageWidth = 612; // standard letter pt
          pageHeight = 792;
        }

        // Apply Orientation Override
        if (pageSizeSelect !== 'fit') {
          const isLandscape = imgWidth > imgHeight;
          if (orientSelect === 'landscape' || (orientSelect === 'auto' && isLandscape)) {
            // Swap page dimensions to landscape
            const temp = pageWidth;
            pageWidth = Math.max(pageWidth, pageHeight);
            pageHeight = Math.min(temp, pageHeight);
          } else if (orientSelect === 'portrait') {
            const temp = pageWidth;
            pageWidth = Math.min(pageWidth, pageHeight);
            pageHeight = Math.max(temp, pageHeight);
          }
        } else {
          // Fit Page
          pageWidth = imgWidth + margin * 2;
          pageHeight = imgHeight + margin * 2;
        }

        const page = pdfDoc.addPage([pageWidth, pageHeight]);

        // Calculate Image Drawing size (best fit maintaining ratio within page and margins)
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - margin * 2;
        
        let drawWidth = imgWidth;
        let drawHeight = imgHeight;
        
        const ratioX = maxWidth / imgWidth;
        const ratioY = maxHeight / imgHeight;
        const ratio = Math.min(ratioX, ratioY);

        if (ratio < 1 || pageSizeSelect !== 'fit') {
          drawWidth = imgWidth * ratio;
          drawHeight = imgHeight * ratio;
        }

        // Centering coordinates
        const x = margin + (maxWidth - drawWidth) / 2;
        const y = margin + (maxHeight - drawHeight) / 2;

        page.drawImage(embedImg, {
          x: x,
          y: y,
          width: drawWidth,
          height: drawHeight
        });
      }

      progress.progressText.innerText = 'Assembling final PDF...';
      progress.progressBar.style.width = '95%';
      
      const pdfBytes = await pdfDoc.save();
      progress.progressBar.style.width = '100%';

      const outputName = 'images_converted.pdf';
      showSuccessView(container, {
        title: 'Images converted to PDF!',
        meta: `Output PDF: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-pdf-fill',
        onDownload: () => downloadBlob(pdfBytes, outputName),
        onReload: () => initJpgToPdf(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initJpgToPdf(container));
    }
  });
}

// ==========================================
// 9. PDF TO MARKDOWN
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

// ==========================================
// 10. HTML TO PDF
// ==========================================
export function initHtmlToPdf(container) {
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div class="form-group">
        <label for="html-input-mode">Input Mode</label>
        <select id="html-input-mode" class="form-control">
          <option value="code">Write/Paste Raw HTML Code</option>
          <option value="url">Convert URL (Via Proxy)</option>
        </select>
      </div>

      <!-- Raw HTML Editor -->
      <div id="html-editor-wrapper" class="form-group" style="margin-top: 1rem; flex: 1; display: flex; flex-direction: column;">
        <label for="html-code-area">HTML Code</label>
        <textarea id="html-code-area" class="form-control" style="flex: 1; font-family: monospace; font-size: 0.85rem; min-height: 250px; resize: vertical;" placeholder="<!DOCTYPE html><html><body><h1>Hello World</h1></body></html>"><h1>Welcome to PDFZen</h1><p>Type or paste your HTML here to convert it into a beautiful PDF.</p></textarea>
      </div>

      <!-- URL Input -->
      <div id="html-url-wrapper" class="form-group" style="margin-top: 1rem; display: none;">
        <label for="html-url-input">Website URL</label>
        <input type="url" id="html-url-input" class="form-control" placeholder="https://example.com">
        <span class="form-help">Enter a URL. We will fetch and load the page using a client CORS proxy.</span>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">Layout Settings</h3>
      
      <div class="form-group">
        <label for="html-layout-orient">Page Orientation</label>
        <select id="html-layout-orient" class="form-control">
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </div>

      <div class="form-group" style="margin-top: 0.75rem;">
        <label for="html-layout-margin">Page Margin</label>
        <select id="html-layout-margin" class="form-control">
          <option value="0.5">Normal (0.5 inch)</option>
          <option value="0">No Margins (0 inch)</option>
          <option value="1.0">Wide (1.0 inch)</option>
        </select>
      </div>

      <button id="btn-run-html-convert" class="btn btn-primary" style="width: 100%; margin-top: 1.5rem;">
        <i class="bi bi-globe"></i> Generate PDF
      </button>
    </div>
  `;

  const inputMode = container.querySelector('#html-input-mode');
  const editorWrapper = container.querySelector('#html-editor-wrapper');
  const urlWrapper = container.querySelector('#html-url-wrapper');
  const codeArea = container.querySelector('#html-code-area');
  const urlInput = container.querySelector('#html-url-input');
  const runBtn = container.querySelector('#btn-run-html-convert');

  inputMode.addEventListener('change', () => {
    const val = inputMode.value;
    if (val === 'code') {
      editorWrapper.style.display = 'flex';
      urlWrapper.style.display = 'none';
    } else {
      editorWrapper.style.display = 'none';
      urlWrapper.style.display = 'flex';
    }
  });

  runBtn.addEventListener('click', async () => {
    const mode = inputMode.value;
    const orientation = container.querySelector('#html-layout-orient').value;
    const margin = parseFloat(container.querySelector('#html-layout-margin').value);

    let htmlContent = '';
    let nameSuffix = 'webpage';

    if (mode === 'code') {
      htmlContent = codeArea.value.trim();
      if (!htmlContent) return alert('Please input some HTML content.');
      nameSuffix = 'markup';
    } else {
      const url = urlInput.value.trim();
      if (!url) return alert('Please enter a valid URL.');
      
      nameSuffix = url.replace(/https?:\/\/(www\.)?/, '').split('/')[0];
      
      const progress = showProgressView(container, `Fetching webpage via proxy...`);
      try {
        // Fetch URL via public proxy to bypass CORS
        const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
        if (!response.ok) throw new Error('Webpage could not be fetched. Check the URL.');
        
        const data = await response.json();
        htmlContent = data.contents;
      } catch (err) {
        console.error(err);
        return showErrorView(container, `Failed to load URL contents: ${err.message}`, () => initHtmlToPdf(container));
      }
    }

    const progress = showProgressView(container, 'Loading render tools...');
    
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');
      
      progress.progressText.innerText = 'Generating PDF pages...';
      progress.progressBar.style.width = '70%';

      const renderContainer = document.createElement('div');
      renderContainer.innerHTML = htmlContent;
      renderContainer.style.position = 'fixed';
      renderContainer.style.left = '-9999px';
      // Basic print styles inside container
      renderContainer.style.cssText = 'padding: 40px; background:#fff; color:#000; width: 800px;';
      document.body.appendChild(renderContainer);

      const outputName = `${nameSuffix}_converted.pdf`;
      const opt = {
        margin: margin,
        filename: outputName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 1.5, useCORS: true },
        jsPDF: { unit: 'in', format: 'letter', orientation: orientation }
      };

      const pdfBlob = await window.html2pdf().set(opt).from(renderContainer).output('blob');
      document.body.removeChild(renderContainer);
      progress.progressBar.style.width = '100%';

      showSuccessView(container, {
        title: 'HTML converted to PDF!',
        meta: `PDF document: <strong>${outputName}</strong>`,
        icon: 'bi-file-earmark-pdf-fill',
        onDownload: () => downloadBlob(pdfBlob, outputName),
        onReload: () => initHtmlToPdf(container)
      });

    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initHtmlToPdf(container));
    }
  });
}
