import { pdfjsLib } from '../../lib/pdfjs-setup.js';

// --- Shared AI Input Helper ---
export function createAIUI(container, options) {
  container.innerHTML = `
    <div class="workspace-main-panel">
      <div id="ai-dropzone" class="dropzone">
        <i class="bi ${options.icon} dropzone-icon"></i>
        <h4>${options.title}</h4>
        <p>${options.subtitle}</p>
        <input type="file" id="ai-file-input" class="file-input-hidden" accept="application/pdf" ${options.multiple ? 'multiple' : ''}>
      </div>

      <div id="ai-preview" style="display: none; text-align: center; padding: 1.5rem; width:100%;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem;">
          <h4 style="font-family: var(--font-title);" id="ai-preview-title">Document Loaded</h4>
          <span id="ai-file-meta" class="form-help"></span>
        </div>
        
        <!-- Multi file list for compare -->
        <div id="ai-compare-file-list" class="file-list" style="display:none; text-align:left; margin-bottom:1.5rem;"></div>

        <!-- Render Viewport -->
        <div id="ai-render-root" style="width:100%; border:1px solid var(--border-card); border-radius:12px; background:rgba(0,0,0,0.15); padding:1rem; max-height:450px; overflow-y:auto; text-align:left;">
          <div style="display:flex; justify-content:center;" id="ai-render-canvas-container"></div>
          <div id="ai-compare-diff-view" class="diff-container" style="display:none;"></div>
          <div id="ai-ocr-text-result" style="display:none; font-family:monospace; font-size:0.85rem; white-space:pre-wrap;"></div>
        </div>
      </div>
    </div>

    <div class="workspace-side-panel">
      <h3 class="side-panel-title">AI Options</h3>
      <div id="ai-settings-fields">
        ${options.settingsHTML || '<p class="form-help">Uses Gemini 1.5 Flash to process document text content.</p>'}
      </div>
      <button id="btn-run-ai" class="btn btn-primary" style="width: 100%; margin-top: 1rem;" disabled>
        <i class="bi ${options.actionIcon || 'bi-stars'}"></i> ${options.actionText || 'Process with AI'}
      </button>
    </div>
  `;

  return {
    dropzone: container.querySelector('#ai-dropzone'),
    fileInput: container.querySelector('#ai-file-input'),
    preview: container.querySelector('#ai-preview'),
    previewTitle: container.querySelector('#ai-preview-title'),
    fileMeta: container.querySelector('#ai-file-meta'),
    settingsFields: container.querySelector('#ai-settings-fields'),
    runBtn: container.querySelector('#btn-run-ai'),
    renderRoot: container.querySelector('#ai-render-root'),
    canvasContainer: container.querySelector('#ai-render-canvas-container'),
    compareFilesList: container.querySelector('#ai-compare-file-list'),
    diffView: container.querySelector('#ai-compare-diff-view'),
    ocrTextResult: container.querySelector('#ai-ocr-text-result')
  };
}

// --- Text Extraction for AI ---

/**
 * Extract per-page text from a PDF (RAM-friendly; one page at a time).
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ pages: { pageNumber: number, text: string }[], pageCount: number, text: string }>}
 */
export async function getPDFPagesText(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const numPages = pdf.numPages;
  /** @type {{ pageNumber: number, text: string }[]} */
  const pages = [];
  let fullText = '';

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push({ pageNumber: i, text: pageText });
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }

  return { pages, pageCount: numPages, text: fullText };
}

/** Full-document text extract (wrapper). */
export async function getPDFRawText(arrayBuffer) {
  const { text, pageCount } = await getPDFPagesText(arrayBuffer);
  return { text, pageCount };
}

/**
 * Pack pages into small batches that fit a tight context budget.
 * @param {{ pageNumber: number, text: string }[]} pages
 * @param {{ maxChars?: number, maxPages?: number }} [opts]
 * @returns {{ pageNumbers: number[], text: string, label: string }[]}
 */
