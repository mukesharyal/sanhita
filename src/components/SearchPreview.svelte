<script>
  import { createEventDispatcher, tick } from 'svelte';
  import * as pdfjsLib from 'pdfjs-dist';
  import documentIndex from '$lib/static/index.json';
  import { getPdfUrl, resolvePdfFileName } from '$lib/pdf.js';

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();

  export let result = null;

  const dispatch = createEventDispatcher();

  let loading = false;
  let error = '';
  let sourceLabel = '';
  let primaryPage = 'N/A';
  let score = 0;
  let chapterTitle = 'Relevant Chapter';
  let chapterRange = 'N/A';
  let renderedPages = [];
  let renderProgress = 0;
  let totalPages = 0;
  let pendingScrollPage = null;
  let modalElement;

  function parseMetadata(metadataString) {
    try {
      return JSON.parse(metadataString);
    } catch (parseError) {
      console.error('Failed to parse metadata:', parseError);
      return {};
    }
  }

  function normalizeText(value) {
    return (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatSourceLabel(source) {
    return (source || 'Unknown')
      .replace(/\.[^/.]+$/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function normalizeKey(value) {
    return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function tokenize(value) {
    return (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2);
  }

  function overlapScore(sourceTokens, targetTokens) {
    if (sourceTokens.length === 0 || targetTokens.length === 0) return 0;
    const targetSet = new Set(targetTokens);
    let hits = 0;
    for (const token of sourceTokens) {
      if (targetSet.has(token)) hits += 1;
    }
    return hits;
  }

  function resolveDocumentEntry(source, fileName, primaryPageNumber) {
    const sourceKey = normalizeKey(source);
    const fileKey = normalizeKey(fileName);

    const exactMatch = documentIndex.find((doc) => normalizeKey(doc.file) === fileKey);
    if (exactMatch) return exactMatch;

    const sourceTokens = tokenize(source);

    const ranked = documentIndex
      .map((doc) => {
        const docFile = doc.file || '';
        const docFileKey = normalizeKey(docFile);
        const docName = doc.name || '';
        const docNameKey = normalizeKey(docName);
        const docTokens = tokenize(`${docFile} ${docName}`);

        let score = 0;

        if (fileKey && (docFileKey.includes(fileKey) || fileKey.includes(docFileKey))) {
          score += 120;
        }
        if (sourceKey && (sourceKey.includes(docFileKey) || sourceKey.includes(docNameKey))) {
          score += 90;
        }

        score += overlapScore(sourceTokens, docTokens) * 8;

        const hasPrimaryInAnyChapter = Number.isFinite(primaryPageNumber) && (doc.contents || []).some((section) => {
          const [start, end] = section.pages || [];
          return Number.isFinite(start)
            && Number.isFinite(end)
            && primaryPageNumber >= start
            && primaryPageNumber <= end;
        });

        if (hasPrimaryInAnyChapter) {
          score += 40;
        }

        return { doc, score };
      })
      .sort((a, b) => b.score - a.score);

    if (ranked.length > 0) {
      return ranked[0].doc;
    }

    return documentIndex[0] || null;
  }

  function resolveChapter(docEntry, primaryPageNumber) {
    if (!docEntry) return null;

    const sections = docEntry.contents || [];
    if (sections.length === 0) return null;

    if (!Number.isFinite(primaryPageNumber)) {
      return sections[0] || null;
    }

    const exact = sections.find((section) => {
      const [start, end] = section.pages || [];
      return Number.isFinite(start)
        && Number.isFinite(end)
        && primaryPageNumber >= start
        && primaryPageNumber <= end;
    });

    if (exact) return exact;

    // If page doesn't fit exactly, use nearest chapter rather than falling back to a single page.
    let best = sections[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const section of sections) {
      const [start, end] = section.pages || [];
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const distance = primaryPageNumber < start
        ? start - primaryPageNumber
        : primaryPageNumber > end
          ? primaryPageNumber - end
          : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = section;
      }
    }
    return best;
  }

  function buildChapterPageList(chapter, primaryPageNumber, numPages) {
    if (chapter?.pages?.length === 2) {
      const start = Math.max(1, chapter.pages[0]);
      const end = Math.min(numPages, chapter.pages[1]);
      if (start <= end) {
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      }
    }

    const fallback = Number.isFinite(primaryPageNumber) ? primaryPageNumber : 1;
    return [Math.max(1, Math.min(numPages, fallback))];
  }

  async function loadPdfDocument(fileName) {
    const pdfUrl = getPdfUrl(fileName, 'constitution.pdf');
    return pdfjsLib.getDocument(pdfUrl).promise;
  }

  function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function getPageDimension(metadata, pageNumber) {
    const key = String(pageNumber);
    const dimensions = metadata.page_dimensions?.[key];
    if (!dimensions) return null;

    if (Array.isArray(dimensions) && dimensions.length >= 2) {
      const width = toFiniteNumber(dimensions[0]);
      const height = toFiniteNumber(dimensions[1]);
      if (width && height) return { width, height };
    }

    if (typeof dimensions === 'object') {
      const width = toFiniteNumber(dimensions.width ?? dimensions.w ?? dimensions[0]);
      const height = toFiniteNumber(dimensions.height ?? dimensions.h ?? dimensions[1]);
      if (width && height) return { width, height };
    }

    return null;
  }

  function mapMetadataRectToViewport(rect, sourceDimension, viewport) {
    const bbox = Array.isArray(rect.bbox) ? rect.bbox : null;

    const x = toFiniteNumber(rect.x ?? rect.left ?? rect.x0 ?? (bbox ? bbox[0] : null));
    const y = toFiniteNumber(rect.y ?? rect.bottom ?? rect.y0 ?? (bbox ? bbox[1] : null));
    let width = toFiniteNumber(rect.width ?? rect.w ?? null);
    let height = toFiniteNumber(rect.height ?? rect.h ?? null);

    const x1 = toFiniteNumber(rect.x1 ?? (bbox ? bbox[2] : null));
    const y1 = toFiniteNumber(rect.y1 ?? (bbox ? bbox[3] : null));

    if ((!width || !height) && x !== null && y !== null && x1 !== null && y1 !== null) {
      width = Math.abs(x1 - x);
      height = Math.abs(y1 - y);
    }

    if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
      return null;
    }

    const sourceWidth = sourceDimension?.width || viewport.width;
    const sourceHeight = sourceDimension?.height || viewport.height;
    const scaleX = viewport.width / sourceWidth;
    const scaleY = viewport.height / sourceHeight;

    const left = x * scaleX;
    const mappedWidth = width * scaleX;
    const mappedHeight = height * scaleY;

    // Try PDF bottom-left origin first.
    let top = viewport.height - (y + height) * scaleY;

    // Fallback for top-left origin metadata.
    if (top < -2 || top > viewport.height + 2) {
      top = y * scaleY;
    }

    return { left, top, width: mappedWidth, height: mappedHeight };
  }

  function getMetadataHighlightsForPage(metadata, pageNumber, viewport) {
    const sourceDimension = getPageDimension(metadata, pageNumber);
    const rects = (metadata.highlight_rects || []).filter((rect) => Number(rect.page) === pageNumber);
    const mapped = rects
      .map((rect) => mapMetadataRectToViewport(rect, sourceDimension, viewport))
      .filter(Boolean);
    return mapped;
  }

  function fullPageHighlight(viewport) {
    return [{
      left: 0,
      top: 0,
      width: viewport.width,
      height: viewport.height,
    }];
  }

  function scrollToPage(pageNumber) {
    const target = modalElement?.querySelector(`[data-page-number="${pageNumber}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function deferAutoScroll(pageNumber) {
    await tick();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToPage(pageNumber);
      });
    });
  }

  function buildHighlightRects(viewport, textItems, snippet) {
    const snippetTokens = normalizeText(snippet)
      .split(' ')
      .filter((token) => token.length > 4)
      .slice(0, 12);

    if (snippetTokens.length === 0) return [];

    const rects = [];
    for (const item of textItems) {
      const itemText = normalizeText(item.str);
      if (!itemText) continue;

      const hasMatch = snippetTokens.some((token) => itemText.includes(token));
      if (!hasMatch) continue;

      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const x = tx[4];
      const y = tx[5];
      const height = Math.abs(tx[3]) || item.height || 10;
      const width = item.width * viewport.scale;

      rects.push({
        left: x,
        top: viewport.height - y - height,
        width,
        height,
      });
    }

    return rects;
  }

  async function renderPages() {
    if (!result?.document) return;

    loading = true;
    error = '';
    renderedPages = [];
    renderProgress = 0;
    totalPages = 0;
    pendingScrollPage = null;
    chapterTitle = 'Relevant Chapter';
    chapterRange = 'N/A';

    try {
      const metadata = parseMetadata(result.document.metadata);
      const source = metadata.source || '';
      const fileNameFromSource = resolvePdfFileName(source, 'constitution.pdf');
      const snippet = result.document.text || '';
      const detectedPrimary = Number(metadata.primary_page);

      const matchedDoc = resolveDocumentEntry(source, fileNameFromSource, detectedPrimary);
      const resolvedFileName = resolvePdfFileName(matchedDoc?.file || fileNameFromSource, 'constitution.pdf');

      sourceLabel = formatSourceLabel(resolvedFileName);
      primaryPage = Number.isFinite(detectedPrimary) ? detectedPrimary : 'N/A';
      score = Math.round((result.score || 0) * 100);

      const pdfDoc = await loadPdfDocument(resolvedFileName);
      const chapter = resolveChapter(matchedDoc, detectedPrimary);
      const pages = buildChapterPageList(chapter, detectedPrimary, pdfDoc.numPages);
      totalPages = pages.length;
      chapterTitle = chapter?.title || 'Relevant Section';
      chapterRange = chapter?.pages?.length === 2 ? `${chapter.pages[0]}-${chapter.pages[1]}` : 'N/A';

      const pageViews = [];
      for (let idx = 0; idx < pages.length; idx++) {
        const pageNumber = pages[idx];
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        await page.render({ canvasContext: context, viewport }).promise;

        const textContent = await page.getTextContent();
        let highlights = [];
        if (Number.isFinite(detectedPrimary) && pageNumber === detectedPrimary) {
          highlights = fullPageHighlight(viewport);
        } else {
          const metadataRects = getMetadataHighlightsForPage(metadata, pageNumber, viewport);
          const snippetRects = buildHighlightRects(viewport, textContent.items, snippet);
          if (metadataRects.length > 0 || snippetRects.length > 0) {
            highlights = [];
          }
        }

        pageViews.push({
          pageNumber,
          dataUrl: canvas.toDataURL('image/png'),
          width: viewport.width,
          height: viewport.height,
          highlights,
        });

        renderedPages = [...pageViews];
        renderProgress = idx + 1;
      }

      if (Number.isFinite(detectedPrimary)) {
        pendingScrollPage = detectedPrimary;
      }
    } catch (renderError) {
      console.error(renderError);
      error = 'Could not load PDF preview for this result.';
    } finally {
      loading = false;
    }
  }

  function close() {
    dispatch('close');
  }

  $: if (result) {
    renderPages();
  }

  $: if (!loading && pendingScrollPage !== null && renderedPages.length > 0) {
    const pageToScroll = pendingScrollPage;
    pendingScrollPage = null;
    deferAutoScroll(pageToScroll);
  }
</script>

<div class="modal-backdrop" role="button" tabindex="0" on:click={close} on:keydown={(e) => e.key === 'Escape' && close()}>
  <div class="modal" bind:this={modalElement} role="dialog" aria-modal="true" tabindex="-1" on:click|stopPropagation on:keydown={(e) => e.key === 'Escape' && close()}>
    <div class="modal-header">
      <div>
        <p class="meta-line">{sourceLabel}</p>
        <p class="meta-subline">Chapter: {chapterTitle} (pp. {chapterRange})</p>
        <p class="meta-subline">Primary page: {primaryPage} · Relevance: {score}%</p>
      </div>
      <button class="close-button" on:click={close}>Close</button>
    </div>

    {#if loading}
      <div class="state-box">Loading PDF pages... {renderProgress}/{totalPages}</div>
    {:else if error}
      <div class="state-box error">{error}</div>
    {:else}
      <div class="page-stack">
        {#each renderedPages as page (page.pageNumber)}
          <div class="page-card" data-page-number={page.pageNumber}>
            <div class="page-title">Page {page.pageNumber}</div>
            <div class="page-canvas-wrap" style={`width:${page.width}px; max-width:100%;`}>
              <img class="page-image" src={page.dataUrl} alt={`PDF page ${page.pageNumber}`} />
              {#each page.highlights as rect, i (`${page.pageNumber}-${i}`)}
                <div
                  class="highlight"
                  style={`left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`}
                ></div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(7, 7, 9, 0.76);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
    padding: 20px;
  }

  .modal {
    width: min(980px, 100%);
    max-height: 88vh;
    overflow: auto;
    background: #121114;
    border: 1px solid rgba(180, 140, 60, 0.25);
    border-radius: 8px;
    padding: 18px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;
    margin-bottom: 14px;
    border-bottom: 1px solid rgba(180, 140, 60, 0.15);
    padding-bottom: 12px;
  }

  .meta-line {
    font-weight: 600;
    color: #e9ddbf;
    margin: 0;
  }

  .meta-subline {
    margin: 4px 0 0;
    color: #9c8a62;
    font-size: 0.85rem;
  }

  .close-button {
    border: 1px solid rgba(180, 140, 60, 0.35);
    background: rgba(180, 140, 60, 0.1);
    color: #dac28d;
    border-radius: 4px;
    padding: 8px 12px;
    cursor: pointer;
    font-weight: 600;
  }

  .state-box {
    color: #c7b691;
    padding: 16px;
    text-align: center;
    border: 1px dashed rgba(180, 140, 60, 0.25);
    border-radius: 6px;
  }

  .state-box.error {
    color: #df9f91;
    border-color: rgba(192, 115, 90, 0.45);
  }

  .page-stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .page-card {
    border: 1px solid rgba(180, 140, 60, 0.16);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
    padding: 12px;
  }

  .page-title {
    color: #c8b27c;
    font-size: 0.82rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .page-canvas-wrap {
    position: relative;
  }

  .page-image {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 4px;
  }

  .highlight {
    position: absolute;
    background: rgba(255, 229, 102, 0.3);
    border: 2px solid rgba(255, 213, 79, 0.92);
    border-radius: 2px;
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(20, 20, 20, 0.25) inset;
  }

  @media (max-width: 768px) {
    .modal-backdrop {
      padding: 10px;
    }

    .modal {
      max-height: 94vh;
      padding: 12px;
    }

    .meta-subline {
      font-size: 0.78rem;
    }
  }
</style>
