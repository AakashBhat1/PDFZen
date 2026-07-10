import { createConvertUI, showSuccessView, showProgressView, showErrorView, pdfjsLib, fileToArrayBuffer, downloadBlob, renderPDFPageToCanvas, backendStatusFieldHTML, refreshBackendStatus, convertViaBackend } from './convert-shared.js';
import { Document, Paragraph, TextRun, ImageRun, Packer, AlignmentType, HeadingLevel, Table, TableRow, TableCell, WidthType } from 'docx';
import Tesseract from 'tesseract.js';

// ==========================================
// PDF TO WORD — Rich Formatting Extraction
// ==========================================

/**
 * Check if the PDF has selectable text (digital-native) or is scanned.
 */
async function checkIfPDFIsScanned(arrayBuffer) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
    const numPages = pdf.numPages;
    let totalChars = 0;
    
    // Check up to first 5 pages
    const pagesToCheck = Math.min(numPages, 5);
    for (let pageNum = 1; pageNum <= pagesToCheck; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      totalChars += textContent.items.reduce((sum, item) => sum + (item.str ? item.str.length : 0), 0);
    }
    
    const avgCharsPerPage = totalChars / pagesToCheck;
    console.log(`Average characters per page: ${avgCharsPerPage}`);
    return avgCharsPerPage < 15;
  } catch (err) {
    console.error("Error during scanned check:", err);
    return false;
  }
}

/**
 * Extract image data from PDF.js image object.
 */
function extractImageFromObj(imgObj) {
  if (!imgObj || !imgObj.width || !imgObj.height) return null;
  
  const canvas = document.createElement('canvas');
  canvas.width = imgObj.width;
  canvas.height = imgObj.height;
  const ctx = canvas.getContext('2d');
  
  const imgData = ctx.createImageData(imgObj.width, imgObj.height);
  const src = imgObj.data;
  const dest = imgData.data;
  
  if (!src) return null;

  if (src.length === imgObj.width * imgObj.height * 4) {
    dest.set(src);
  } else if (src.length === imgObj.width * imgObj.height * 3) {
    let srcIdx = 0;
    let destIdx = 0;
    for (let i = 0; i < imgObj.width * imgObj.height; i++) {
      dest[destIdx] = src[srcIdx];
      dest[destIdx + 1] = src[srcIdx + 1];
      dest[destIdx + 2] = src[srcIdx + 2];
      dest[destIdx + 3] = 255;
      srcIdx += 3;
      destIdx += 4;
    }
  } else if (src.length === imgObj.width * imgObj.height) {
    let destIdx = 0;
    for (let i = 0; i < src.length; i++) {
      const val = src[i];
      dest[destIdx] = val;
      dest[destIdx + 1] = val;
      dest[destIdx + 2] = val;
      dest[destIdx + 3] = 255;
      destIdx += 4;
    }
  } else {
    let destIdx = 0;
    const bitsPerPixel = Math.floor((src.length * 8) / (imgObj.width * imgObj.height));
    if (bitsPerPixel === 1) {
      for (let i = 0; i < src.length; i++) {
        const byte = src[i];
        for (let bit = 7; bit >= 0; bit--) {
          if (destIdx >= dest.length) break;
          const bitVal = (byte >> bit) & 1;
          const val = bitVal ? 255 : 0;
          dest[destIdx] = val;
          dest[destIdx + 1] = val;
          dest[destIdx + 2] = val;
          dest[destIdx + 3] = 255;
          destIdx += 4;
        }
      }
    } else {
      console.warn("Unsupported image data length:", src.length, "for size:", imgObj.width, "x", imgObj.height);
      return null;
    }
  }
  
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Get all raster images embedded in a PDF page.
 */
async function getPageEmbeddedImages(page) {
  let opList;
  try {
    opList = await page.getOperatorList();
  } catch (err) {
    console.warn("Could not get operator list:", err);
    return [];
  }
  
  const images = [];
  let currentTransform = [1, 0, 0, 1, 0, 0];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === pdfjsLib.OPS.transform) {
      currentTransform = args;
    } else if (fn === pdfjsLib.OPS.paintImageXObject) {
      const imgKey = args[0];
      try {
        const imgObj = page.objs.get(imgKey);
        if (imgObj) {
          const canvas = extractImageFromObj(imgObj);
          if (canvas) {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (blob) {
              const buffer = await blob.arrayBuffer();
              images.push({
                data: new Uint8Array(buffer),
                x: currentTransform[4],
                y: currentTransform[5],
                width: Math.abs(currentTransform[0]),
                height: Math.abs(currentTransform[3])
              });
            }
          }
        }
      } catch (err) {
        console.warn(`Could not extract image ${imgKey}:`, err);
      }
    } else if (fn === pdfjsLib.OPS.paintInlineImageXObject) {
      const imgObj = args[0];
      try {
        const canvas = extractImageFromObj(imgObj);
        if (canvas) {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (blob) {
            const buffer = await blob.arrayBuffer();
            images.push({
              data: new Uint8Array(buffer),
              x: currentTransform[4],
              y: currentTransform[5],
              width: Math.abs(currentTransform[0]),
              height: Math.abs(currentTransform[3])
            });
          }
        }
      } catch (err) {
        console.warn(`Could not extract inline image:`, err);
      }
    }
  }
  return images;
}