export function batchPdfPages(pages, opts = {}) {
  const maxChars = opts.maxChars ?? 2800;
  const maxPages = opts.maxPages ?? 2;
  /** @type {{ pageNumbers: number[], text: string, label: string }[]} */
  const batches = [];
  let curNums = [];
  let curParts = [];
  let curLen = 0;

  const flush = () => {
    if (!curNums.length) return;
    const label =
      curNums.length === 1
        ? `Page ${curNums[0]}`
        : `Pages ${curNums[0]}–${curNums[curNums.length - 1]}`;
    batches.push({
      pageNumbers: [...curNums],
      text: curParts.join('\n\n'),
      label
    });
    curNums = [];
    curParts = [];
    curLen = 0;
  };

  for (const p of pages) {
    const body = (p.text || '').trim();
    // Skip nearly empty pages in batches (still noted)
    if (body.length < 8) {
      flush();
      batches.push({
        pageNumbers: [p.pageNumber],
        text: '',
        label: `Page ${p.pageNumber}`,
        empty: true
      });
      continue;
    }

    // Single huge page: hard-split by characters
    if (body.length > maxChars) {
      flush();
      let offset = 0;
      let part = 1;
      while (offset < body.length) {
        const slice = body.slice(offset, offset + maxChars);
        batches.push({
          pageNumbers: [p.pageNumber],
          text: slice,
          label: `Page ${p.pageNumber} (part ${part})`
        });
        offset += maxChars;
        part += 1;
      }
      continue;
    }

    const piece = `--- Page ${p.pageNumber} ---\n${body}`;
    const nextLen = curLen + piece.length + 2;
    if (curNums.length >= maxPages || (curNums.length > 0 && nextLen > maxChars)) {
      flush();
    }
    curNums.push(p.pageNumber);
    curParts.push(piece);
    curLen += piece.length + 2;
  }
  flush();
  return batches;
}

// --- Call Gemini API ---
export async function callGemini(prompt, apiKey) {
  if (!apiKey) throw new Error('Gemini API key is missing. Open Settings and paste your key.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Gemini API returned an error. Check your API key.');
  }

  const data = await response.json();
  if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
    return data.candidates[0].content.parts[0].text;
  }
  throw new Error('Failed to parse Gemini model response.');
}

/** Rough token estimate for Latin/English-ish text (Ollama uses BPE; ~3.5 chars/token is safe). */
export function estimateTokens(text = '') {
  return Math.ceil(String(text).length / 3.5);
}

/**
 * Pull a readable message out of Ollama / llama.cpp error bodies
 * (often double-encoded JSON with exceed_context_size_error).
 * @param {string} raw
 */
export function parseOllamaError(raw) {
  if (!raw) return '';
  let msg = String(raw).trim();
  try {
    let parsed = JSON.parse(msg);
    // Sometimes body is {"error":"{\"error\":{...}}"}
    if (typeof parsed.error === 'string') {
      try {
        const inner = JSON.parse(parsed.error);
        parsed = inner;
      } catch {
        return parsed.error;
      }
    }
    const err = parsed.error || parsed;
    if (err && typeof err === 'object') {
      if (err.type === 'exceed_context_size_error' || /context size/i.test(err.message || '')) {
        const used = err.n_prompt_tokens ?? '?';
        const ctx = err.n_ctx ?? '?';
        return `Prompt too large for model context (${used} tokens used / ${ctx} available).`;
      }
      if (err.message) return err.message;
    }
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    /* plain text */
  }
  return msg.length > 400 ? `${msg.slice(0, 400)}…` : msg;
}

/**
 * Shrink prompt (+ optional images) so it fits num_ctx with room for the reply.
 * @param {string} prompt
 * @param {string[]} images
 * @param {{ numCtx: number, numPredict: number }} budget
 */
