import JSZip from 'jszip';

/**
 * Dynamically loads a script file from a CDN if not already loaded.
 * @param {string} url - Script URL
 * @returns {Promise<void>}
 */
export function loadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
      } else {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', (err) => reject(err));
      }
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.loaded = 'false';

    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Failed to load script: ${url}`));
    };

    document.head.appendChild(script);
  });
}

/**
 * Formats bytes to human-readable size.
 * @param {number} bytes
 * @param {number} decimals
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 2) {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Triggers a browser download of a Blob or File.
 * @param {Blob|Uint8Array} data
 * @param {string} filename
 * @param {string} mimeType
 */
export function downloadBlob(data, filename, mimeType = 'application/pdf') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Converts a file to an ArrayBuffer (native API when available).
 * @param {File|Blob} file
 * @returns {Promise<ArrayBuffer>}
 */
export function fileToArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Copy of a buffer for pdf.js (pdf.js may detach/transfer the source).
 * Avoids an extra intermediate TypedArray allocation when a slice is enough.
 * @param {ArrayBuffer} buffer
 * @returns {Uint8Array}
 */
export function pdfjsDataFromBuffer(buffer) {
  return new Uint8Array(buffer.slice(0));
}

/**
 * Yield to the browser so the UI can update during long page loops.
 * @returns {Promise<void>}
 */
export function yieldToUI() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Release canvas pixel memory after a page is processed.
 * @param {HTMLCanvasElement | null} canvas
 */
export function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Helper to wrap canvas.toBlob inside a Promise
 * @param {HTMLCanvasElement} canvas
 * @param {string} mimeType
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, mimeType = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, mimeType, quality);
  });
}

/**
 * Render a pdfjs Page object onto a canvas.
 * @param {any} pdfPage - pdfjs Page
 * @param {number} scale - Render scale
 * @param {{ willReadFrequently?: boolean, alpha?: boolean }} [opts]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderPDFPageToCanvas(pdfPage, scale = 1.5, opts = {}) {
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const context = canvas.getContext('2d', {
    alpha: opts.alpha !== false,
    willReadFrequently: !!opts.willReadFrequently
  });

  await pdfPage.render({
    canvasContext: context,
    viewport
  }).promise;

  return canvas;
}

/**
 * Render a low-res preview as a blob object URL (much cheaper than data URLs).
 * Caller must revoke the URL when done (or pass an ObjectUrlManager).
 * @param {any} pdfPage
 * @param {number} [scale=0.4]
 * @param {number} [jpegQuality=0.72]
 * @returns {Promise<string>} object URL
 */
export async function renderPDFPageToObjectUrl(pdfPage, scale = 0.4, jpegQuality = 0.72) {
  const canvas = await renderPDFPageToCanvas(pdfPage, scale, { alpha: false });
  try {
    const blob = await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
    return URL.createObjectURL(blob);
  } finally {
    releaseCanvas(canvas);
  }
}

/**
 * Zip an array of files/blobs and download them
 * @param {Array<{name: string, data: Blob|Uint8Array|string}>} filesToZip
 * @param {string} zipName
 */
export async function downloadZipOfFiles(filesToZip, zipName = 'pdfzen-bundle.zip') {
  const zip = new JSZip();

  for (const file of filesToZip) {
    zip.file(file.name, file.data);
  }

  const content = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  downloadBlob(content, zipName, 'application/zip');
}