/**
 * Extract rich text content and images from a PDF.
 */
async function extractRichPDFContent(arrayBuffer, isScanned, ocrLang, renderBackground, progressCallback) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const numPages = pdf.numPages;
  const pages = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const richItems = [];
    let embeddedImages = [];
    let pageImage = null;

    if (isScanned) {
      if (progressCallback) progressCallback(pageNum, numPages, `Running OCR on page ${pageNum}...`);

      const scale = 2.0; // High resolution for OCR accuracy
      const canvas = await renderPDFPageToCanvas(page, scale);

      // Save full page image for sandwich background (when enabled)
      if (renderBackground) {
        try {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (blob) {
            const imgBuffer = await blob.arrayBuffer();
            pageImage = {
              data: new Uint8Array(imgBuffer),
              width: viewport.width,
              height: viewport.height,
              type: 'png'
            };
          }
        } catch (e) {
          console.warn(`Could not render background image for page ${pageNum}:`, e);
        }
      }

      // Execute OCR via Tesseract
      const result = await Tesseract.recognize(canvas, ocrLang, {
        logger: m => {
          if (m.status === 'recognizing' && progressCallback) {
            progressCallback(pageNum, numPages, `Page ${pageNum}/${numPages}: OCR running... ${Math.floor(m.progress * 100)}%`);
          }
        }
      });

      const canvasHeight = canvas.height;
      if (result.data && result.data.words) {
        for (const word of result.data.words) {
          if (!word.text.trim()) continue;

          // Scale bbox to PDF points and convert Y to bottom-up
          const x = word.bbox.x0 / scale;
          const y = (canvasHeight - word.bbox.y1) / scale;
          const w = (word.bbox.x1 - word.bbox.x0) / scale;
          const h = (word.bbox.y1 - word.bbox.y0) / scale;

          richItems.push({
            text: word.text,
            x,
            y,
            width: w,
            height: h,
            fontSize: h || 12,
            fontFamily: 'Calibri',
            bold: false,
            italic: false,
            fontName: 'Calibri'
          });
        }
      }
    } else {
      if (progressCallback) progressCallback(pageNum, numPages, `Extracting formatting... Page ${pageNum} of ${numPages}`);

      const textContent = await page.getTextContent();

      // Collect all text items with style info
      for (const item of textContent.items) {
        if (!item.str && !item.hasEOL) continue;

        const fontName = item.fontName || '';
        const fontSize = Math.abs(item.transform[0]) || Math.abs(item.transform[3]) || 12;
        const x = item.transform[4];
        const y = item.transform[5];

        // Detect bold/italic from font name heuristics
        const fontNameLower = fontName.toLowerCase();
        const isBold = fontNameLower.includes('bold') || fontNameLower.includes('black') || fontNameLower.includes('heavy');
        const isItalic = fontNameLower.includes('italic') || fontNameLower.includes('oblique');

        // Extract base font family
        let fontFamily = parseFontFamily(fontName);

        richItems.push({
          text: item.str || '',
          x,
          y,
          width: item.width || 0,
          height: item.height || fontSize,
          fontSize,
          fontFamily,
          bold: isBold,
          italic: isItalic,
          fontName,
          hasEOL: item.hasEOL || false
        });
      }

      if (renderBackground) {
        // High-fidelity: rasterize the whole page as a behind-text layer. This
        // captures vectors, colors, and shading that per-image extraction misses,
        // so we skip individual image extraction to avoid duplicating content.
        const bgScale = 2.5;
        const canvas = await renderPDFPageToCanvas(page, bgScale);
        try {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (blob) {
            const imgBuffer = await blob.arrayBuffer();
            pageImage = {
              data: new Uint8Array(imgBuffer),
              width: viewport.width,
              height: viewport.height,
              type: 'png'
            };
          }
        } catch (e) {
          console.warn(`Could not render high-fidelity background for page ${pageNum}:`, e);
        }
      } else {
        // Extract embedded individual raster images.
        // Render page canvas to ensure image objects are populated in page.objs.
        const renderScale = 2.0;
        await renderPDFPageToCanvas(page, renderScale);
        embeddedImages = await getPageEmbeddedImages(page);
      }
    }

    // Group lines and partition them into paragraphs & tables
    const lines = groupIntoLines(richItems);
    const blocks = groupLinesIntoBlocks(lines);

    pages.push({
      blocks,
      embeddedImages,
      pageImage,
      pageWidth: viewport.width,
      pageHeight: viewport.height
    });
  }

  return { pages };
}