function fitOllamaPayload(prompt, images, budget) {
  const { numCtx, numPredict } = budget;
  // Vision tokens vary by model; keep a conservative per-image reserve
  let imgs = Array.isArray(images) ? images.filter(Boolean) : [];
  const tokensPerImage = 900;
  let imageReserve = imgs.length * tokensPerImage;
  const safety = 128;
  let available = numCtx - numPredict - imageReserve - safety;

  // If images alone blow the budget, drop them one by one
  while (imgs.length > 0 && available < 400) {
    imgs = imgs.slice(0, -1);
    imageReserve = imgs.length * tokensPerImage;
    available = numCtx - numPredict - imageReserve - safety;
  }

  available = Math.max(256, available);
  const maxChars = Math.floor(available * 3.5);
  let text = String(prompt || '');
  if (text.length > maxChars) {
    text =
      text.slice(0, maxChars) +
      '\n\n[Document truncated to fit the local model context window.]';
  }
  return { prompt: text, images: imgs };
}

/**
 * Pull usable text from an Ollama chat/generate payload.
 * Qwen3 / VL "thinking" models often put the answer in `message.thinking`
 * and leave `message.content` empty unless `think: false` is set.
 * @param {any} data
 * @returns {string}
 */
export function extractOllamaText(data) {
  if (!data || typeof data !== 'object') return '';
  const msg = data.message && typeof data.message === 'object' ? data.message : {};
  const parts = [msg.content, data.response, msg.thinking, data.thinking];
  for (const p of parts) {
    if (typeof p === 'string' && p.trim()) return p.trim();
  }
  // Rare: content as array of {text}
  if (Array.isArray(msg.content)) {
    const joined = msg.content
      .map((x) => (typeof x === 'string' ? x : x?.text || ''))
      .join('')
      .trim();
    if (joined) return joined;
  }
  return '';
}

/** In-browser ring of recent AI calls (shown in Settings → Service logs). */
const _aiClientLog = [];
const _AI_LOG_MAX = 40;

export function pushAiClientLog(entry) {
  _aiClientLog.unshift({
    t: new Date().toISOString(),
    ...entry
  });
  while (_aiClientLog.length > _AI_LOG_MAX) _aiClientLog.pop();
}

export function getAiClientLog() {
  return [..._aiClientLog];
}

/**
 * Call a local Ollama server (/api/chat).
 * Optional `images` = array of base64 strings (no data: prefix) for vision models.
 * Sets num_ctx so small default contexts (4096) do not reject normal PDF prompts.
 * @param {string} prompt
 * @param {{ baseUrl?: string, model?: string, images?: string[], numCtx?: number, numPredict?: number, think?: boolean }} [opts]
 */
