import {
  downloadBlob,
  fileToArrayBuffer,
  renderPDFPageToCanvas,
  pdfjsDataFromBuffer
} from '../../lib/utils.js';
import { pdfjsLib } from '../../lib/pdfjs-setup.js';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { createOrganizeUI, loadEtsplLogoBuffer } from './shared.js';

export function initWatermark(container) {
  const ui = createOrganizeUI(container, 'Drag & Drop PDF file here', 'Overlay text or images over pages', 'bi-textarea-t');
  
  let fileBuffer = null;
  let selectedFile = null;
  
  let watermarkImgBuffer = null;
  let watermarkImgType = 'jpeg';

  ui.settingsFields.innerHTML = `
    <div class="form-group">
      <label for="wm-type">Watermark Type</label>
      <select id="wm-type" class="form-control">
        <option value="text">Confidential Text</option>
        <option value="image">Custom Logo/Image</option>
        <option value="etspl">ETSPL Logo</option>
      </select>
    </div>

    <!-- Text Group -->
    <div id="wm-text-group" class="form-group" style="margin-top:0.75rem;">
      <label for="wm-text">Text Stamp</label>
      <input type="text" id="wm-text" class="form-control" value="CONFIDENTIAL">
    </div>

    <!-- Image Group -->
    <div id="wm-image-group" class="form-group" style="margin-top:0.75rem; display:none;">
      <label for="wm-image-input">Upload Watermark Image</label>
      <input type="file" id="wm-image-input" class="form-control" accept="image/jpeg,image/png">
    </div>

    <div class="form-group" style="margin-top:0.75rem;">
      <label for="wm-layout">Watermark Layout</label>
      <select id="wm-layout" class="form-control">
        <option value="center" selected>Centered Single Stamp</option>
        <option value="tiled">Tiled Grid Overlay</option>
      </select>
    </div>

    <div class="form-group" style="margin-top:0.75rem;">
      <label for="wm-angle">Rotation Angle</label>
      <select id="wm-angle" class="form-control">
        <option value="45" selected>45 Degrees</option>
        <option value="30">30 Degrees</option>
        <option value="90">90 Degrees (Vertical)</option>
        <option value="0">0 Degrees (Horizontal)</option>
      </select>
    </div>

    <div class="form-group" style="margin-top:0.75rem;">
      <label for="wm-opacity">Transparency (Opacity)</label>
      <select id="wm-opacity" class="form-control">
        <option value="0.2">High Transparency (20%)</option>
        <option value="0.4">Medium Transparency (40%)</option>
        <option value="0.6">Solid (60%)</option>
      </select>
    </div>

    <div class="form-group" style="margin-top:0.75rem;">
      <label for="wm-size">Watermark Size</label>
      <select id="wm-size" class="form-control">
        <option value="small">Small</option>
        <option value="medium" selected>Medium</option>
        <option value="large">Large</option>
        <option value="xlarge">Extra Large</option>
      </select>
    </div>
  `;

  ui.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
  });

  const wmType = ui.settingsFields.querySelector('#wm-type');
  const textGroup = ui.settingsFields.querySelector('#wm-text-group');
  const imageGroup = ui.settingsFields.querySelector('#wm-image-group');
  const imgFileInput = ui.settingsFields.querySelector('#wm-image-input');

  wmType.addEventListener('change', () => {
    const val = wmType.value;
    textGroup.style.display = val === 'text' ? 'flex' : 'none';
    imageGroup.style.display = val === 'image' ? 'flex' : 'none';
  });

  imgFileInput.addEventListener('change', async (e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      watermarkImgType = file.type === 'image/png' ? 'png' : 'jpeg';
      watermarkImgBuffer = await fileToArrayBuffer(file);
    }
  });

  async function processFile(file) {
    selectedFile = file;
    ui.dropzone.style.display = 'none';
    ui.previewContainer.style.display = 'block';
    ui.fileMeta.innerText = 'Loading...';

    try {
      fileBuffer = await fileToArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: pdfjsDataFromBuffer(fileBuffer) }).promise;
      ui.fileMeta.innerText = `Pages: ${pdf.numPages}`;

      const page = await pdf.getPage(1);
      const canvas = await renderPDFPageToCanvas(page, 0.4, { alpha: false });
      ui.pagesGrid.innerHTML = '';
      ui.pagesGrid.appendChild(canvas);

      ui.runBtn.disabled = false;

    } catch (err) {
      console.error(err);
      ui.fileMeta.innerText = 'Failed to load PDF.';
    }
  }

  ui.runBtn.addEventListener('click', async () => {
    if (!fileBuffer) return;

    const type = wmType.value;
    if (type === 'image' && !watermarkImgBuffer) {
      return alert('Please upload a watermark logo image first.');
    }

    const opacityEl = container.querySelector('#wm-opacity');
    const textEl = container.querySelector('#wm-text');
    const sizeEl = container.querySelector('#wm-size');
    const layoutEl = container.querySelector('#wm-layout');
    const angleEl = container.querySelector('#wm-angle');

    const opacity = opacityEl ? (parseFloat(opacityEl.value) || 0.2) : 0.2;
    const textVal = textEl ? (textEl.value.trim() || 'CONFIDENTIAL') : 'CONFIDENTIAL';
    const sizeVal = sizeEl ? sizeEl.value : 'medium';
    const layoutVal = layoutEl ? layoutEl.value : 'center';
    const angleDeg = angleEl ? (parseFloat(angleEl.value) || 0) : 0;
    const radians = angleDeg * Math.PI / 180;

    container.innerHTML = `
      <div class="workspace-main-panel" style="grid-column: span 2;">
        <div class="processing-container">
          <div class="spinner"></div>
          <p class="processing-text">Stamping watermarks on PDF pages...</p>
        </div>
      </div>
    `;

    try {
      const pdfDoc = await PDFDocument.load(fileBuffer);
      const pages = pdfDoc.getPages();

      if (type === 'text') {
        let fontSize = 48;
        if (sizeVal === 'small') fontSize = 32;
        else if (sizeVal === 'large') fontSize = 72;
        else if (sizeVal === 'xlarge') fontSize = 96;

        const helvetica = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const textWidth = helvetica.widthOfTextAtSize(textVal, fontSize);

        const cos = Math.cos(radians);
        const sin = Math.sin(radians);

        pages.forEach(page => {
          const w = page.getWidth();
          const h = page.getHeight();
          
          if (layoutVal === 'tiled') {
            const cols = 3;
            const rows = 3;
            const xStep = w / (cols + 1);
            const yStep = h / (rows + 1);
            
            for (let r = 1; r <= rows; r++) {
              for (let c = 1; c <= cols; c++) {
                const cx = xStep * c;
                const cy = yStep * r;
                const tx = cx - (textWidth / 4 * cos - (fontSize / 4) * sin);
                const ty = cy - (textWidth / 4 * sin + (fontSize / 4) * cos);
                
                page.drawText(textVal, {
                  x: tx,
                  y: ty,
                  size: fontSize / 2,
                  font: helvetica,
                  color: rgb(0.7, 0.7, 0.7),
                  opacity: opacity,
                  rotate: degrees(angleDeg)
                });
              }
            }
          } else {
            // Centered Stamp
            const x = w / 2 - (textWidth / 2 * cos - fontSize / 2 * sin);
            const y = h / 2 - (textWidth / 2 * sin + fontSize / 2 * cos);

            page.drawText(textVal, {
              x: x,
              y: y,
              size: fontSize,
              font: helvetica,
              color: rgb(0.7, 0.7, 0.7), // Light gray stamp
              opacity: opacity,
              rotate: degrees(angleDeg)
            });
          }
        });
      } else {
        // Image Logo stamp
        let embedImg;
        if (type === 'etspl') {
          const logoBuffer = await loadEtsplLogoBuffer();
          embedImg = await pdfDoc.embedPng(logoBuffer);
        } else if (watermarkImgType === 'png') {
          embedImg = await pdfDoc.embedPng(watermarkImgBuffer);
        } else {
          embedImg = await pdfDoc.embedJpg(watermarkImgBuffer);
        }

        pages.forEach(page => {
          const w = page.getWidth();
          const h = page.getHeight();

          let sizePercent = 0.35;
          if (sizeVal === 'small') sizePercent = 0.15;
          else if (sizeVal === 'large') sizePercent = 0.55;
          else if (sizeVal === 'xlarge') sizePercent = 0.75;

          const scale = (w * sizePercent) / embedImg.width;
          const drawW = embedImg.width * scale;
          const drawH = embedImg.height * scale;

          if (layoutVal === 'tiled') {
            const cols = 3;
            const rows = 3;
            const xStep = w / (cols + 1);
            const yStep = h / (rows + 1);
            
            for (let r = 1; r <= rows; r++) {
              for (let c = 1; c <= cols; c++) {
                const cx = xStep * c;
                const cy = yStep * r;
                
                page.drawImage(embedImg, {
                  x: cx - (drawW / 4),
                  y: cy - (drawH / 4),
                  width: drawW / 2,
                  height: drawH / 2,
                  opacity: opacity,
                  rotate: degrees(angleDeg)
                });
              }
            }
          } else {
            // Centered Image
            page.drawImage(embedImg, {
              x: w / 2 - drawW / 2,
              y: h / 2 - drawH / 2,
              width: drawW,
              height: drawH,
              opacity: opacity,
              rotate: degrees(angleDeg)
            });
          }
        });
      }

      const outputBytes = await pdfDoc.save();
      const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_watermarked.pdf';

      container.innerHTML = `
        <div class="workspace-main-panel" style="grid-column: span 2;">
          <div class="result-success-container">
            <i class="bi bi-textarea-t success-icon text-success"></i>
            <div class="result-info">
              <h3 class="result-title">Watermarks Stamped Successfully!</h3>
              <p class="result-meta">File: <strong>${outputName}</strong></p>
            </div>
            <div style="display: flex; gap: 1rem; margin-top: 1rem;">
              <button id="btn-download-wm" class="btn btn-primary"><i class="bi bi-download"></i> Download PDF</button>
              <button id="btn-wm-again" class="btn btn-secondary"><i class="bi bi-arrow-left"></i> Run Again</button>
            </div>
          </div>
        </div>
      `;

      container.querySelector('#btn-download-wm').addEventListener('click', () => downloadBlob(outputBytes, outputName));
      container.querySelector('#btn-wm-again').addEventListener('click', () => initWatermark(container));

    } catch (err) {
      console.error(err);
      alert('Watermarking Failed: ' + err.message);
      initWatermark(container);
    }
  });
}