/**
 * Parse the base font family from a pdf.js fontName string.
 */
function parseFontFamily(fontName) {
  if (!fontName) return 'Calibri';

  let cleaned = fontName
    .replace(/[-,](Bold|Italic|BoldItalic|Oblique|Regular|Medium|Light|Thin|Black|Heavy|SemiBold|ExtraBold)$/gi, '')
    .replace(/PSMT$/i, '')
    .replace(/MT$/i, '')
    .replace(/-?(Bold|Italic|BoldItalic|Oblique|Regular)$/gi, '')
    .replace(/[_+].*$/, '');

  cleaned = cleaned.replace(/^[A-Z]{6}\+/, '');

  const fontMap = {
    'timesnewroman': 'Times New Roman',
    'times': 'Times New Roman',
    'arial': 'Arial',
    'helvetica': 'Arial',
    'courier': 'Courier New',
    'couriernew': 'Courier New',
    'calibri': 'Calibri',
    'cambria': 'Cambria',
    'georgia': 'Georgia',
    'verdana': 'Verdana',
    'tahoma': 'Tahoma',
    'trebuchet': 'Trebuchet MS',
    'trebuchetms': 'Trebuchet MS',
    'palatino': 'Palatino Linotype',
    'garamond': 'Garamond',
    'bookman': 'Bookman Old Style',
    'comicsans': 'Comic Sans MS',
    'impact': 'Impact',
    'lucida': 'Lucida Sans',
    'symbol': 'Symbol',
    'wingdings': 'Wingdings'
  };

  const lookupKey = cleaned.toLowerCase().replace(/\s/g, '');
  if (fontMap[lookupKey]) return fontMap[lookupKey];

  const spaced = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  if (spaced.length > 1 && !spaced.startsWith('g_')) return spaced;

  return 'Calibri';
}

/**
 * Group text items into lines by clustering Y-coordinates.
 */
function groupIntoLines(items) {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > 3) return yDiff;
    return a.x - b.x;
  });

  const lines = [];
  let currentLine = { y: sorted[0].y, items: [sorted[0]] };

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(item.y - currentLine.y) <= 3) {
      currentLine.items.push(item);
    } else {
      currentLine.items.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
      currentLine = { y: item.y, items: [item] };
    }
  }

  currentLine.items.sort((a, b) => a.x - b.x);
  lines.push(currentLine);

  return lines;
}

/**
 * Check if a line starts with a list marker (number or bullet).
 */
function startsWithListMarker(line) {
  if (line.chunks.length === 0 || line.chunks[0].items.length === 0) return false;
  const firstText = line.chunks[0].items[0].text.trim();
  return /^\d+\./.test(firstText) || /^[•\-*]/.test(firstText);
}