export async function callOllama(prompt, opts = {}) {
  const baseUrl = (opts.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  const model = opts.model || 'huihui_ai/qwen3-vl-abliterated:8b';
  const url = `${baseUrl}/api/chat`;

  // Keep default context modest — large num_ctx is the main RAM/VRAM killer (OOM kills the TCP connection).
  let numCtx = Math.max(2048, Number(opts.numCtx) || 4096);
  let numPredict = Math.max(64, Number(opts.numPredict) || 512);
  let images = Array.isArray(opts.images) ? opts.images.filter(Boolean) : [];
  // Default OFF: thinking models often burn the whole num_predict budget and return empty content
  const think = opts.think === true;
  let textPrompt = String(prompt || '');
  // Soft hint for models that honor /no_think in-prompt
  if (!think && !/\/no_think/i.test(textPrompt)) {
    textPrompt = `${textPrompt}\n\n/no_think`;
  }

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const fitted = fitOllamaPayload(textPrompt, images, { numCtx, numPredict });
    textPrompt = fitted.prompt;
    images = fitted.images;

    const message = { role: 'user', content: textPrompt };
    if (images.length > 0) {
      message.images = images;
    }

    const body = {
      model,
      stream: false,
      keep_alive: '2m',
      // Top-level (not options): required for Qwen3 thinking models
      think,
      messages: [message],
      options: {
        num_ctx: numCtx,
        num_predict: numPredict
      }
    };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (err) {
      const em = String(err?.message || err || '');
      pushAiClientLog({
        level: 'error',
        source: 'ollama',
        model,
        message: `Network error: ${em}`
      });
      if (/forcibly closed|ECONNRESET|wsarecv|Failed to fetch|NetworkError|connection/i.test(em)) {
        throw new Error(
          'Ollama connection dropped (often RAM/VRAM OOM). Close other apps, turn off page images, and try again. Check Settings → Service logs.'
        );
      }
      throw new Error(
        `Cannot reach Ollama at ${baseUrl}. Is it running? For browser access set OLLAMA_ORIGINS=http://localhost:3000`
      );
    }

    if (response.ok) {
      const data = await response.json();
      const content = extractOllamaText(data);
      const doneReason = data.done_reason || data.message?.done_reason || '';
      pushAiClientLog({
        level: content ? 'info' : 'warn',
        source: 'ollama',
        model,
        message: content
          ? `OK (${content.length} chars)${doneReason ? ` · ${doneReason}` : ''}`
          : `Empty content (keys: ${Object.keys(data?.message || data || {}).join(',') || 'none'}; done_reason=${doneReason || 'n/a'})`,
        promptChars: textPrompt.length,
        images: images.length,
        numCtx,
        numPredict,
        think
      });
      if (!content) {
        // Retry once with higher predict / no images if first empty
        if (attempt < maxAttempts - 1) {
          lastError = 'Ollama returned an empty response.';
          numPredict = Math.min(1200, Math.floor(numPredict * 1.5) + 128);
          if (images.length) images = [];
          continue;
        }
        throw new Error(
          'Ollama returned an empty response. Common with Qwen3 “thinking” models — we now send think:false; if this persists, restart Ollama and check Settings → Service logs.'
        );
      }
      return content;
    }

    const raw = await response.text().catch(() => '');
    const friendly = parseOllamaError(raw) || `Ollama error (HTTP ${response.status}). Check model name "${model}".`;
    lastError = friendly;

    const isOom =
      /forcibly closed|wsarecv|out of memory|OOM|not enough memory|resource temporarily/i.test(
        `${friendly}\n${raw}`
      );
    const isCtx =
      /context size|exceed_context|n_ctx|too large/i.test(friendly) ||
      /exceed_context_size_error/i.test(raw);

    if (isOom) {
      throw new Error(
        'Ollama ran out of memory while generating. Use page-by-page summary (automatic for local models), turn off page images, or free RAM.'
      );
    }

    if (!isCtx || attempt === maxAttempts - 1) {
      if (isCtx) {
        throw new Error(
          `${friendly} The summarizer will retry with smaller chunks; if this persists, turn off page images.`
        );
      }
      throw new Error(friendly);
    }

    // Retry strategy: drop images first, then halve prompt, then lower num_predict
    if (images.length > 0) {
      images = images.slice(0, Math.max(0, images.length - 1));
    } else {
      textPrompt = textPrompt.slice(0, Math.floor(textPrompt.length * 0.45));
    }
    numPredict = Math.max(128, Math.floor(numPredict * 0.75));
    // If server reported a hard n_ctx, respect it next time and fit tighter
    try {
      const m = raw.match(/"n_ctx"\s*:\s*(\d+)/);
      if (m) {
        const reported = Number(m[1]);
        if (reported > 0) numCtx = reported;
      }
    } catch {
      /* ignore */
    }
  }

  throw new Error(lastError || 'Ollama request failed.');
}

/**
 * Map-reduce PDF summary: one small model call per page/batch, then a final merge.
 * Keeps peak context (and RAM) low so local 8B models do not OOM on long PDFs.
 *
 * @param {{
 *   pages: { pageNumber: number, text: string }[],
 *   detail?: string,
 *   provider: string,
 *   aiConfig: object,
 *   onProgress?: (msg: string) => void,
 *   wantVision?: boolean,
 *   fileBuffer?: ArrayBuffer | null,
 *   maxCharsPerBatch?: number,
 *   maxPagesPerBatch?: number,
 *   mapNumCtx?: number,
 *   reduceNumCtx?: number
 * }} opts
 * @returns {Promise<string>} final markdown summary
 */
