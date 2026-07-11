import JSZip from 'jszip';

/**
 * Dynamically loads a script file from a CDN if not already loaded.
 * @param {string} url - Script URL
 * @returns {Promise<void>}
 */
export function loadScript(url) {
  return new Promise((resolve, reject) => {
    // Check if script is already injected
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
    script.onerror = (err) => {
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
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Converts a file to an ArrayBuffer.
 * @param {File} file 
 * @returns {Promise<ArrayBuffer>}
 */
export function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Helper to wrap canvas.toBlob inside a Promise
 * @param {HTMLCanvasElement} canvas 
 * @param {string} mimeType 
 * @param {number} quality 
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, mimeType = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, mimeType, quality);
  });
}

/**
 * Render a pdfjs Page object onto a canvas
 * @param {any} pdfPage - pdfjs Page
 * @param {number} scale - Render scale
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderPDFPageToCanvas(pdfPage, scale = 1.5) {
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  
  await pdfPage.render({
    canvasContext: context,
    viewport: viewport
  }).promise;
  
  return canvas;
}

/**
 * Zip an array of files/blobs and download them
 * @param {Array<{name: string, data: Blob|Uint8Array|string}>} filesToZip 
 * @param {string} zipName 
 */
export async function downloadZipOfFiles(filesToZip, zipName = 'pdfzen-bundle.zip') {
  const zip = new JSZip();
  
  filesToZip.forEach(file => {
    zip.file(file.name, file.data);
  });
  
  const content = await zip.generateAsync({ type: 'blob' });
  downloadBlob(content, zipName, 'application/zip');
}