/**
 * Group lines into Paragraph or Table blocks based on coordinates and structure.
 */
function groupLinesIntoBlocks(lines) {
  if (lines.length === 0) return [];

  // 1. Group items on each line into horizontal chunks (columns)
  const lineChunks = [];
  for (const line of lines) {
    const chunks = [];
    let currentChunk = null;
    for (const item of line.items) {
      if (!currentChunk) {
        currentChunk = { items: [item], left: item.x, right: item.x + item.width };
      } else {
        const gap = item.x - currentChunk.right;
        // Merge items into same column chunk if gap is small (< 20pt)
        if (gap < 20) {
          currentChunk.items.push(item);
          currentChunk.right = Math.max(currentChunk.right, item.x + item.width);
        } else {
          chunks.push(currentChunk);
          currentChunk = { items: [item], left: item.x, right: item.x + item.width };
        }
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    lineChunks.push({
      y: line.y,
      chunks: chunks
    });
  }

  // 2. Partition lineChunks into Blocks (Paragraph or Table)
  const blocks = [];
  let currentBlock = null;

  for (let i = 0; i < lineChunks.length; i++) {
    const line = lineChunks[i];
    const startsWithList = startsWithListMarker(line);
    const isMultiColumn = line.chunks.length > 1;

    if (isMultiColumn) {
      if (currentBlock && currentBlock.type === 'table') {
        currentBlock.lines.push(line);
      } else {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: 'table', lines: [line] };
      }
    } else {
      // Single column line
      if (startsWithList) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: 'paragraph', lines: [line] };
      } else {
        // standard paragraph or trailing block of table
        const nextLine = lineChunks[i + 1];
        const nextIsMulti = nextLine && nextLine.chunks.length > 1;
        
        if (currentBlock && currentBlock.type === 'table' && nextIsMulti) {
          currentBlock.lines.push(line);
        } else {
          if (currentBlock && currentBlock.type === 'paragraph') {
            const lastLine = currentBlock.lines[currentBlock.lines.length - 1];
            const gap = Math.abs(lastLine.y - line.y);
            if (gap < 25) {
              currentBlock.lines.push(line);
            } else {
              blocks.push(currentBlock);
              currentBlock = { type: 'paragraph', lines: [line] };
            }
          } else {
            if (currentBlock) blocks.push(currentBlock);
            currentBlock = { type: 'paragraph', lines: [line] };
          }
        }
      }
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  // Set y coordinates for layout sorting
  blocks.forEach(b => {
    b.y = b.lines.length > 0 ? b.lines[0].y : 0;
  });

  return blocks;
}

/**
 * Determine if a paragraph looks like a heading.
 */
function detectHeadingLevel(paragraph, globalMedianFontSize) {
  const allItems = paragraph.lines.flatMap(l => l.chunks.flatMap(c => c.items));
  if (allItems.length === 0) return null;

  const avgFontSize = allItems.reduce((s, i) => s + i.fontSize, 0) / allItems.length;
  const allBold = allItems.every(i => i.bold);
  const totalText = allItems.map(i => i.text).join('').trim();

  if (totalText.length > 120) return null;

  const sizeRatio = avgFontSize / globalMedianFontSize;

  if (sizeRatio >= 1.8 && allBold) return HeadingLevel.HEADING_1;
  if (sizeRatio >= 1.4 && allBold) return HeadingLevel.HEADING_2;
  if (sizeRatio >= 1.15 && allBold) return HeadingLevel.HEADING_3;
  if (allBold && totalText.length < 60) return HeadingLevel.HEADING_4;

  return null;
}

/**
 * Build docx TextRun objects from a line's items.
 */
function buildTextRuns(lineItems) {
  if (lineItems.length === 0) return [new TextRun('')];

  const runs = [];
  let currentRun = null;

  for (const item of lineItems) {
    if (!item.text) continue;

    const sameStyle = currentRun &&
      currentRun.bold === item.bold &&
      currentRun.italic === item.italic &&
      currentRun.fontFamily === item.fontFamily &&
      Math.abs(currentRun.fontSize - item.fontSize) < 1;

    if (sameStyle) {
      const gap = item.x - (currentRun.lastX + currentRun.lastWidth);
      if (gap > item.fontSize * 0.3) {
        currentRun.text += ' ';
      }
      currentRun.text += item.text;
      currentRun.lastX = item.x;
      currentRun.lastWidth = item.width;
    } else {
      if (currentRun && currentRun.text.trim()) {
        runs.push(createTextRun(currentRun));
      }
      currentRun = {
        text: item.text,
        bold: item.bold,
        italic: item.italic,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        lastX: item.x,
        lastWidth: item.width
      };
    }
  }

  if (currentRun && currentRun.text.trim()) {
    runs.push(createTextRun(currentRun));
  }

  return runs.length > 0 ? runs : [new TextRun('')];
}

/**
 * Create a docx TextRun with proper formatting.
 */
function createTextRun(runData) {
  const halfPtSize = Math.round(runData.fontSize * 2);

  return new TextRun({
    text: runData.text,
    bold: runData.bold || undefined,
    italics: runData.italic || undefined,
    size: halfPtSize > 0 ? halfPtSize : 24,
    font: runData.fontFamily || 'Calibri'
  });
}

/**
 * Calculate the global median font size across all pages.
 */
function getGlobalMedianFontSize(pages) {
  const allSizes = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.type === 'paragraph') {
        for (const line of block.lines) {
          for (const chunk of line.chunks) {
            for (const item of chunk.items) {
              if (item.text.trim()) allSizes.push(item.fontSize);
            }
          }
        }
      }
    }
  }
  if (allSizes.length === 0) return 12;
  allSizes.sort((a, b) => a - b);
  return allSizes[Math.floor(allSizes.length / 2)];
}

