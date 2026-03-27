import Groq from "groq-sdk";
import { searchWithQueries } from "$lib/search.js";
import { loadPDFByFile, extractPages } from "$lib/pdf.js";
import { layerOnePrompt, layerTwoPrompt, layerThreePrompt, documentSectionPickerPrompt } from "$lib/prompts.js";
import documentIndex from "$lib/static/index.json";

const groq = new Groq({
    apiKey: import.meta.env.VITE_GROQ_API_KEY,
    dangerouslyAllowBrowser: true,
});

const MODEL = "llama-3.3-70b-versatile";

async function chat(prompt) {
    const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: MODEL,
    });
    return completion.choices[0]?.message?.content?.trim() || "";
}

function parseJsonSafe(value, fallback = null) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function pickValidDocumentIndex(rawValue, totalDocs) {
    const parsed = typeof rawValue === "number" ? rawValue : parseJsonSafe(rawValue, null);
    const index = Number(parsed);
    if (Number.isFinite(index) && index >= 0 && index < totalDocs) {
        return index;
    }
    return 0;
}

function pickValidSectionIndex(rawValue, maxIndex) {
    const sectionIndex = Number(rawValue);
    if (Number.isFinite(sectionIndex) && sectionIndex >= 0 && sectionIndex < maxIndex) {
        return sectionIndex;
    }
    return 0;
}

function pickConfidence(rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return 0.5;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function pickDocumentAndSection(rawValue, docs) {
    const parsed = typeof rawValue === "object" ? rawValue : parseJsonSafe(rawValue, null);
    const docIndex = pickValidDocumentIndex(parsed?.documentIndex, docs.length);
    const selectedDoc = docs[docIndex] || docs[0];
    const sections = selectedDoc?.contents || [];
    const sectionIndex = pickValidSectionIndex(parsed?.sectionIndex, sections.length);
    const alternateSectionIndex = pickValidSectionIndex(parsed?.alternateSectionIndex, sections.length);
    const confidence = pickConfidence(parsed?.confidence);
    const selectedSection = sections[sectionIndex] || sections[0] || null;
    const alternateSection = sections[alternateSectionIndex] || selectedSection;

    return {
        docIndex,
        sectionIndex,
        alternateSectionIndex,
        confidence,
        selectedDoc,
        selectedSection,
        alternateSection,
    };
}

function buildFallbackPreviewResult(selectedDoc, selectedSection, rawText) {
    if (!selectedDoc || !selectedSection) return null;

    const primaryPage = Array.isArray(selectedSection.pages) ? selectedSection.pages[0] : 1;
    const snippet = (rawText || "").slice(0, 1200) || `Section: ${selectedSection.title}`;

    return {
        score: 0.99,
        document: {
            text: snippet,
            metadata: JSON.stringify({
                source: selectedDoc.file,
                primary_page: primaryPage,
                highlight_rects: [],
                page_dimensions: {},
            }),
        },
    };
}

export async function runPipeline(userQuery, onStatus) {

    // ── Step 1: Generate 5 query variations ──
    onStatus("processing", "Optimizing your query...");
    const queries = JSON.parse(await chat(layerOnePrompt + userQuery));

    // ── Step 2: Semantic search across all 5 queries ──
    onStatus("searching", "Searching legal documents...");
    const searchResults = await searchWithQueries(queries);
    console.log("Semantic search results (full):", searchResults);
    searchResults.slice(0, 3).forEach((hit, idx) => {
        console.log(`Result ${idx}:`, {
            text: hit.document.text?.substring(0, 100),
            score: hit.score,
            metadata: hit.document.metadata,
        });
    });
    const topChunks = searchResults.slice(0, 5).map((hit) => hit.document.text);

    // ── Step 3: Try answering from semantic results ──
    onStatus("answering", "Generating answer from search results...");
    let finalAnswer = null;
    let usedFallback = false;
    let previewResult = searchResults[0] || null;

    if (topChunks.length > 0) {
        const candidate = await chat(layerTwoPrompt(userQuery, topChunks));
        if (candidate && !candidate.includes("INSUFFICIENT_CONTEXT")) {
            finalAnswer = candidate;
        }
    }

    // ── Step 4: PDF fallback — only reached if semantic search failed ──
    if (!finalAnswer) {
        usedFallback = true;
        onStatus("extracting", "Selecting the most likely document and chapter...");

        const docsForPrompt = documentIndex.map((doc) => ({
            name: doc.name,
            file: doc.file,
            description: doc.description,
            contents: doc.contents || [],
        }));

        const pickedDocSectionRaw = await chat(documentSectionPickerPrompt(userQuery, docsForPrompt));
        const { selectedDoc, selectedSection, alternateSection, confidence } = pickDocumentAndSection(pickedDocSectionRaw, documentIndex);

        if (!selectedDoc || !selectedSection) {
            finalAnswer = "The system could not find a relevant document section for your question.";
        } else {
            const useAlternateSection = confidence < 0.6 && alternateSection && alternateSection.title !== selectedSection.title;
            const selectedLabel = useAlternateSection
                ? `${selectedSection.title} (+ alternate: ${alternateSection.title})`
                : selectedSection.title;

            onStatus("extracting", `Reading ${selectedLabel} in ${selectedDoc.name}...`);

            // Default path extracts one chapter; on low confidence we include one alternate chapter.
            const pageRanges = useAlternateSection
                ? [selectedSection.pages, alternateSection.pages]
                : [selectedSection.pages];
            const pdfDoc = await loadPDFByFile(selectedDoc?.file || "constitution.pdf");
            const rawText = await extractPages(pdfDoc, pageRanges);

            previewResult = buildFallbackPreviewResult(selectedDoc, selectedSection, rawText) || previewResult;

            // Final LLM attempt with the extracted raw text
            onStatus("answering", "Generating answer from document text...");
            const candidate = await chat(layerThreePrompt(userQuery, rawText));

            if (candidate && !candidate.includes("INSUFFICIENT_CONTEXT")) {
                finalAnswer = candidate;
            } else {
                finalAnswer = "The answer could not be found in the selected chapter of the document.";
            }
        }
    }

    return { answer: finalAnswer, queries, usedFallback, searchResults, previewResult };
}