export async function summarizePdfMapReduce(opts) {
  const pages = Array.isArray(opts.pages) ? opts.pages : [];
  const detail = opts.detail || 'medium';
  const provider = opts.provider || 'ollama';
  const aiConfig = opts.aiConfig || {};
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const isOllama = provider === 'ollama';

  // Ollama: 1 page / ~2.5k chars. Gemini can take larger packs.
  const maxChars = opts.maxCharsPerBatch ?? (isOllama ? 2500 : 12000);
  const maxPages = opts.maxPagesPerBatch ?? (isOllama ? 1 : 4);
  const mapNumCtx = opts.mapNumCtx ?? (isOllama ? 4096 : undefined);
  const reduceNumCtx = opts.reduceNumCtx ?? (isOllama ? 4096 : undefined);
  const mapPredict = isOllama ? 320 : 800;
  const reducePredict = isOllama ? 700 : 1500;

  if (pages.length === 0) {
    throw new Error('No PDF pages to summarize.');
  }

  const batches = batchPdfPages(pages, { maxChars, maxPages });
  /** @type {string[]} */
  const partials = [];
  let visionUsed = false;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    onProgress(`Summarizing ${batch.label} (${i + 1}/${batches.length})…`);

    if (batch.empty || !(batch.text || '').trim()) {
      partials.push(`### ${batch.label}\n- (no extractable text)`);
      continue;
    }

    // Optional vision: only first non-empty batch, one small image — heavy on VRAM
    let images;
    if (
      opts.wantVision &&
      !visionUsed &&
      opts.fileBuffer &&
      isOllama &&
      batch.pageNumbers?.length
    ) {
      try {
        onProgress(`Rendering ${batch.label} image for vision…`);
        images = await pdfPagesToBase64Images(opts.fileBuffer, {
          maxPages: 1,
          scale: 0.55,
          quality: 0.45,
          startPage: batch.pageNumbers[0]
        });
        visionUsed = true;
      } catch {
        images = undefined;
      }
    }

    const pagePrompt = `You are a careful reading assistant. Summarize ONLY the following PDF excerpt in compact bullet points (markdown).
Detail level: ${detail}.
Capture: main claims, facts, names, numbers, action items, and section topics.
Do NOT invent content that is not in the excerpt. If text is garbage/OCR noise, say so briefly.
Keep under 120 words.

EXCERPT (${batch.label}):
${batch.text}`;

    try {
      const note = await callAI(pagePrompt, {
        ...aiConfig,
        provider,
        images,
        numCtx: mapNumCtx,
        numPredict: mapPredict
      });
      partials.push(`### ${batch.label}\n${(note || '').trim()}`);
    } catch (err) {
      const msg = err?.message || String(err);
      // One hard retry with half text, no images
      try {
        onProgress(`Retrying ${batch.label} with smaller chunk…`);
        const half = batch.text.slice(0, Math.floor(batch.text.length / 2));
        const note = await callAI(
          `Summarize this PDF excerpt in ≤80 words as bullets. No invented facts.\n\n${batch.label}:\n${half}`,
          {
            ...aiConfig,
            provider,
            numCtx: 2048,
            numPredict: 200
          }
        );
        partials.push(`### ${batch.label}\n${(note || '').trim()}`);
      } catch {
        partials.push(`### ${batch.label}\n- [Skipped: ${msg}]`);
      }
    }

    // Yield to UI / GC between model calls
    await new Promise((r) => setTimeout(r, isOllama ? 150 : 20));
  }

  onProgress('Merging page notes into final summary…');

  // If merge notes are huge, fold them in waves
  let notesBlob = partials.join('\n\n');
  const mergeCap = isOllama ? 9000 : 40000;

  while (notesBlob.length > mergeCap) {
    onProgress('Notes still large — compressing intermediate summaries…');
    const midBatches = [];
    for (let i = 0; i < notesBlob.length; i += mergeCap) {
      midBatches.push(notesBlob.slice(i, i + mergeCap));
    }
    const compressed = [];
    for (let i = 0; i < midBatches.length; i++) {
      onProgress(`Compressing notes pack ${i + 1}/${midBatches.length}…`);
      const c = await callAI(
        `Compress these page-summary notes into denser bullet points. Keep all key facts, names, numbers. Markdown only.\n\n${midBatches[i]}`,
        {
          ...aiConfig,
          provider,
          numCtx: mapNumCtx,
          numPredict: mapPredict
        }
      );
      compressed.push(c);
    }
    notesBlob = compressed.join('\n\n');
  }

  const finalPrompt = `You are a professional reading assistant. Below are sequential notes from every page of a PDF (map-reduce).
Write a single polished ${detail} summary in beautiful markdown.
Include: key insights, core themes, action items, and any important figures/names.
Do not invent content that is not supported by the notes. Remove redundancy.

PAGE NOTES:
${notesBlob}`;

  const finalSummary = await callAI(finalPrompt, {
    ...aiConfig,
    provider,
    numCtx: reduceNumCtx,
    numPredict: reducePredict
  });

  return finalSummary;
}