// ==========================================
// Main Init Function
// ==========================================
export function initPdfToWord(container) {
  const ui = createConvertUI(container, {
    title: 'Drag & Drop PDF file here',
    subtitle: 'Convert to Microsoft Word (.docx) with preserved formatting',
    inputType: 'pdf',
    icon: 'bi-file-pdf',
    fileIcon: 'bi-filetype-docx',
    multiple: false,
    settingsHTML: `
      <div class="form-group">
        <label for="pdf-word-mode">Conversion Mode</label>
        <select id="pdf-word-mode" class="form-control">
          <option value="rich">Rich Text (Preserves formatting)</option>
          <option value="image">Image-Based (Full page fidelity)</option>
        </select>
        <span class="form-help" style="margin-top: 0.4rem; display: block;">
          <strong>Rich Text</strong>: Extracts text with bold, italic, fonts, and sizing.<br>
          <strong>Image-Based</strong>: Renders each page as a high-res image in Word for pixel-perfect output.
        </span>
      </div>
      <div class="form-group" id="ocr-lang-group" style="margin-top: 1rem;">
        <label for="pdf-word-ocr-lang">OCR Language (if Scanned PDF)</label>
        <select id="pdf-word-ocr-lang" class="form-control">
          <option value="eng" selected>English (eng)</option>
          <option value="spa">Spanish (spa)</option>
          <option value="fra">French (fra)</option>
          <option value="deu">German (deu)</option>
        </select>
      </div>
      <div class="form-group" id="ocr-bg-group" style="margin-top: 1rem; display: flex; align-items: center; gap: 0.5rem;">
        <input type="checkbox" id="pdf-word-ocr-bg" checked style="width: auto; margin-bottom: 0;">
        <label for="pdf-word-ocr-bg" style="margin-bottom: 0; cursor: pointer;">Preserve scan background (sandwich layout)</label>
      </div>
      <div class="form-group" id="hifi-group" style="margin-top: 1rem; display: flex; align-items: center; gap: 0.5rem;">
        <input type="checkbox" id="pdf-word-hifi" style="width: auto; margin-bottom: 0;">
        <label for="pdf-word-hifi" style="margin-bottom: 0; cursor: pointer;">High-fidelity: embed page image behind text (larger file, preserves vectors/colors)</label>
      </div>
      ${backendStatusFieldHTML()}
    `
  });

  let fileBuffer = null;
  let file = null;

  const modeSelect = container.querySelector('#pdf-word-mode');
  const ocrLangGroup = container.querySelector('#ocr-lang-group');
  const ocrBgGroup = container.querySelector('#ocr-bg-group');
  const hifiGroup = container.querySelector('#hifi-group');

  modeSelect.addEventListener('change', () => {
    const isRich = modeSelect.value === 'rich';
    if (ocrLangGroup) ocrLangGroup.style.display = isRich ? 'block' : 'none';
    if (ocrBgGroup) ocrBgGroup.style.display = isRich ? 'flex' : 'none';
    if (hifiGroup) hifiGroup.style.display = isRich ? 'flex' : 'none';
  });

  refreshBackendStatus(container);

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  ui.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); ui.dropzone.classList.add('dragover'); });
  ui.dropzone.addEventListener('dragleave', () => { ui.dropzone.classList.remove('dragover'); });
  ui.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    ui.dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) processFile(e.dataTransfer.files[0]);
  });

  async function processFile(f) {
    file = f;
    ui.dropzone.style.display = 'none';
    ui.preview.style.display = 'block';
    ui.fileName.innerText = file.name;
    ui.fileMeta.innerText = 'File selected. Ready to convert.';
    ui.runBtn.disabled = false;
    fileBuffer = await fileToArrayBuffer(file);
    // Double check backend on file select
    refreshBackendStatus(container);
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;

    const mode = container.querySelector('#pdf-word-mode').value;
    const ocrLang = container.querySelector('#pdf-word-ocr-lang').value;
    const ocrBg = container.querySelector('#pdf-word-ocr-bg').checked;
    const hiFi = container.querySelector('#pdf-word-hifi').checked;

    const backend = await refreshBackendStatus(container);

    if (backend.ok && mode === 'rich') {
      const outputName = file.name.replace(/\.pdf$/i, '') + '.docx';
      await convertViaBackend(container, file, {
        endpoint: '/convert/pdf-to-word',
        outName: outputName,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        title: 'PDF Converted to Word (High Quality)!',
        meta: `Word document: <strong>${outputName}</strong> — Converted via local Python engine (pdf2docx)`,
        icon: 'bi-file-earmark-word-fill',
        progressText: 'Converting layout (running pdf2docx)...',
        onReload: () => initPdfToWord(container)
      });
    } else if (mode === 'image') {
      await convertImageBased(container, file, fileBuffer);
    } else {
      await convertRichText(container, file, fileBuffer, ocrLang, ocrBg, hiFi);
    }
  });
}

