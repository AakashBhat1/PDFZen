import { createConvertUI, showSuccessView, showProgressView, showErrorView, pdfjsLib, fileToArrayBuffer, downloadBlob, renderPDFPageToCanvas } from './convert-shared.js';
import { Document, Paragraph, TextRun, ImageRun, Packer, AlignmentType, HeadingLevel, PageBreak } from 'docx';

// ==========================================
// PDF TO WORD — Rich Formatting Extraction
// ==========================================

/**
 * Extract rich text content from a PDF with font style information.
 * Uses pdf.js getTextContent() to read per-item font data (bold, italic, size, family).
 */
async function extractRichPDFContent(arrayBuffer, progressCallback) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const numPages = pdf.numPages;
  const pages = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (progressCallback) progressCallback(pageNum, numPages);

    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });

    // --- 1. Collect all text items with style info ---
    const richItems = [];
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

    // --- 2. Group items into lines by Y-coordinate clustering ---
    const lines = groupIntoLines(richItems);

    // --- 3. Detect paragraph breaks by analyzing Y-gaps ---
    const paragraphs = groupIntoParagraphs(lines, viewport.height);

    // --- 4. Extract page images via canvas rendering ---
    let pageImage = null;
    try {
      const scale = 2.0;
      const canvas = await renderPDFPageToCanvas(page, scale);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (blob) {
        const imgBuffer = await blob.arrayBuffer();
        pageImage = {
          data: new Uint8Array(imgBuffer),
          width: Math.round(viewport.width * scale),
          height: Math.round(viewport.height * scale),
          type: 'png'
        };
      }
    } catch (e) {
      // Image extraction is best-effort
      console.warn(`Could not render page ${pageNum} image:`, e);
    }

    pages.push({ paragraphs, pageImage, pageWidth: viewport.width, pageHeight: viewport.height });
  }

  return { pages };
}

/**
 * Parse the base font family from a pdf.js fontName string.
 * e.g. "TimesNewRomanPSMT" → "Times New Roman"
 *      "ArialMT-Bold" → "Arial"
 *      "g_d0_f1" → "Calibri" (fallback)
 */
function parseFontFamily(fontName) {
  if (!fontName) return 'Calibri';

  // Strip common suffixes
  let cleaned = fontName
    .replace(/[-,](Bold|Italic|BoldItalic|Oblique|Regular|Medium|Light|Thin|Black|Heavy|SemiBold|ExtraBold)$/gi, '')
    .replace(/PSMT$/i, '')
    .replace(/MT$/i, '')
    .replace(/-?(Bold|Italic|BoldItalic|Oblique|Regular)$/gi, '')
    .replace(/[_+].*$/, ''); // Strip subset prefixes like "ABCDEF+"

  // If it starts with a subset prefix (e.g., "BCDXYZ+"), strip it
  cleaned = cleaned.replace(/^[A-Z]{6}\+/, '');

  // Known font name mappings
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

  // Insert spaces before uppercase letters in CamelCase names
  const spaced = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  if (spaced.length > 1 && !spaced.startsWith('g_')) return spaced;

  return 'Calibri'; // Safe fallback
}

/**
 * Group text items into lines by clustering Y-coordinates.
 * Items within a Y-tolerance of 3pt are considered the same line.
 */
function groupIntoLines(items) {
  if (items.length === 0) return [];

  // Sort by Y descending (top of page first), then X ascending
  const sorted = [...items].sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > 3) return yDiff;
    return a.x - b.x;
  });

  const lines = [];
  let currentLine = { y: sorted[0].y, items: [sorted[0]] };

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    // If within Y-tolerance, add to current line
    if (Math.abs(item.y - currentLine.y) <= 3) {
      currentLine.items.push(item);
    } else {
      // Sort current line items left-to-right and push
      currentLine.items.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
      currentLine = { y: item.y, items: [item] };
    }
  }

  // Push last line
  currentLine.items.sort((a, b) => a.x - b.x);
  lines.push(currentLine);

  return lines;
}

/**
 * Group lines into paragraphs by detecting large Y-gaps.
 * A gap larger than 1.5x the median line height signals a new paragraph.
 */
function groupIntoParagraphs(lines) {
  if (lines.length === 0) return [];

  // Calculate gaps between consecutive lines
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = Math.abs(lines[i - 1].y - lines[i].y);
    gaps.push(gap);
  }

  // Calculate median gap (typical line spacing)
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 14;

  // Threshold: gap > 1.5x median means paragraph break
  const paragraphThreshold = medianGap * 1.5;

  const paragraphs = [];
  let currentPara = { lines: [lines[0]] };

  for (let i = 1; i < lines.length; i++) {
    const gap = gaps[i - 1];
    if (gap > paragraphThreshold) {
      paragraphs.push(currentPara);
      currentPara = { lines: [lines[i]] };
    } else {
      currentPara.lines.push(lines[i]);
    }
  }
  paragraphs.push(currentPara);

  return paragraphs;
}

/**
 * Determine if a paragraph looks like a heading based on its text items.
 * Heuristics: short text + larger font size + bold.
 */
