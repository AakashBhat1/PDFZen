import { createConvertUI, showSuccessView, showProgressView, showErrorView, fileToArrayBuffer, downloadBlob, objectUrlManager } from './convert-shared.js';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

// ==========================================
// JPG / PNG / CBZ TO PDF
// ==========================================

/**
 * Ensure image is PNG or JPG for pdf-lib compatibility.
 * Converts WebP or other browser-supported formats to PNG using a canvas.
 */
async function ensurePngOrJpg(item) {
  if (item.file.type === 'image/png' || item.file.type === 'image/jpeg' || item.file.type === 'image/jpg') {
    return item;
  }
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([item.arrayBuffer], { type: item.file.type });
    const url = URL.createObjectURL(blob);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (pngBlob) => {
        if (!pngBlob) {
          reject(new Error('Failed to convert image to PNG'));
          return;
        }
        const buffer = await pngBlob.arrayBuffer();
        resolve({
          ...item,
          file: { name: item.name.replace(/\.[^/.]+$/, '') + '.png', type: 'image/png' },
          arrayBuffer: buffer
        });
      }, 'image/png');
    };
    
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for conversion'));
    };
    
    img.src = url;
  });
}

export function initJpgToPdf(container) {
  objectUrlManager.revokeAll();
  let images = []; // Array of { id, file, base64/buffer, name, sizeFormatted }
  let imageCounter = 0;

  const ui = createConvertUI(container, {
    title: 'Drag & Drop JPG/PNG images or Comic Book (.cbz) here',
    subtitle: 'Convert images and comic book archives to PDF in seconds. Easily adjust layout settings.',
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

  // Adjust input elements to accept .cbz files
  ui.fileInput.accept = 'image/jpeg,image/png,image/webp,application/x-cbz,.cbz';

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
      const isCbz = /\.cbz$/i.test(file.name) || file.type === 'application/x-cbz';
      
      if (isCbz) {
        try {
          const zip = await JSZip.loadAsync(file);
          const imgEntries = [];
          
          zip.forEach((relativePath, entry) => {
            if (!entry.dir && /\.(jpe?g|png|webp)$/i.test(entry.name)) {
              imgEntries.push(entry);
            }
          });

          // Sort image entries sequentially by file name
          imgEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

          for (const entry of imgEntries) {
            const buffer = await entry.async('arraybuffer');
            const isPng = /\.png$/i.test(entry.name);
            const isWebp = /\.webp$/i.test(entry.name);
            
            let mimeType = 'image/jpeg';
            if (isPng) mimeType = 'image/png';
            if (isWebp) mimeType = 'image/webp';

            const blob = new Blob([buffer], { type: mimeType });
            const url = objectUrlManager.create(blob);

            images.push({
              id: imageCounter++,
              file: { name: entry.name, type: mimeType },
              arrayBuffer: buffer,
              name: entry.name,
              url: url
            });
          }
        } catch (e) {
          console.error(e);
          alert(`Failed to load CBZ comic archive: ${e.message}`);
        }
      } else if (file.type.startsWith('image/')) {
        const buffer = await fileToArrayBuffer(file);
        const url = objectUrlManager.create(file);
        
        images.push({
          id: imageCounter++,
          file: file,
          arrayBuffer: buffer,
          name: file.name,
          url: url
        });
      }
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
    ui.fileMeta.innerText = `Uploaded: ${images.length} image(s) / frames`;

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
    if (item) objectUrlManager.revoke(item.url);
    images = images.filter(img => img.id !== id);
    updateImageGrid();
  }

  ui.runBtn.addEventListener('click', async () => {
    if (images.length === 0) return;
    const progress = showProgressView(container, 'Loading PDF creation engine...');

    try {
      const pdfDoc = await PDFDocument.create();
      
      const pageSizeSelect = container.querySelector('#jpg-layout-size').value;
      const orientSelect = container.querySelector('#jpg-layout-orient').value;
      const marginSelect = container.querySelector('#jpg-layout-margin').value;

      // Map margins
      let margin = 0;
      if (marginSelect === 'small') margin = 20;
      if (marginSelect === 'large') margin = 40;

      for (let i = 0; i < images.length; i++) {
        let item = images[i];
        progress.progressText.innerText = `Embedding image ${i + 1} of ${images.length}...`;
        progress.progressBar.style.width = `${10 + (i / images.length) * 80}%`;

        // Ensure the format is supported by pdf-lib (convert WebP/others to PNG)
        try {
          item = await ensurePngOrJpg(item);
        } catch (convErr) {
          console.warn('Canvas conversion failed, attempting direct embed:', convErr);
        }

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

        // Calculate Image Drawing size
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
