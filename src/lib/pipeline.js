import Groq from "groq-sdk";
import { searchWithQueries } from "$lib/search.js";
import { loadPDF, extractPages } from "$lib/pdf.js";
import { layerOnePrompt, layerTwoPrompt, sectionPickerPrompt, layerThreePrompt } from "$lib/prompts.js";
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

export async function runPipeline(userQuery, onStatus) {

    // ── Step 1: Generate 5 query variations ──
    onStatus("processing", "Optimizing your query...");
    const queries = JSON.parse(await chat(layerOnePrompt + userQuery));

    // ── Step 2: Semantic search across all 5 queries ──
    onStatus("searching", "Searching legal documents...");
    const searchResults = await searchWithQueries(queries);
    const topChunks = searchResults.slice(0, 5).map((hit) => hit.document.text);

    // ── Step 3: Try answering from semantic results ──
    onStatus("answering", "Generating answer from search results...");
    let finalAnswer = null;
    let usedFallback = false;

    if (topChunks.length > 0) {
        const candidate = await chat(layerTwoPrompt(userQuery, topChunks));
        if (candidate && !candidate.includes("INSUFFICIENT_CONTEXT")) {
            finalAnswer = candidate;
        }
    }

    // ── Step 4: PDF fallback — only reached if semantic search failed ──
    if (!finalAnswer) {
        usedFallback = true;
        onStatus("extracting", "Searching document index for relevant sections...");

        // Collect all sections across all documents in the index
        const allSections = documentIndex.flatMap((doc) =>
            doc.contents.map((section) => ({
                ...section,
                documentName: doc.name,
            }))
        );

        // Ask LLM to pick relevant section indices from the index
        const pickedIndicesRaw = await chat(sectionPickerPrompt(userQuery, allSections));
        const pickedIndices = JSON.parse(pickedIndicesRaw);

        if (!pickedIndices || pickedIndices.length === 0) {
            finalAnswer = "The system could not find any relevant sections in the document index for your question.";
        } else {
            const pickedSections = pickedIndices.map((i) => allSections[i]).filter(Boolean);
            const sectionTitles = pickedSections.map((s) => `"${s.title}"`).join(", ");
            onStatus("extracting", `Reading sections: ${sectionTitles}...`);

            // Extract the page ranges from the PDF for all picked sections
            const pageRanges = pickedSections.map((s) => s.pages);
            const pdfDoc = await loadPDF();
            const rawText = await extractPages(pdfDoc, pageRanges);

            // Final LLM attempt with the extracted raw text
            onStatus("answering", "Generating answer from document text...");
            const candidate = await chat(layerThreePrompt(userQuery, rawText));

            if (candidate && !candidate.includes("INSUFFICIENT_CONTEXT")) {
                finalAnswer = candidate;
            } else {
                finalAnswer = "The answer could not be found in the relevant sections of the document.";
            }
        }
    }

    return { answer: finalAnswer, queries, usedFallback };
}