/**
 * Provider-aware AI call using global app state (or overrides).
 * @param {string} prompt
 * @param {{ provider?: string, geminiKey?: string, ollamaUrl?: string, ollamaModel?: string, images?: string[], numCtx?: number, numPredict?: number }} config
 */
export async function callAI(prompt, config = {}) {
  const provider = config.provider || 'gemini';
  if (provider === 'ollama') {
    return callOllama(prompt, {
      baseUrl: config.ollamaUrl,
      model: config.ollamaModel,
      images: config.images,
      numCtx: config.numCtx,
      numPredict: config.numPredict
    });
  }
  // Gemini path is text-only in this app (no multimodal PDF page upload yet)
  return callGemini(prompt, config.geminiKey);
}

/**
 * Heuristic: model name looks like a vision / multimodal Ollama tag.
 */
export function isVisionModel(modelName = '') {
  const m = String(modelName).toLowerCase();
  return (
    m.includes('llava') ||
    m.includes('vision') ||
    m.includes('-vl') ||
    m.includes('vl:') ||
    m.includes('vl-') ||
    m.includes('moondream') ||
    m.includes('minicpm') ||
    m.includes('bakllava') ||
    m.includes('qwen2.5-vl') ||
    m.includes('qwen2-vl') ||
    m.includes('qwen3-vl') ||
    m.includes('qwen3.5') // some qwen3.5 abliterated tags are multimodal
  );
}

/**
 * Render PDF page(s) to JPEG base64 (no data: prefix) for Ollama vision.
 * @param {ArrayBuffer} arrayBuffer
 * @param {{ maxPages?: number, scale?: number, quality?: number, startPage?: number }} [opts]
 * @returns {Promise<string[]>}
 */
export async function pdfPagesToBase64Images(arrayBuffer, opts = {}) {
  const maxPages = opts.maxPages ?? 3;
  const scale = opts.scale ?? 1.0;
  const quality = opts.quality ?? 0.72;
  const startPage = Math.max(1, Number(opts.startPage) || 1);

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const end = Math.min(pdf.numPages, startPage + maxPages - 1);
  const images = [];

  for (let i = startPage; i <= end; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const b64 = dataUrl.split(',')[1];
    if (b64) images.push(b64);

    canvas.width = 0;
    canvas.height = 0;
  }

  return images;
}

/** Human-readable label for status text */
export function aiProviderLabel(provider) {
  return provider === 'ollama' ? 'Local Ollama' : 'Google Gemini';
}
