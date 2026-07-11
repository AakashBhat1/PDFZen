import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true
  },
  // static files (favicon, sample PDFs) live in public/ → served as /favicon.ico, /samples/...
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Smaller, cache-friendly chunks; conversion quality is unaffected.
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('pdf-lib') || id.includes('@cantoo')) return 'pdf-lib';
          if (id.includes('tesseract')) return 'tesseract';
          if (id.includes('docx') || id.includes('mammoth')) return 'office';
          if (id.includes('html2pdf') || id.includes('html2canvas') || id.includes('jspdf')) {
            return 'html2pdf';
          }
          if (id.includes('xlsx') || id.includes('jszip')) return 'data';
        }
      }
    },
    chunkSizeWarningLimit: 900
  },
  optimizeDeps: {
    include: ['pdfjs-dist', 'pdf-lib', 'jszip']
  }
});
