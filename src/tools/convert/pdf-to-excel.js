import { createConvertUI, showSuccessView, showProgressView, showErrorView, pdfjsLib, fileToArrayBuffer, downloadBlob, backendStatusFieldHTML, refreshBackendStatus, convertViaBackend } from './convert-shared.js';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

// ==========================================
// PDF TO EXCEL / CSV (Coordinates-Based Table Detection)
// ==========================================

/**
 * Grid-based text extraction using character coordinates.
 * Aligns columns across lines by detecting overlapping boundaries.
 */
function extractTabularGrid(textContent) {
  const items = textContent.items.filter(item => item.str && item.str.trim() !== '');
  if (items.length === 0) return [];

  // 1. Group items into lines by Y coordinate (clustering items within 4pt)
  items.sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > 4) return yDiff;
    return a.transform[4] - b.transform[4];
  });

  const lines = [];
  let currentLine = [];
  let currentY = null;

  for (const item of items) {
    const y = item.transform[5];
    if (currentY === null || Math.abs(y - currentY) <= 4) {
      currentLine.push(item);
      if (currentY === null) currentY = y;
    } else {
      lines.push(currentLine);
      currentLine = [item];
      currentY = y;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  // 2. Merge close text items within each line to form chunks
  const lineChunks = [];
  for (const line of lines) {
    line.sort((a, b) => a.transform[4] - b.transform[4]);
    const chunks = [];
    let currentChunk = null;

    for (const item of line) {
      const x = item.transform[4];
      const width = item.width || (item.str.length * 6); // fallback estimate
      
      if (!currentChunk) {
        currentChunk = { text: item.str, left: x, right: x + width };
      } else {
        const gap = x - currentChunk.right;
        // Merge if gap is small (typically space width or less)
        if (gap < 8) {
          if (gap > 2) currentChunk.text += ' ';
          currentChunk.text += item.str;
          currentChunk.right = Math.max(currentChunk.right, x + width);
        } else {
          chunks.push(currentChunk);
          currentChunk = { text: item.str, left: x, right: x + width };
        }
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    lineChunks.push(chunks);
  }

  // 3. Construct global column bands by scanning all lines
  const columns = [];
  for (const chunks of lineChunks) {
    for (const chunk of chunks) {
      let matchedCol = null;
      for (const col of columns) {
        // Overlap check
        const overlap = Math.max(col.left, chunk.left) < Math.min(col.right, chunk.right);
        if (overlap) {
          matchedCol = col;
          break;
        }
      }

      if (matchedCol) {
        matchedCol.left = Math.min(matchedCol.left, chunk.left);
        matchedCol.right = Math.max(matchedCol.right, chunk.right);
      } else {
        columns.push({ left: chunk.left, right: chunk.right });
      }
    }
  }

  // Sort columns from left to right
  columns.sort((a, b) => a.left - b.left);

  // 4. Map each chunk in each line to the column grid index
  const grid = [];
  for (const chunks of lineChunks) {
    const row = new Array(columns.length).fill('');
    for (const chunk of chunks) {
      let bestColIdx = 0;
      let maxOverlap = -1;

      columns.forEach((col, idx) => {
        const overlapStart = Math.max(col.left, chunk.left);
        const overlapEnd = Math.min(col.right, chunk.right);
        const overlapWidth = overlapEnd - overlapStart;
        if (overlapWidth > maxOverlap) {
          maxOverlap = overlapWidth;
          bestColIdx = idx;
        }
      });

      if (row[bestColIdx]) {
        row[bestColIdx] += ' ' + chunk.text;
      } else {
        row[bestColIdx] = chunk.text;
      }
    }
    grid.push(row);
  }

  return grid;
}

/**
 * Format a 2D grid array as a CSV string
 */
function gridToCsv(grid) {
  return grid.map(row => {
    return row.map(cell => {
      let val = String(cell || '').replace(/"/g, '""');
      if (val.includes(',') || val.includes('\n') || val.includes('"')) {
        val = `"${val}"`;
      }
      return val;
    }).join(',');
  }).join('\n');
}

export function initPdfToExcel(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF file here',
    subtitle: 'Pull tabular layouts to Excel spreadsheets or CSV sheets',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-xlsx',
    multiple: false,
    settingsHTML: `
      <div class="form-group">
        <label for="excel-output-format">Output Format</label>
        <select id="excel-output-format" class="form-control">
          <option value="xlsx">Excel Workbook (.xlsx)</option>
          <option value="csv">CSV (Comma Separated Values)</option>
        </select>
        <span class="form-help" style="margin-top: 0.4rem; display: block;">
          <strong>Excel</strong>: Multi-page outputs become separate sheets.<br>
          <strong>CSV</strong>: Returns a text sheet. Multi-page outputs are packaged in a ZIP.
        </span>
      </div>
      ${backendStatusFieldHTML()}
    `
  });

  let fileBuffer = null;
  let file = null;

  refreshBackendStatus(container);

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  async function processFile(f) {
    file = f;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.fileName.innerText = file.name;
    ui.fileMeta.innerText = 'File selected. Ready to extract tabular data.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
    // Double check backend on file select
    refreshBackendStatus(container);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;

    const outputFormat = container.querySelector('#excel-output-format').value;
    const backend = await refreshBackendStatus(container);

    if (!backend.ok) {
      showErrorView(container, "Local Python backend is offline. Please start it using 'start.bat' (or 'uv run server.py') to enable high-fidelity PDF to Excel conversion.", () => initPdfToExcel(container));
      return;
    }

    const ext = outputFormat === 'xlsx' ? '.xlsx' : '.csv';
    await convertViaBackend(container, file, {
      endpoint: '/convert/pdf-to-excel',
      fields: { format: outputFormat },
      outName: file.name.replace(/\.pdf$/i, '') + ext,
      mime: outputFormat === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
      title: outputFormat === 'xlsx' ? 'PDF Converted to Excel!' : 'PDF Converted to CSV!',
      meta: `Spreadsheet: <strong>${file.name.replace(/\.pdf$/i, '') + ext}</strong> — Extracted via local Python engine`,
      icon: outputFormat === 'xlsx' ? 'bi-file-earmark-excel-fill' : 'bi-file-earmark-spreadsheet-fill',
      progressText: 'Extracting tables (running pdfplumber)...',
      onReload: () => initPdfToExcel(container)
    });
  });

  async function convertClientSide(container, outputFormat) {
    const progress = showProgressView(container, 'Parsing PDF structures...');
    try {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
      const totalPages = pdf.numPages;
      const pagesGrid = [];

      for (let i = 1; i <= totalPages; i++) {
        progress.progressText.innerText = `Extracting tables... Page ${i} of ${totalPages}`;
        progress.progressBar.style.width = `${10 + (i / totalPages) * 60}%`;
        
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const grid = extractTabularGrid(textContent);
        pagesGrid.push(grid);
      }

      progress.progressText.innerText = 'Structuring output layout...';
      progress.progressBar.style.width = '85%';

      if (outputFormat === 'xlsx') {
        // Excel Workbook Output
        const wb = XLSX.utils.book_new();
        pagesGrid.forEach((grid, pageIdx) => {
          const ws = XLSX.utils.aoa_to_sheet(grid);
          XLSX.utils.book_append_sheet(wb, ws, `Page ${pageIdx + 1}`);
        });

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
      } else {
        // CSV Output
        if (totalPages === 1) {
          // Single CSV output
          const csvText = gridToCsv(pagesGrid[0]);
          const csvBlob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
          
          progress.progressBar.style.width = '100%';
          const outputName = file.name.replace(/\.pdf$/i, '') + '.csv';

          showSuccessView(container, {
            title: 'PDF converted to CSV!',
            meta: `CSV sheet: <strong>${outputName}</strong>`,
            icon: 'bi-file-earmark-spreadsheet-fill',
            onDownload: () => downloadBlob(csvBlob, outputName, 'text/csv'),
            onReload: () => initPdfToExcel(container)
          });
        } else {
          // Multiple pages -> Zip of CSVs
          const zip = new JSZip();
          pagesGrid.forEach((grid, pageIdx) => {
            const csvText = gridToCsv(grid);
            const fileName = `${file.name.replace(/\.pdf$/i, '')}_page_${pageIdx + 1}.csv`;
            zip.file(fileName, csvText);
          });

          const zipBlob = await zip.generateAsync({ type: 'blob' });
          progress.progressBar.style.width = '100%';
          const outputName = file.name.replace(/\.pdf$/i, '') + '_csv.zip';

          showSuccessView(container, {
            title: 'PDF converted to CSV Bundle!',
            meta: `CSV archive: <strong>${outputName}</strong>`,
            icon: 'bi-file-earmark-zip-fill',
            onDownload: () => downloadBlob(zipBlob, outputName, 'application/zip'),
            onReload: () => initPdfToExcel(container)
          });
        }
      }
    } catch (err) {
      console.error(err);
      showErrorView(container, err.message, () => initPdfToExcel(container));
    }
  }
}
