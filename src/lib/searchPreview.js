/**
 * Utility functions for parsing and formatting search result previews
 */

export function parseMetadata(metadataString) {
  try {
    return JSON.parse(metadataString);
  } catch (error) {
    console.error('Failed to parse metadata:', error);
    return {};
  }
}

export function getDocumentPreview(searchResult, maxLength = 300) {
  const { text, metadata } = searchResult.document;
  
  // Parse metadata
  const parsedMetadata = parseMetadata(metadata);
  
  // Truncate text for preview
  let preview = text;
  if (text.length > maxLength) {
    preview = text.substring(0, maxLength) + '...';
  }
  
  return {
    text: preview,
    fullText: text,
    metadata: parsedMetadata,
    score: searchResult.score,
    id: searchResult.id
  };
}

export function extractDocumentInfo(metadata) {
  const parsed = typeof metadata === 'string' ? parseMetadata(metadata) : metadata;
  
  return {
    source: parsed.source || 'Unknown',
    primaryPage: parsed.primary_page || 'N/A',
    pages: Object.keys(parsed.page_dimensions || {}).sort((a, b) => parseInt(a) - parseInt(b)),
    highlightRects: parsed.highlight_rects || [],
    wordBoxes: parsed.word_boxes || [],
    pageDimensions: parsed.page_dimensions || {}
  };
}

export function getHighlightedPages(metadata) {
  const parsed = typeof metadata === 'string' ? parseMetadata(metadata) : metadata;
  const highlightRects = parsed.highlight_rects || [];
  
  if (highlightRects.length === 0) return [];
  
  const pages = new Set(highlightRects.map(rect => rect.page));
  return Array.from(pages).sort((a, b) => a - b);
}

export function generatePreviewHTML(text, maxLength = 200) {
  let preview = text;
  
  // Remove excessive whitespace
  preview = preview.replace(/\s+/g, ' ').trim();
  
  // Truncate
  if (preview.length > maxLength) {
    preview = preview.substring(0, maxLength);
    // Find last complete word
    const lastSpace = preview.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.8) {
      preview = preview.substring(0, lastSpace);
    }
    preview += '...';
  }
  
  return preview;
}

export function formatDocumentSource(source) {
  // Convert filename to readable format
  return source
    .replace(/\.[^/.]+$/, '') // Remove extension
    .replace(/_/g, ' ') // Replace underscores with spaces
    .replace(/\b\w/g, (char) => char.toUpperCase()); // Capitalize words
}

export function getPageRange(metadata) {
  const info = extractDocumentInfo(metadata);
  if (info.pages.length === 0) return 'N/A';
  
  const pages = info.pages.map(p => parseInt(p)).sort((a, b) => a - b);
  if (pages.length === 1) return `Page ${pages[0]}`;
  
  return `Pages ${pages[0]}-${pages[pages.length - 1]}`;
}