/**
 * Rich Text conversion — extracts formatting/images and creates styled docx.
 */
async function convertRichText(container, file, fileBuffer, ocrLang = 'eng', ocrBg = true, hiFi = false) {
  const progress = showProgressView(container, 'Analyzing PDF structure...');

  try {
    // 1. Check if scanned or digital
    const isScanned = await checkIfPDFIsScanned(fileBuffer);
    if (isScanned) {
      progress.progressText.innerText = 'Scanned PDF detected. Preparing client-side OCR engine...';
    } else {
      progress.progressText.innerText = 'Digital-Native PDF detected. Extracting formatting...';
    }

    // 2. Extract rich content and images. For scanned PDFs the page raster is
    // the OCR "sandwich" background (gated by ocrBg); for digital PDFs the same
    // technique is opt-in via the high-fidelity checkbox (preserves vectors/colors).
    const renderBackground = isScanned ? ocrBg : hiFi;
    const content = await extractRichPDFContent(fileBuffer, isScanned, ocrLang, renderBackground, (current, total, statusText) => {
      progress.progressText.innerText = statusText || `Processing Page ${current} of ${total}...`;
      progress.progressBar.style.width = `${10 + (current / total) * 60}%`;
    });

    // 3. Calculate global median font size for heading detection
    const medianFontSize = getGlobalMedianFontSize(content.pages);

    // 4. Build docx sections
    progress.progressText.innerText = 'Building Word document...';
    progress.progressBar.style.width = '75%';

    const docChildren = [];

    content.pages.forEach((page, pageIdx) => {
      // 4a. If a page raster was captured (scan sandwich, or high-fidelity digital),
      // place it behind the text layer.
      if (page.pageImage) {
        docChildren.push(new Paragraph({
          children: [
            new ImageRun({
              data: page.pageImage.data,
              type: 'png',
              transformation: {
                width: page.pageWidth * 1.33,
                height: page.pageHeight * 1.33
              },
              floating: {
                horizontalPosition: {
                  offset: 0
                },
                verticalPosition: {
                  offset: 0
                },
                wrap: {
                  type: 'none'
                },
                behindText: true
              }
            })
          ]
        }));
      }

      // 4b. Merge text blocks and embedded images, then sort by Y coordinate descending (top-to-bottom)
      const elements = [];
      page.blocks.forEach(block => {
        elements.push({ type: block.type, data: block, y: block.y });
      });
      if (page.embeddedImages) {
        page.embeddedImages.forEach(img => {
          elements.push({ type: 'image', data: img, y: img.y + img.height });
        });
      }

      elements.sort((a, b) => b.y - a.y);

      // 4c. Process sorted elements
      elements.forEach(el => {
        if (el.type === 'paragraph') {
          const para = el.data;
          const headingLevel = detectHeadingLevel(para, medianFontSize);

          const allRuns = [];
          let lastRunText = "";

          para.lines.forEach((line) => {
            const lineItems = line.chunks.flatMap(c => c.items);
            const runs = buildTextRuns(lineItems);
            if (runs.length === 0) return;

            // Add a space between lines to enable flowable wrapping in Word
            if (allRuns.length > 0 && lineItems.length > 0) {
              const firstItemText = lineItems[0].text;
              if (lastRunText && !lastRunText.endsWith(' ') && !firstItemText.startsWith(' ')) {
                allRuns.push(new TextRun(' '));
                lastRunText = ' ';
              }
            }

            allRuns.push(...runs);
            if (lineItems.length > 0) {
              lastRunText = lineItems[lineItems.length - 1].text;
            }
          });

          const paragraphOptions = {
            children: allRuns
          };

          if (headingLevel) {
            paragraphOptions.heading = headingLevel;
          }

          docChildren.push(new Paragraph(paragraphOptions));
        } else if (el.type === 'table') {
          const tableBlock = el.data;
          
          // Get all column bands across the table block's lines
          const columns = [];
          tableBlock.lines.forEach(line => {
            line.chunks.forEach(chunk => {
              let matchedCol = null;
              for (const col of columns) {
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
            });
          });
          
          // Sort columns left-to-right
          columns.sort((a, b) => a.left - b.left);
          
          // Build table rows
          const tableRows = [];
          tableBlock.lines.forEach(line => {
            const rowCells = new Array(columns.length).fill(null).map(() => []);
            line.chunks.forEach(chunk => {
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
              rowCells[bestColIdx].push(chunk);
            });
            
            const rowChildren = [];
            for (let j = 0; j < columns.length; j++) {
              const cellParagraphs = [];
              const cellChunks = rowCells[j];
              
              cellChunks.forEach(chunk => {
                const runs = buildTextRuns(chunk.items);
                cellParagraphs.push(new Paragraph({ children: runs }));
              });
              
              if (cellParagraphs.length === 0) {
                cellParagraphs.push(new Paragraph(''));
              }
              
              rowChildren.push(new TableCell({
                children: cellParagraphs,
                width: {
                  size: Math.round((columns[j].right - columns[j].left) * 20), // twips (DXA)
                  type: WidthType.DXA
                }
              }));
            }
            
            tableRows.push(new TableRow({
              children: rowChildren
            }));
          });
          
          docChildren.push(new Table({
            rows: tableRows,
            width: {
              size: 100,
              type: WidthType.PERCENTAGE
            }
          }));
        } else if (el.type === 'image') {
          const img = el.data;
          
          const maxPrintableWidth = page.pageWidth - 144;
          let imgW = img.width;
          let imgH = img.height;
          if (imgW > maxPrintableWidth) {
            const ratio = maxPrintableWidth / imgW;
            imgW = maxPrintableWidth;
            imgH = imgH * ratio;
          }

          const imgWidthPx = Math.round(imgW * 1.33);
          const imgHeightPx = Math.round(imgH * 1.33);

          // Smart horizontal alignment based on position
          let alignment = AlignmentType.CENTER;
          const imgMidX = img.x + img.width / 2;
          if (imgMidX < page.pageWidth / 3) {
            alignment = AlignmentType.LEFT;
          } else if (imgMidX > (page.pageWidth * 2) / 3) {
            alignment = AlignmentType.RIGHT;
          }

          docChildren.push(new Paragraph({
            children: [
              new ImageRun({
                type: 'png',
                data: img.data,
                transformation: {
                  width: imgWidthPx,
                  height: imgHeightPx
                }
              })
            ],
            alignment: alignment
          }));
        }
      });

      // Page break between pages (not after last)
      if (pageIdx < content.pages.length - 1) {
        docChildren.push(new Paragraph({
          children: [],
          pageBreakBefore: true
        }));
      }
    });

    // 5. Create document
    progress.progressText.innerText = 'Packaging document...';
    progress.progressBar.style.width = '90%';

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: 1080,
              bottom: 1080,
              left: 1080,
              right: 1080
            }
          }
        },
        children: docChildren
      }]
    });

    // 6. Save
    const docxBlob = await Packer.toBlob(doc);
    progress.progressBar.style.width = '100%';

    const outputName = file.name.replace(/\.pdf$/i, '') + '.docx';
    showSuccessView(container, {
      title: isScanned ? 'PDF Converted via OCR!' : 'PDF Converted to Word!',
      meta: isScanned 
        ? `Word document generated with OCR: <strong>${outputName}</strong>`
        : `Word document with formatting and images: <strong>${outputName}</strong>`,
      icon: 'bi-file-earmark-word-fill',
      onDownload: () => downloadBlob(docxBlob, outputName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      onReload: () => initPdfToWord(container)
    });

  } catch (err) {
    console.error(err);
    showErrorView(container, err.message, () => initPdfToWord(container));
  }
}