function detectHeadingLevel(paragraph, globalMedianFontSize) {
  const allItems = paragraph.lines.flatMap(l => l.items);
  if (allItems.length === 0) return null;

  const avgFontSize = allItems.reduce((s, i) => s + i.fontSize, 0) / allItems.length;
  const allBold = allItems.every(i => i.bold);
  const totalText = allItems.map(i => i.text).join('').trim();

  // Skip very long text (not a heading)
  if (totalText.length > 120) return null;

  const sizeRatio = avgFontSize / globalMedianFontSize;

  if (sizeRatio >= 1.8 && allBold) return HeadingLevel.HEADING_1;
  if (sizeRatio >= 1.4 && allBold) return HeadingLevel.HEADING_2;
  if (sizeRatio >= 1.15 && allBold) return HeadingLevel.HEADING_3;
  if (allBold && totalText.length < 60) return HeadingLevel.HEADING_4;

  return null;
}

/**
 * Build docx TextRun objects from a line's items, merging adjacent items with same styles.
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
      // Check if there's a gap between items (add space)
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
  // docx sizes are in half-points, so multiply PDF pt by 2
  const halfPtSize = Math.round(runData.fontSize * 2);

  return new TextRun({
    text: runData.text,
    bold: runData.bold || undefined,
    italics: runData.italic || undefined,
    size: halfPtSize > 0 ? halfPtSize : 24, // default 12pt = 24 half-pt
    font: runData.fontFamily || 'Calibri'
  });
}

/**
 * Calculate the global median font size across all pages for heading detection.
 */
function getGlobalMedianFontSize(pages) {
  const allSizes = [];
  for (const page of pages) {
    for (const para of page.paragraphs) {
      for (const line of para.lines) {
        for (const item of line.items) {
          if (item.text.trim()) allSizes.push(item.fontSize);
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
    `
  });

  let fileBuffer = null;
  let file = null;

  ui.dropzone.addEventListener('click', () => ui.fileInput.click());
  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  // Drag & drop support
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
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!file || !fileBuffer) return;

    const mode = container.querySelector('#pdf-word-mode').value;

    if (mode === 'image') {
      await convertImageBased(container, file, fileBuffer);
    } else {
      await convertRichText(container, file, fileBuffer);
    }
  });
}

/**
 * Rich Text conversion — extracts formatting from PDF and creates styled docx.
 */
async function convertRichText(container, file, fileBuffer) {
  const progress = showProgressView(container, 'Analyzing PDF structure...');

  try {
    // 1. Extract rich content
    const content = await extractRichPDFContent(fileBuffer, (current, total) => {
      progress.progressText.innerText = `Extracting formatting... Page ${current} of ${total}`;
      progress.progressBar.style.width = `${10 + (current / total) * 55}%`;
    });

    // 2. Calculate global median font size for heading detection
    const medianFontSize = getGlobalMedianFontSize(content.pages);

    // 3. Build docx sections
    progress.progressText.innerText = 'Building Word document...';
    progress.progressBar.style.width = '70%';

    const docChildren = [];

    content.pages.forEach((page, pageIdx) => {
      page.paragraphs.forEach(para => {
        // Detect heading level
        const headingLevel = detectHeadingLevel(para, medianFontSize);

        // Build text runs for all lines in this paragraph
        const allRuns = [];
        para.lines.forEach((line, lineIdx) => {
          const runs = buildTextRuns(line.items);
          allRuns.push(...runs);

          // Add soft line break between lines within same paragraph (not after last)
          if (lineIdx < para.lines.length - 1) {
            allRuns.push(new TextRun({ break: 1 }));
          }
        });

        const paragraphOptions = {
          children: allRuns
        };

        if (headingLevel) {
          paragraphOptions.heading = headingLevel;
        }

        docChildren.push(new Paragraph(paragraphOptions));
      });

      // Page break between pages (not after last)
      if (pageIdx < content.pages.length - 1) {
        docChildren.push(new Paragraph({
          children: [],
          pageBreakBefore: true
        }));
      }
    });

    // 4. Create document
    progress.progressText.innerText = 'Packaging document...';
    progress.progressBar.style.width = '90%';

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: 720,    // 0.5 inch in twips
              bottom: 720,
              left: 1080,  // 0.75 inch
              right: 1080
            }
          }
        },
        children: docChildren
      }]
    });

    // 5. Save
    const docxBlob = await Packer.toBlob(doc);
    progress.progressBar.style.width = '100%';

    const outputName = file.name.replace(/\.pdf$/i, '') + '.docx';
    showSuccessView(container, {
      title: 'PDF Converted to Word!',
      meta: `Word document with formatting: <strong>${outputName}</strong>`,
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
 * This gives pixel-perfect output but text is not editable.
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
      const viewport = page.getViewport({ scale: 2.5 }); // High resolution
      const canvas = await renderPDFPageToCanvas(page, 2.5);

      // Convert canvas to PNG blob
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const imgBuffer = await blob.arrayBuffer();

      // Calculate dimensions to fit A4 page width (595pt ≈ ~7.5in at 72dpi)
      // In docx, image dimensions are in EMU (English Metric Units) or pixels
      // We'll use the page width minus margins (~6 inches = 432pt at 72dpi)
      const targetWidthPx = 600; // pixels in the docx
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

      // Page break between pages
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
