<script>
  import { createEventDispatcher } from 'svelte';
  import * as pdfjsLib from 'pdfjs-dist';
  import { getPdfUrl, resolvePdfFileName } from '$lib/pdf.js';

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();

  export let result = null;

  const dispatch = createEventDispatcher();

  let loading = false;
  let error = '';
  let sourceLabel = 'Unknown';
  let pageNumber = 'N/A';
  let previewImage = '';
  let flowLabel = 'Semantic Search';
  let lastRenderedKey = '';

  function parseMetadata(metadataString) {
    try {
      return JSON.parse(metadataString);
    } catch {
      return {};
    }
  }

  function formatSourceLabel(source) {
    return (source || 'Unknown')
      .replace(/\.[^/.]+$/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function buildRenderKey(metadata, fileName, detectedPage) {
    return [
      result?.id || '',
      metadata?.retrieval_mode || '',
      fileName || '',
      Number.isFinite(detectedPage) ? detectedPage : 'n/a'
    ].join('|');
  }

  async function renderPreview() {
    if (!result?.document) return;

    try {
      const metadata = parseMetadata(result.document.metadata);
      const source = metadata.source || '';
      const fileName = resolvePdfFileName(source, 'constitution.pdf');
      const detectedPage = Number(metadata.primary_page);
      const renderKey = buildRenderKey(metadata, fileName, detectedPage);

      if (renderKey === lastRenderedKey && previewImage && !error) {
        return;
      }

      loading = true;
      error = '';
      previewImage = '';
      flowLabel = metadata.retrieval_mode === 'fallback' ? 'LLM Fallback' : 'Semantic Search';

      sourceLabel = formatSourceLabel(fileName);

      const pdfUrl = getPdfUrl(fileName, 'constitution.pdf');
      const pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;

      const safePage = Number.isFinite(detectedPage)
        ? Math.max(1, Math.min(pdfDoc.numPages, detectedPage))
        : 1;

      pageNumber = safePage;

      const page = await pdfDoc.getPage(safePage);
      const baseViewport = page.getViewport({ scale: 1 });
      const desiredWidth = 360;
      const scale = desiredWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      await page.render({ canvasContext: context, viewport }).promise;
      previewImage = canvas.toDataURL('image/png');
      lastRenderedKey = renderKey;
    } catch (renderError) {
      console.error(renderError);
      error = 'Could not load page preview.';
    } finally {
      loading = false;
    }
  }

  function openModal() {
    dispatch('open');
  }

  $: if (result) {
    renderPreview();
  }
</script>

<div class="inline-preview">
  <div class="inline-preview-header">
    <p class="inline-preview-label">Relevant Page Preview</p>
    <p class="inline-preview-meta">{sourceLabel} · Page {pageNumber}</p>
    <p class="flow-tag">{flowLabel}</p>
  </div>

  {#if loading}
    <div class="inline-preview-state">Loading preview...</div>
  {:else if error}
    <div class="inline-preview-state error">{error}</div>
  {:else if previewImage}
    <button class="inline-preview-button" on:click={openModal}>
      <div class="thumbnail-wrap">
        <img src={previewImage} alt={`Preview page ${pageNumber}`} />
        <span class="inline-preview-overlay">See Source</span>
      </div>
      <span class="inline-preview-hint">{sourceLabel} · p. {pageNumber}</span>
    </button>
  {/if}
</div>

<style>
  .inline-preview {
    margin-top: 14px;
    display: inline-flex;
    flex-direction: column;
    gap: 8px;
  }

  .inline-preview-header {
    margin-bottom: 0;
  }

  .inline-preview-label {
    margin: 0;
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #c8b27c;
    font-weight: 600;
  }

  .inline-preview-meta {
    margin: 5px 0 0;
    color: #9c8a62;
    font-size: 0.82rem;
  }

  .flow-tag {
    margin: 6px 0 0;
    display: inline-block;
    width: fit-content;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #efe0bd;
    border: 1px solid rgba(180, 140, 60, 0.35);
    background: rgba(180, 140, 60, 0.12);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .inline-preview-state {
    color: #c7b691;
    font-size: 0.9rem;
    padding: 10px;
    border: 1px dashed rgba(180, 140, 60, 0.2);
    border-radius: 4px;
  }

  .inline-preview-state.error {
    color: #df9f91;
    border-color: rgba(192, 115, 90, 0.45);
  }

  .inline-preview-button {
    display: inline-flex;
    flex-direction: column;
    width: 220px;
    border: 1px solid rgba(180, 140, 60, 0.2);
    background: rgba(0, 0, 0, 0.18);
    border-radius: 6px;
    padding: 8px 8px 6px;
    cursor: pointer;
    text-align: left;
  }

  .thumbnail-wrap {
    position: relative;
  }

  .inline-preview-button img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 4px;
  }

  .inline-preview-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 10, 10, 0.45);
    color: #f0e6c8;
    font-size: 0.85rem;
    letter-spacing: 0.05em;
    opacity: 0;
    transition: opacity 0.2s ease;
    border-radius: 4px;
    font-weight: 600;
  }

  .inline-preview-button:hover {
    border-color: rgba(180, 140, 60, 0.38);
    background: rgba(180, 140, 60, 0.05);
  }

  .inline-preview-button:hover .inline-preview-overlay {
    opacity: 1;
  }

  .inline-preview-hint {
    display: inline-block;
    margin-top: 6px;
    font-size: 0.72rem;
    color: #bfa978;
    line-height: 1.3;
  }
</style>