/**
 * Image-Based conversion — renders each PDF page as a high-res image and embeds into Word.
 */
async function convertImageBased(container, file, fileBuffer) {
  const progress = showProgressView(container, 'Rendering PDF pages...');

  try {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer.slice(0)) }).promise;
    const numPages = pdf.numPages;
    const docChildren = [];

    for (let i = 1; i <= numPages; i++) {
      progress.progressText.innerText = `Rendering page ${i} of ${numPages}...`;
      progress.progressBar.style.width = `${10 + (i / numPages) * 70}%`;

      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = await renderPDFPageToCanvas(page, 2.5);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const imgBuffer = await blob.arrayBuffer();

      const targetWidthPx = 600;
      const aspectRatio = viewport.height / viewport.width;
      const targetHeightPx = Math.round(targetWidthPx * aspectRatio);

      docChildren.push(new Paragraph({
        children: [
          new ImageRun({
            type: 'png',
            data: new Uint8Array(imgBuffer),
            transformation: {
              width: targetWidthPx,
              height: targetHeightPx
            }
          })
        ],
        alignment: AlignmentType.CENTER
      }));

      if (i < numPages) {
        docChildren.push(new Paragraph({
          children: [],
          pageBreakBefore: true
        }));
      }
    }

    progress.progressText.innerText = 'Packaging Word document...';
    progress.progressBar.style.width = '90%';

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: 360,
              bottom: 360,
              left: 360,
              right: 360
            }
          }
        },
        children: docChildren
      }]
    });

    const docxBlob = await Packer.toBlob(doc);
    progress.progressBar.style.width = '100%';

    const outputName = file.name.replace(/\.pdf$/i, '') + '.docx';
    showSuccessView(container, {
      title: 'PDF Converted to Word (Image Mode)!',
      meta: `Word document: <strong>${outputName}</strong> — Pages rendered as high-res images`,
      icon: 'bi-file-earmark-word-fill',
      onDownload: () => downloadBlob(docxBlob, outputName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      onReload: () => initPdfToWord(container)
    });

  } catch (err) {
    console.error(err);
    showErrorView(container, err.message, () => initPdfToWord(container));
  }
}
